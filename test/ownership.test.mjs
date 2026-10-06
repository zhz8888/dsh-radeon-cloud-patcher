#!/usr/bin/env node
/**
 * 所有权判定的回归测试。
 *
 * 这一组判据决定「插件到底启不启动」，四种结局都必须在测试里固定下来：
 * 定义只在插件层、被设置页物化的副本、被整份盖掉、用户自己维护了同 id 定义。
 * 判定全部是纯函数，因此不需要 DSH 运行时。
 *
 * 用法: node test/ownership.test.mjs
 */
import { agreesWith, classifyOwnership, firstDifference, OWNERSHIP } from '../src/ownership.js'
import { PROVIDER_KEY, TARGET_ENTRY_ID } from '../src/merge.js'

/** 本插件的定义（精简版，字段形状与 provider/radeon-cloud.yml 一致）。 */
const OURS = {
  apiKeyEnv: 'RADEON_CLOUD_API_KEY',
  api: 'openai-completions',
  baseURL: 'https://developer.amd.com.cn/radeon/api/v1',
  displayName: 'Radeon Cloud',
  reasoning: 'medium',
  compat: { supportsDeveloperReasoning: false, maxTokensField: 'max_tokens' },
  models: [
    { id: 'DeepSeek-V4.1-Flash', name: 'DeepSeek-V4.1-Flash', input: ['text', 'image'] },
    { id: 'MiniCPM5-2B', name: 'MiniCPM5-2B', reasoningEfforts: false },
  ],
}

/**
 * 造一层补丁。
 *
 * @param {string} label 层标签
 * @param {Array<Record<string, any>>} rows 补丁行
 * @returns {{ label: string, rows: Array<Record<string, any>> }} 补丁层
 */
const layer = (label, rows) => ({ label, rows })

/** 一份 llm-pi-ai 覆盖行。 */
const llmRow = (config) => ({ id: TARGET_ENTRY_ID, name: '@deepseek-ai/dsh-llm-pi-ai', config })

/** 判定一个用例的结局。 */
const verdictOf = (layers) => classifyOwnership({ ours: OURS, layers }).kind

/** 逐项检查结果。 */
const checks = []
/**
 * 登记一项检查。
 *
 * @param {string} label 检查项描述
 * @param {boolean} ok 是否通过
 */
const check = (label, ok) => checks.push([label, ok])

// ── classifyOwnership ──

check('之后各层都没碰 llm-pi-ai → 插件层生效',
  verdictOf([layer('profile', [{ id: 'desktop-shell', config: { mode: 'extended' } }])]) === OWNERSHIP.pluginLayer)

check('完全没有之后的层 → 插件层生效',
  verdictOf([]) === OWNERSHIP.pluginLayer)

check('之后的层只声明 insert → 插件层生效',
  verdictOf([layer('profile', [{ insert: [{ id: 'x', name: 'y' }] }])]) === OWNERSHIP.pluginLayer)

check('llm-pi-ai 的 config 里没有 providers → 被整份盖掉',
  verdictOf([layer('profile', [llmRow({})])]) === OWNERSHIP.shadowed)

check('providers 里没有本 provider → 被整份盖掉',
  verdictOf([layer('profile', [llmRow({ providers: { 'my-custom': { api: 'openai-completions' } } })])]) === OWNERSHIP.shadowed)

check('同 id 声明与本插件一致 → 视为设置页物化的副本',
  verdictOf([layer('profile', [llmRow({ providers: { [PROVIDER_KEY]: OURS } })])]) === OWNERSHIP.materialized)

check('物化副本带 schema 默认值噪声，仍视为一致',
  verdictOf([layer('profile', [llmRow({
    providers: {
      [PROVIDER_KEY]: {
        ...OURS,
        defaultInput: ['text'],
        headers: {},
        thinkingBudgets: {},
        modelOverrides: {},
        models: [...OURS.models].reverse().map((model) => ({ ...model, maxTokens: 32768 })),
      },
    },
  })])]) === OWNERSHIP.materialized)

check('模型列表多出一个 → 不一致',
  verdictOf([layer('profile', [llmRow({
    providers: { [PROVIDER_KEY]: { ...OURS, models: [...OURS.models, { id: 'GLM-5.3-Flash' }] } },
  })])]) === OWNERSHIP.conflict)

check('同 id 但端点不同 → id 冲突',
  verdictOf([layer('profile', [llmRow({
    providers: { [PROVIDER_KEY]: { ...OURS, baseURL: 'https://example.invalid/v1' } },
  })])]) === OWNERSHIP.conflict)

check('同 id 但缺字段 → id 冲突',
  verdictOf([layer('profile', [llmRow({
    providers: { [PROVIDER_KEY]: { apiKeyEnv: 'RADEON_CLOUD_API_KEY', api: 'openai-completions' } },
  })])]) === OWNERSHIP.conflict)

check('后一层覆盖前一层：home 覆盖 profile',
  verdictOf([
    layer('profile', [llmRow({ providers: { [PROVIDER_KEY]: OURS } })]),
    layer('home', [llmRow({ providers: {} })]),
  ]) === OWNERSHIP.shadowed)

check('config 是 !!js 表达式 → 无法静态判定',
  verdictOf([layer('profile', [llmRow({ __jsExpr: 'ctx => ({})' })])]) === OWNERSHIP.dynamic)

// ── 差异定位 ──

check('差异路径指名到字段',
  firstDifference(OURS, { ...OURS, baseURL: 'https://example.invalid/v1' }) === 'baseURL')

check('缺字段时说明是对方缺',
  (firstDifference(OURS, { ...OURS, reasoning: undefined }) ?? '').startsWith('reasoning'))

check('模型差异带模型 id',
  (firstDifference(OURS, { ...OURS, models: [OURS.models[0]] }) ?? '').includes('MiniCPM5-2B'))

check('完全一致时没有差异',
  firstDifference(OURS, OURS) === null)

// ── agreesWith ──

check('子集比较：对方多出字段不算冲突', agreesWith(OURS, { ...OURS, extra: 1 }))
check('子集比较：缺字段即冲突', !agreesWith(OURS, { ...OURS, compat: {} }))
check('标量不等即冲突', !agreesWith(OURS, { ...OURS, reasoning: 'high' }))
check('数组长度不同即冲突', !agreesWith({ list: [1, 2] }, { list: [1] }))
check('带 id 的数组按 id 对齐，顺序无关',
  agreesWith({ models: [{ id: 'a', x: 1 }, { id: 'b', x: 2 }] }, { models: [{ id: 'b', x: 2 }, { id: 'a', x: 1 }] }))
check('带 id 的数组缺项即冲突',
  !agreesWith({ models: [{ id: 'a', x: 1 }] }, { models: [{ id: 'b', x: 1 }] }))
check('boolean 与对象不可互认', !agreesWith({ flag: false }, { flag: {} }))

let failed = 0
for (const [label, ok] of checks) {
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${label}`)
}

console.log()
console.log(`共 ${checks.length} 项，未通过 ${failed} 项`)
if (failed > 0) process.exit(1)
console.log('✓ 所有权判定按预期区分四种结局')
