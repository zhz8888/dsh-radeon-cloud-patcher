/**
 * provider 的所有权判定 —— 纯函数，不导入任何 DSH 模块，便于独立测试。
 *
 * 为什么需要它：provider 定义由本插件的 bundle 层声明（cordis.plugin.patch.yml），
 * 而 DSH 的补丁语义是「同 id 的 config 整份替换」。profile 的 cordis.patch.yml、
 * home 的 ~/.dsh/cordis.patch.yml、命令行 overlay 都排在 bundle 层之后，
 * 因此其中任何一条针对 llm-pi-ai 的 config 都会把插件层的定义整份盖掉。
 *
 * 四种归属结局必须被区分开，否则用户只会看到 provider 无声消失：
 *
 *   plugin-layer  之后各层没碰 llm-pi-ai → 插件层的定义生效，一切正常；
 *   materialized  之后的层声明了同 id 定义，且与本插件定义一致 —— 这是设置页
 *                 保存过一次（例如录入 API Key）物化出来的副本，放行；
 *   shadowed      之后的层覆盖了 llm-pi-ai 的 config 却没有 radeon-cloud ——
 *                 插件定义被盖掉，必须响亮失败并给出合并命令；
 *   conflict      之后的层声明了同 id 定义但与本插件不一致 —— 用户自己维护了
 *                 一份同名 provider，插件拒绝接管（这是需求里的「id 冲突」）。
 *
 * 另有哨兵 dynamic：config 是 !!js 表达式、或本次运行拿不到 profile 目录时，
 * 静态判断不了谁生效，此时只告警并照常加载——「判不了」不等于「失败」。
 *
 * 与 merge.js 的关系：merge.js 负责「把定义按键合并进 profile」这条补救路径，
 * 本模块负责「启动时判断谁在管理这个 id」。两者共用同一个 PROVIDER_KEY。
 */
import { PROVIDER_KEY, TARGET_ENTRY_ID, deepEqual } from './merge.js'

/** 所有权判定的四种归属结局，外加「判不了就跳过」的哨兵 dynamic。 */
export const OWNERSHIP = {
  pluginLayer: 'plugin-layer',
  materialized: 'materialized',
  shadowed: 'shadowed',
  conflict: 'conflict',
  dynamic: 'dynamic',
}

/**
 * 找出「最后一条会覆盖 llm-pi-ai config」的补丁，并取出它对 provider 的声明。
 *
 * 层按应用顺序传入（profile → home → overlay），后者覆盖前者，因此只看最后一层。
 * config 是 `!!js` 表达式（对象里只有 __jsExpr）时无法静态判定，返回 dynamic 标记。
 *
 * @param {ReadonlyArray<{ label: string, rows: ReadonlyArray<Record<string, any>> }>} layers 补丁层，按应用顺序
 * @returns {{ label: string, declared: any, dynamic: boolean }|null} 最后一层的信息；没有任何层覆盖时返回 null
 */
export function shadowingDeclaration(layers) {
  let found = null
  for (const layer of layers) {
    for (const row of layer.rows ?? []) {
      if (row?.id !== TARGET_ENTRY_ID) continue
      if (row.insert !== undefined || row.config === undefined) continue
      const dynamic = typeof row.config === 'object' && row.config !== null && typeof row.config.__jsExpr === 'string'
      found = {
        label: layer.label,
        dynamic,
        declared: dynamic ? undefined : row.config?.providers?.[PROVIDER_KEY],
      }
    }
  }
  return found
}

/**
 * 判断一份声明是否「与本插件定义一致」。
 *
 * 采取「本插件声明的字段都必须存在且相等」的子集比较，而不是全等：设置页保存时
 * 会把 schema 的默认值一并物化（defaultInput、headers、thinkingBudgets 等），
 * 全等比较会把这种正常副本误判成冲突。反过来，用户手写一份 endpoint 或模型列表
 * 不同的定义时，被声明的字段就会对不上，正是要拦下的情况。
 *
 * 数组按 id 对齐比较（模型列表的顺序被前端拖拽改过不算冲突），元素没有 id 时
 * 退化为逐个比较。
 *
 * @param {any} ours 本插件的定义（provider/radeon-cloud.yml）
 * @param {any} theirs 之后的层里的同 id 声明
 * @returns {boolean} theirs 是否覆盖了 ours 声明的全部字段
 */
