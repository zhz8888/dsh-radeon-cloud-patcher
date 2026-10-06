#!/usr/bin/env node
/**
 * 插件入口的看护行为测试。
 *
 * 这里跑的是 src/index.js 的 apply()：它决定插件启不启动，因此四种结局都要钉住
 * ——干净生效、被设置页物化的副本、被 profile 配置整份盖掉、以及用户自己维护了
 * 一份同 id 定义（需求里的「id 冲突 → 启动失败并说明原因」）。
 *
 * 补丁文件写在临时目录里，不碰本机 profile；apply 拿不到 DSH 的 schema 时会
 * 告警后继续（那正是它在真实环境里解析不到 llm-pi-ai 时的降级路径）。
 *
 * 用法: node test/apply-guard.test.mjs
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { apply, loadProfile, PROVIDER_KEY } from '../src/index.js'

/** 本插件的定义。 */
const OURS = loadProfile()
/** 存放临时补丁文件的目录。 */
const SCRATCH = mkdtempSync(path.join(tmpdir(), 'radeon-cloud-guard-'))

/**
 * 写一份临时补丁文件。
 *
 * @param {string} name 文件名
 * @param {Array<Record<string, any>>} rows 补丁行
 * @returns {string} 文件绝对路径
 */
function writePatch(name, rows) {
  const file = path.join(SCRATCH, name)
  writeFileSync(file, JSON.stringify(rows, null, 2))
  return file
}

/**
 * 造一个只满足 apply 需要的上下文桩。
 *
 * @param {string|null} patchPath profile 补丁路径
 * @returns {Record<string, any>} 上下文桩，附带收集到的日志
 */
function stubContext(patchPath) {
  const logs = { info: [], warn: [], error: [] }
  return {
    logs,
    get: (key) => (key === 'profileContext' && patchPath !== null
      ? { patchPath, home: path.join(SCRATCH, 'no-such-home') }
      : undefined),
    logger: {
      info: (message) => logs.info.push(message),
      warn: (message) => logs.warn.push(message),
      error: (message) => logs.error.push(message),
    },
    llm: { listProviders: () => [] },
  }
}

/**
 * 跑一次 apply，收集结果。
 *
 * @param {string|null} patchPath profile 补丁路径
 * @returns {Promise<{ error: Error|null, logs: Record<string, string[]> }>} 结果
 */
async function run(patchPath) {
  const ctx = stubContext(patchPath)
  try {
    await apply(ctx)
    return { error: null, logs: ctx.logs }
  } catch (error) {
    return { error, logs: ctx.logs }
  }
}

/** 逐项检查结果。 */
const checks = []
/**
 * 登记一项检查。
 *
 * @param {string} label 检查项描述
 * @param {boolean} ok 是否通过
 */
const check = (label, ok) => checks.push([label, ok])

// ── 干净生效 ──
const clean = await run(writePatch('clean.json', [{ id: 'desktop-shell', config: { mode: 'extended' } }]))
check('profile 没碰 llm-pi-ai 时正常启动', clean.error === null)
check('启动日志说明定义来自本插件的补丁层',
  clean.logs.info.some((line) => line.includes('校验通过') && line.includes('补丁层')))
check('定义通过了 llm-pi-ai 真实 schema 的校验（没有降级为只做结构校验）',
  !clean.logs.warn.some((line) => line.includes('拿不到 llm-pi-ai')))

// ── 设置页物化的副本（与本插件一致）──
const mirrored = await run(writePatch('mirrored.json', [
  { id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai', config: { providers: { [PROVIDER_KEY]: OURS } } },
]))
check('profile 里那份与本插件一致的声明被放过', mirrored.error === null)
check('放过时留一条提醒，说明卸载后会残留',
  mirrored.logs.info.some((line) => line.includes('一致的') && line.includes('卸载')))

// ── 被整份盖掉 ──
const shadowed = await run(writePatch('shadowed.json', [
  { id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai', config: { providers: { 'my-custom': { api: 'openai-completions' } } } },
]))
check('profile 覆盖了 llm-pi-ai 却没有本 provider → 启动失败', shadowed.error !== null)
check('失败原因说明「未生效」', shadowed.error?.message.includes('未生效') === true)
check('失败原因给出合并命令',
  shadowed.error?.message.includes('apply-to-profile.mjs') === true
  && shadowed.error?.message.includes('shadowed.json') === true)

// ── 同 id 定义冲突 ──
const conflict = await run(writePatch('conflict.json', [
  {
    id: 'llm-pi-ai',
    name: '@deepseek-ai/dsh-llm-pi-ai',
    config: { providers: { [PROVIDER_KEY]: { ...OURS, baseURL: 'https://example.invalid/v1' } } },
  },
]))
check('同 id 但定义不同 → 启动失败（id 冲突）', conflict.error !== null)
check('失败原因写明是 id 冲突', conflict.error?.message.includes('id 冲突') === true)
check('失败原因指名第一处差异字段', conflict.error?.message.includes('baseURL') === true)
check('失败原因给出「删除该定义」与「卸载插件」两条路',
  conflict.error?.message.includes('卸载本插件') === true)

// ── 拿不到 profileContext ──
const noContext = await run(null)
check('拿不到 profileContext 时不阻断加载', noContext.error === null)
check('跳过所有权判定时留告警',
  noContext.logs.warn.some((line) => line.includes('跳过所有权判定')))

rmSync(SCRATCH, { recursive: true, force: true })

let failed = 0
for (const [label, ok] of checks) {
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${label}`)
}

console.log()
console.log(`共 ${checks.length} 项，未通过 ${failed} 项`)
if (failed > 0) process.exit(1)
console.log('✓ 启动看护按预期放行、失败并说明原因')
