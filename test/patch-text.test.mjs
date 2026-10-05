#!/usr/bin/env node
/**
 * 文本级合并的回归测试。
 *
 * 重点是三件事：合并不破坏用户自己写的 provider、不破坏用户写在文件里的
 * 注释、重复执行不产生改动。
 *
 * 用法: node test/patch-text.test.mjs
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyProviderBlock, renderProfileBlock } from '../src/patch-text.js'
import { loadProfile, PROVIDER_KEY } from '../src/index.js'
import { validateProfile } from '../src/validate.js'

/** 本测试文件所在目录。 */
const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 本项目的 provider 定义。 */
const profile = loadProfile()

/** 一份带用户自有 provider 与注释的补丁文件。 */
const FIXTURE = [
  '# 用户自己维护的补丁文件',
  '- id: desktop-shell',
  '  name: dsh-plugin-desktop',
  '  config:',
  '    mode: extended',
  '',
  '# 合并前不该动这条注释',
  '- id: llm-pi-ai',
  '  name: "@deepseek-ai/dsh-llm-pi-ai"',
  '  config:',
  '    providers:',
  '      my-corp-proxy:',
  '        displayName: 公司内部代理',
  '        api: openai-completions',
  '        baseURL: https://llm.corp/v1',
  '        models:',
  '          - id: internal-model',
  '            contextWindow: 200000',
  '      another-one:',
  '        api: openai-completions',
  '        models:',
  '          - id: m2',
  '  # 合并后也不该动这条注释',
  '- id: agent-default-model',
  '  name: "@deepseek-ai/dsh-agent-default-model"',
  '  config:',
  '    provider: commandcode',
].join('\n')

const checks = []
const check = (label, ok) => checks.push([label, ok])

// ── 新增 ──
const added = applyProviderBlock(FIXTURE.split('\n'), profile, PROVIDER_KEY)
check('目标条目缺失时报告 absent',
  applyProviderBlock(['- id: other'], profile, PROVIDER_KEY).action === 'absent')
check('有 providers 时可新增', added.action === 'added')
check('新增后同级键为用户两项加本项目',
  added.others.join(',') === 'my-corp-proxy,another-one')
check('新增后仍含键行', added.lines.some((l) => l.trim() === `${PROVIDER_KEY}:`))
check('用户条目原文保留',
  added.lines.includes('      my-corp-proxy:') && added.lines.includes('      another-one:'))

// ── 注释 ──
check('合并前的注释保留', added.lines.includes('# 合并前不该动这条注释'))
check('合并后的注释保留', added.lines.includes('  # 合并后也不该动这条注释'))
check('用户文件首行注释保留', added.lines[0] === '# 用户自己维护的补丁文件')

// ── 其它条目 ──
const stripTarget = (lines) => {
  const start = lines.indexOf('- id: llm-pi-ai')
  const end = lines.findIndex((l, i) => i > start && l.startsWith('- id: '))
  return [...lines.slice(0, start), ...lines.slice(end === -1 ? lines.length : end)]
}
check('llm-pi-ai 之外的条目逐字保留',
  stripTarget(added.lines).join('\n') === stripTarget(FIXTURE.split('\n')).join('\n'))

// ── 幂等 ──
const second = applyProviderBlock(added.lines, profile, PROVIDER_KEY)
check('重复合并不产生改动', second.action === 'unchanged')
check('幂等时返回同一数组', second.lines === added.lines)

// ── 更新 ──
const drifted = [...added.lines]
const at = drifted.findIndex((l) => l.trim() === `${PROVIDER_KEY}:`)
drifted[at + 1] = '        displayName: 被人改过的名字'
const updated = applyProviderBlock(drifted, profile, PROVIDER_KEY)
check('内容漂移时更新', updated.action === 'updated')
check('更新后键行仍存在', updated.lines.some((l) => l.trim() === `${PROVIDER_KEY}:`))
check('更新只动本项目的键',
  updated.others.join(',') === 'my-corp-proxy,another-one'
  && updated.lines.includes('      my-corp-proxy:'))
check('更新后不含旧的错误值', !updated.lines.includes('被人改过的名字'))

// ── 渲染缩进 ──
const block = renderProfileBlock({ a: 1, b: { c: 2 } }, 6)
check('渲染块按指定缩进', block[0].startsWith('      ') && block.every((l) => l === '' || l.startsWith('      ')))

// ── 合并结果能通过定义校验 ──
check('合并内容符合定义校验', validateProfile(profile).length === 0)

let failed = 0
for (const [label, ok] of checks) {
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${label}`)
}
console.log()
console.log(`共 ${checks.length} 项，未通过 ${failed} 项`)
if (failed > 0) process.exit(1)
console.log('✓ 文本级合并不会破坏用户自有的 provider 与注释')