export function agreesWith(ours, theirs) {
  if (Array.isArray(ours)) {
    if (!Array.isArray(theirs) || ours.length !== theirs.length) return false
    if (ours.every((item) => item !== null && typeof item === 'object' && typeof item.id === 'string')) {
      const byId = new Map(theirs.map((item) => [item?.id, item]))
      return ours.every((item) => byId.has(item.id) && agreesWith(item, byId.get(item.id)))
    }
    return ours.every((item, index) => agreesWith(item, theirs[index]))
  }
  if (ours !== null && typeof ours === 'object') {
    if (theirs === null || typeof theirs !== 'object' || Array.isArray(theirs)) return false
    return Object.entries(ours).every(([key, value]) => Object.hasOwn(theirs, key) && agreesWith(value, theirs[key]))
  }
  return deepEqual(ours, theirs)
}

/**
 * 列出两份定义第一处不一致的字段路径，供错误信息指名道姓。
 *
 * @param {any} ours 本插件的定义
 * @param {any} theirs 之后的层里的同 id 声明
 * @param {string[]} prefix 当前路径（递归用）
 * @returns {string|null} 形如 `compat.supportsReasoningEffort` 的路径；完全一致时返回 null
 */
export function firstDifference(ours, theirs, prefix = []) {
  const at = prefix.join('.') || '(根)'
  if (Array.isArray(ours)) {
    if (!Array.isArray(theirs)) return at
    const identified = (list) => list.length > 0
      && list.every((item) => item !== null && typeof item === 'object' && typeof item.id === 'string')
    if (identified(ours) && identified(theirs)) {
      const byId = new Map(theirs.map((item) => [item.id, item]))
      for (const item of ours) {
        if (!byId.has(item.id)) return `${at}.${item.id}（对方没有这一项）`
        const nested = firstDifference(item, byId.get(item.id), [...prefix, item.id])
        if (nested !== null) return nested
      }
      const extra = theirs.find((item) => !ours.some((mine) => mine.id === item.id))
      return extra === undefined ? null : `${at}.${extra.id}（对方多出这一项）`
    }
    if (ours.length !== theirs.length) return `${at}（数量 ${ours.length} ≠ ${theirs.length}）`
    for (const [index, item] of ours.entries()) {
      const nested = firstDifference(item, theirs[index], [...prefix, String(index)])
      if (nested !== null) return nested
    }
    return null
  }
  if (ours !== null && typeof ours === 'object') {
    if (theirs === null || typeof theirs !== 'object' || Array.isArray(theirs)) return at
    for (const [key, value] of Object.entries(ours)) {
      if (!Object.hasOwn(theirs, key)) return `${at}.${key}（对方没有这个字段）`
      const nested = firstDifference(value, theirs[key], [...prefix, key])
      if (nested !== null) return nested
    }
    return null
  }
  return deepEqual(ours, theirs) ? null : at
}

/**
 * 汇总判定：插件定义现在由谁说了算。
 *
 * @param {{ ours: any, layers: ReadonlyArray<{ label: string, rows: ReadonlyArray<Record<string, any>> }> }} input
 *   ours 为本插件定义，layers 为 llm-pi-ai 之后应用的全部补丁层
 * @returns {{ kind: string, layer: string|null, difference: string|null }}
 *   kind 为 OWNERSHIP 中的取值；layer 为起作用的那一层标签；difference 为不一致字段路径
 */
export function classifyOwnership({ ours, layers }) {
  const found = shadowingDeclaration(layers)
  if (found === null) return { kind: OWNERSHIP.pluginLayer, layer: null, difference: null }
  if (found.dynamic) return { kind: OWNERSHIP.dynamic, layer: found.label, difference: null }
  if (found.declared === undefined) return { kind: OWNERSHIP.shadowed, layer: found.label, difference: null }
  if (agreesWith(ours, found.declared)) return { kind: OWNERSHIP.materialized, layer: found.label, difference: null }
  return { kind: OWNERSHIP.conflict, layer: found.label, difference: firstDifference(ours, found.declared) }
}
