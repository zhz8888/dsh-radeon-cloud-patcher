#!/usr/bin/env node
/**
 * 合并行为的回归测试，重点覆盖「不破坏用户自行添加的 provider」。
 *
 * DSH 的补丁是整体替换而不是合并，因此若改用替换式写法，用户在 llm-pi-ai
 * 下自行添加的路由会被一并抹掉。本测试把这一场景固定下来。
 *
 * 用法: node test/merge.test.mjs
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PROVIDER_KEY,
  TARGET_ENTRY_ID,
  applyToPatch,
  deepEqual,
  otherProviderRoutes,
  readTargetProviders,
} from '../src/merge.js'

/** 本测试文件所在目录。 */
const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 本项目的 provider 定义，作为合并的「期望值」。 */
const OUR_PROFILE = readFileSync(path.join(HERE, '..', 'provider', 'radeon-cloud.yml'), 'utf8')

/** 用最小的 YAML 解析器取出本项目定义的内容；避免为测试引入依赖。 */
function parseOurProfile(text) {
  // 该文件是纯 YAML 映射，借助 DSH 应用包内的 yaml 解析器读取。
  return parseYaml(text)
}

/** 由下方动态注入的 YAML 解析函数。 */
let parseYaml = () => {
  throw new Error('YAML 解析器未注入')
}

/** 载入 DSH 应用包内的 yaml 模块并注入解析函数。 */
async function loadYaml() {
  const { parse } = await import(
    '/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/yaml/dist/index.js'
  )
  parseYaml = parse
}

/** 构造一份与用户环境同构的补丁条目列表。 */
function makeEntries(providers) {
  return [
    { id: 'desktop-shell', name: 'dsh-plugin-desktop', config: { mode: 'extended' } },
    { id: TARGET_ENTRY_ID, name: '@deepseek-ai/dsh-llm-pi-ai', config: { providers } },
    { id: 'agent-default-model', name: '@deepseek-ai/dsh-agent-default-model', config: { provider: 'commandcode' } },
  ]
}

await loadYaml()
const profile = parseOurProfile(OUR_PROFILE)

const checks = []
const check = (label, ok) => checks.push([label, ok])

// ── 1. 空目录：应当新增 ──
{
  const { entries, action } = applyToPatch(makeEntries({}), profile)
  const providers = readTargetProviders(entries)
  check('空目录时新增 radeon-cloud', action === 'added' && Object.hasOwn(providers, PROVIDER_KEY))
  check('新增后内容与定义一致', deepEqual(providers[PROVIDER_KEY], profile))
}

// ── 2. 关键场景：用户已有其它 provider，必须一个都不少 ──
{
  const userProviders = {
    'my-openai': { api: 'openai-completions', baseURL: 'https://api.example.com/v1', models: [{ id: 'gpt-x' }] },
    'internal-gateway': {
      api: 'openai-completions',
      baseURL: 'https://gw.corp/v1',
      compat: { supportsDeveloperRole: true },
      retryPolicy: { mode: 'always' },
      models: [{ id: 'm1' }, { id: 'm2' }],
    },
  }
  const { entries, action } = applyToPatch(makeEntries({ ...userProviders }), profile)
  const providers = readTargetProviders(entries)
  check('已有 provider 时新增 radeon-cloud', action === 'added')
  check('用户 provider 数量未变', Object.keys(providers).length === Object.keys(userProviders).length + 1)
  check('用户 provider 逐字保留', deepEqual(providers['my-openai'], userProviders['my-openai']))
  check('用户 provider 的嵌套结构完整保留',
    deepEqual(providers['internal-gateway'], userProviders['internal-gateway']))
  check('残留路由清单正确', deepEqual(otherProviderRoutes(entries).sort(), ['internal-gateway', 'my-openai']))
}

// ── 3. 幂等：内容一致时不应产生写入 ──
{
  const first = applyToPatch(makeEntries({ 'other': { api: 'openai-completions' } }), profile)
  const second = applyToPatch(first.entries, profile)
  check('重复合并不产生改动', second.action === 'unchanged')
  check('幂等时返回同一引用（未复制）', second.entries === first.entries)
}

// ── 4. 已有旧版 radeon-cloud：应更新，且不影响同级 ──
{
  const current = { [PROVIDER_KEY]: { displayName: '旧名称', baseURL: 'https://old' }, mine: { api: 'openai-completions' } }
  const { entries, action } = applyToPatch(makeEntries(current), profile)
  const providers = readTargetProviders(entries)
  check('旧版 radeon-cloud 被更新', action === 'updated')
  check('更新后内容与定义一致', deepEqual(providers[PROVIDER_KEY], profile))
  check('同级 provider 未受影响', deepEqual(providers.mine, current.mine))
}

// ── 5. 其它补丁条目不受影响 ──
{
  const before = makeEntries({ mine: { api: 'openai-completions' } })
  const after = applyToPatch(before, profile).entries
  const others = (list) => list.filter((e) => e.id !== TARGET_ENTRY_ID)
  check('llm-pi-ai 之外的条目逐字保留', deepEqual(others(before), others(after)))
}

// ── 6. 缺少 llm-pi-ai 条目时不崩溃、不自建 ──
{
  const entries = [{ id: 'desktop-shell', config: {} }]
  const result = applyToPatch(entries, profile)
  check('目标条目缺失时原样返回', result.action === 'absent' && result.entries === entries)
}

// ── 7. 空字典的字段形态 ──
{
  const current = readTargetProviders([{ id: TARGET_ENTRY_ID }])
  check('条目无 config 时返回空字典', deepEqual(current, {}))
}

let failed = 0
for (const [label, ok] of checks) {
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${label}`)
}

console.log()
console.log(`共 ${checks.length} 项，未通过 ${failed} 项`)
if (failed > 0) process.exit(1)
console.log('✓ 合并不会影响用户自行添加的 provider')