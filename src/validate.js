/**
 * provider 定义的结构校验。
 *
 * 用途：让「配置写错了」和「配置过时了」这两类问题在启动时响亮地失败，
 * 而不是让思考功能悄无声息地失效。
 *
 * 能力边界（重要，不要高估）：
 *   - 本模块校验的是**本项目自己的定义**是否符合已知形状：必填项是否齐全、
 *     类型是否正确、模型条目是否可用、思考档位声明是否自洽。
 *   - 它**不能**发现上游 llm-pi-ai 把某个字段改了名。判断某字段在当前 DSH
 *     版本里是否仍然有效，需要用 llm-pi-ai 真实的 schema 校验，那只能在
 *     能解析 DSH 应用包的进程里做——即 `npm run validate`（脚本在插件之外，
 *     按应用包绝对路径加载真实 schema）。插件运行在 DSH 内部，而 DSH 的包在
 *     profile 的 node_modules 里不可解析，因此运行时拿不到那个 schema。
 *
 * 两道校验的分工：本模块守「写对」，npm run validate 守「仍然有效」。
 */

/**
 * 必填的标量字段及其期望类型。缺失或类型不符都会报出。
 * @type {ReadonlyArray<[string, (value: unknown) => boolean, string]>}
 */
const REQUIRED_SCALARS = [
  ['apiKeyEnv', (v) => typeof v === 'string' && v.length > 0, '必须是非空字符串'],
  ['api', (v) => typeof v === 'string' && v.length > 0, '必须是非空字符串'],
  ['baseURL', (v) => typeof v === 'string' && /^https?:\/\//.test(v), '必须是 http(s) 开头的 URL'],
  ['displayName', (v) => typeof v === 'string' && v.length > 0, '必须是非空字符串'],
]

/**
 * 检查一个模型条目的思考档位声明是否自洽。
 *
 * @param {Record<string, any>} model 模型条目
 * @param {string} modelId 模型 id，用于报错定位
 * @param {string[]} out 收集到的问题
 */
function checkEfforts(model, modelId, out) {
  const efforts = model.reasoningEfforts
  // 缺省或显式 false 都合法：前者沿用内置目录，后者表示该模型不返回分离思考。
  if (efforts === undefined || efforts === false) return
  if (typeof efforts !== 'object' || efforts === null || Array.isArray(efforts)) {
    out.push(`模型 ${modelId} 的 reasoningEfforts 必须是对象或 false`)
    return
  }
  const entries = Object.entries(efforts)
  if (entries.length === 0) {
    out.push(`模型 ${modelId} 的 reasoningEfforts 是空对象，会让思考档位控件渲染为空`)
    return
  }
  const beyondOff = entries.filter(([level]) => level !== 'off')
  if (beyondOff.length === 0) {
    out.push(`模型 ${modelId} 的 reasoningEfforts 只声明了 off，没有可供选择的思考档位`)
  }
  for (const [level, wire] of entries) {
    // 只有 off 允许留空，其余档位必须给出线上拼写，否则派发时会发出 undefined。
    if (level === 'off') {
      if (wire !== null && typeof wire !== 'string') {
        out.push(`模型 ${modelId} 的档位 off 的取值必须是字符串或留空`)
      }
      continue
    }
    if (typeof wire !== 'string' || wire.length === 0) {
      out.push(`模型 ${modelId} 的档位 ${level} 缺少线上拼写，只有 off 可以留空`)
    }
  }
}

/**
 * 校验一个模型条目。
 *
 * @param {unknown} model 待校验条目
 * @param {number} index 在 models 数组中的下标
 * @param {string[]} out 收集到的问题
 */
function checkModel(model, index, out) {
  if (model === null || typeof model !== 'object' || Array.isArray(model)) {
    out.push(`models[${index}] 不是对象`)
    return
  }
  if (typeof model.id !== 'string' || model.id.length === 0) {
    out.push(`models[${index}] 缺少 id`)
    return
  }
  const id = model.id
  if (model.contextWindow !== undefined
    && (!Number.isSafeInteger(model.contextWindow) || model.contextWindow <= 0)) {
    out.push(`模型 ${id} 的 contextWindow 必须是正整数`)
  }
  if (model.input !== undefined) {
    const ok = Array.isArray(model.input) && model.input.length > 0
      && model.input.every((m) => m === 'text' || m === 'image')
    if (!ok) out.push(`模型 ${id} 的 input 只能由 'text' 与 'image' 组成且不可为空`)
  }
  checkEfforts(model, id, out)
}

/**
 * 校验一份 provider 定义。
 *
 * @param {unknown} profile 待校验的 provider 定义
 * @returns {{ field: string, message: string }[]} 问题列表；为空表示校验通过
 */
export function validateProfile(profile) {
  const out = []
  if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) {
    return [{ field: '(根)', message: 'provider 定义必须是对象' }]
  }
  for (const [field, ok, expect] of REQUIRED_SCALARS) {
    if (!ok(profile[field])) out.push({ field, message: `缺失或无效，${expect}` })
  }
  if (profile.models === undefined) {
    out.push({ field: 'models', message: '缺失，模型选择器将不会出现任何模型' })
  } else if (!Array.isArray(profile.models)) {
    out.push({ field: 'models', message: '必须是数组' })
  } else if (profile.models.length === 0) {
    out.push({ field: 'models', message: '为空，模型选择器不会出现任何模型' })
  } else {
    const seen = new Set()
    profile.models.forEach((model, index) => {
      checkModel(model, index, out)
      const id = model?.id
      if (typeof id === 'string' && seen.has(id)) {
        out.push({ field: `models[${index}]`, message: `模型 id ${id} 重复` })
      }
      if (typeof id === 'string') seen.add(id)
    })
  }
  if (profile.compat !== undefined
    && (profile.compat === null || typeof profile.compat !== 'object' || Array.isArray(profile.compat))) {
    out.push({ field: 'compat', message: '必须是对象' })
  }
  // 关掉 developer 角色是这套配置能工作的前提，缺失时多模型会直接返回 400。
  if (profile.compat?.supportsDeveloperRole !== false) {
    out.push({
      field: 'compat.supportsDeveloperRole',
      message: '必须显式设为 false，多数模型拒绝 developer 角色',
    })
  }
  return out
}

/**
 * 把问题列表渲染成可读文本。
 *
 * @param {ReadonlyArray<{ field: string, message: string }>} problems 问题列表
 * @returns {string[]} 每项一行的描述
 */
export function describeIssues(problems) {
  return problems.map((p) => `${p.field}：${p.message}`)
}