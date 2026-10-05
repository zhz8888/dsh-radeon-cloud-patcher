/**
 * 把 Radeon Cloud 的 provider 定义合并进 llm-pi-ai 的 providers 字典。
 *
 * 背景：DSH 的补丁是「整体替换」而不是「合并」。若直接用一段非 insert 补丁
 * 改写 llm-pi-ai 的 config，用户在该命名空间下自行添加的其它 provider 会被
 * 一并抹掉。因此这里改为在**键的粒度**上合并——只新增或覆盖
 * `providers.radeon-cloud` 这一个键，其余同级键原样保留。
 *
 * 本模块不导入任何 DSH 模块，全部是纯函数，便于独立测试。
 */

/** 本项目写入 providers 字典时使用的键名。 */
export const PROVIDER_KEY = 'radeon-cloud'

/** 目标插件行在补丁文件中的 id，同时也是它的 settings 命名空间。 */
export const TARGET_ENTRY_ID = 'llm-pi-ai'

/**
 * 结构化相等比较，只比较 JSON 可表达的值。
 *
 * @param {unknown} a 左值
 * @param {unknown} b 右值
 * @returns {boolean} 两者是否深度相等
 */
export function deepEqual(a, b) {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return false
  if (typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false
    return a.every((item, index) => deepEqual(item, b[index]))
  }
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  return keysA.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]))
}

/**
 * 取出补丁列表中 llm-pi-ai 条目的 config.providers。
 *
 * @param {ReadonlyArray<Record<string, any>>} entries 补丁条目数组
 * @returns {Record<string, any>} providers 字典；条目或 providers 不存在时返回空对象
 */
export function readTargetProviders(entries) {
  const entry = entries.find((item) => item?.id === TARGET_ENTRY_ID)
  const providers = entry?.config?.providers
  return providers !== null && typeof providers === 'object' ? providers : {}
}

/**
 * 把 providers 字典改写为「仅把 radeon-cloud 设为 desired」的版本。
 *
 * 只触碰 PROVIDER_KEY 这一个键：存在的同名键被覆盖，其余键连同其嵌套结构
 * 一并原样保留。新对象不修改入参。
 *
 * @param {Record<string, any>} current 当前 providers 字典
 * @param {Record<string, any>} desired 本项目定义的 provider
 * @returns {{ merged: Record<string, any>, action: 'absent'|'unchanged'|'added'|'updated' }}
 *   merged 为合并结果；action 说明本次合并的动作，便于调用方决定是否落盘
 */
export function mergeProviderProfile(current, desired) {
  const existed = Object.hasOwn(current, PROVIDER_KEY)
  if (existed && deepEqual(current[PROVIDER_KEY], desired)) {
    return { merged: current, action: 'unchanged' }
  }
  return {
    merged: { ...current, [PROVIDER_KEY]: desired },
    action: existed ? 'updated' : 'added',
  }
}

/**
 * 按合并结果改写补丁列表中的 llm-pi-ai 条目。
 *
 * 条目不存在时不做任何改动——本项目不负责创建 llm-pi-ai 行，那是 DSH 自带的。
 * 条目存在但没有 config.providers 时补出空字典后再合并。
 *
 * @param {ReadonlyArray<Record<string, any>>} entries 补丁条目数组
 * @param {Record<string, any>} desired 本项目定义的 provider
 * @returns {{ entries: Array<Record<string, any>>, action: 'absent'|'unchanged'|'added'|'updated' }}
 */
export function applyToPatch(entries, desired) {
  const index = entries.findIndex((item) => item?.id === TARGET_ENTRY_ID)
  if (index === -1) return { entries, action: 'absent' }
  const current = readTargetProviders(entries)
  const { merged, action } = mergeProviderProfile(current, desired)
  if (action === 'unchanged') return { entries, action }
  const entry = entries[index]
  const config = entry.config !== null && typeof entry.config === 'object' ? entry.config : {}
  const next = [...entries]
  next[index] = {
    ...entry,
    config: { ...config, providers: merged },
  }
  return { entries: next, action }
}

/**
 * 列出合并后仍然存在、且不属于本项目的 provider 路由名。
 *
 * 用于安装后的自检与日志：确认用户原有的路由一个都没少。
 *
 * @param {ReadonlyArray<Record<string, any>>} entries 合并后的补丁条目数组
 * @returns {string[]} 除 radeon-cloud 之外的 provider 路由名
 */
export function otherProviderRoutes(entries) {
  return Object.keys(readTargetProviders(entries)).filter((name) => name !== PROVIDER_KEY)
}