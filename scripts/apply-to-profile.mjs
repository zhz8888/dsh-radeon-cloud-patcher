#!/usr/bin/env node
/**
 * 把 provider 定义合并进 DSH profile 的 cordis.patch.yml。
 *
 * 合并粒度是**键**：只新增或替换 llm-pi-ai 下 providers.radeon-cloud 这一个键，
 * 同一命名空间下用户自行添加的其它 provider 原样保留。
 *
 * 采用文本级编辑而非「解析后整体序列化」，是为了不破坏用户补丁文件里的
 * 注释、缩进风格与键序——那是用户自己在维护的文件。
 *
 * 写盘前逐项断言，任一不成立即中止且不落盘：
 *   - 目标条目 llm-pi-ai 存在，且其中含 providers 映射；
 *   - 合并前后，除 radeon-cloud 外的同级 provider 键集合完全一致；
 *   - llm-pi-ai 之外的每个顶层条目逐字符未变；
 *   - 合并后 providers 下确实出现 radeon-cloud 键。
 *
 * 已经存在同 id 定义时**不静默覆盖**：若那份定义与真源不一致，命令直接失败并打印
 * 第一处差异，由使用者决定是删除它还是用 --force 覆盖。这条规则与插件启动时的
 * 看护是同一件事的两端：id 冲突要响亮，不要悄悄接管。
 *
 * 用法:
 *   node scripts/apply-to-profile.mjs --dry-run     只演练不写盘
 *   node scripts/apply-to-profile.mjs               写入默认 profile
 *   node scripts/apply-to-profile.mjs <某个文件>    针对指定文件执行
 *   node scripts/apply-to-profile.mjs --force       允许覆盖不一致的同 id 定义
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyProviderBlock } from '../src/patch-text.js'
import { loadProfile, PROVIDER_KEY, TARGET_ENTRY_ID } from '../src/index.js'
import { loadYaml } from '../src/yaml.js'
import { agreesWith, firstDifference } from '../src/ownership.js'

/** 本脚本文件所在目录。 */
const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 仓库根目录。 */
const ROOT = path.resolve(HERE, '..')
/** 命令行参数列表。 */
const argv = process.argv.slice(2)
/** 是否只演练不写盘。 */
const dryRun = argv.includes('--dry-run')
/** 是否允许覆盖不一致的同 id 定义。 */
const force = argv.includes('--force')
/** 第一个非选项参数，作为目标文件路径；未给出则用默认 profile。 */
const explicit = argv.find((a) => !a.startsWith('--'))

/** 待修改的 profile 补丁文件。 */
const TARGET = explicit
  ?? path.join(process.env.HOME, '.dsh/profiles/desktop/cordis.patch.yml')

if (!existsSync(TARGET)) {
  console.error(`✗ 找不到目标文件：${TARGET}`)
  process.exit(1)
}

/** 待写入的 provider 定义，来自本项目的唯一真源。 */
const profile = loadProfile(path.join(ROOT, 'provider', 'radeon-cloud.yml'))

/**
 * 读出目标文件里已经存在的本 provider 声明。
 *
 * 解析不了时返回 undefined 而不是抛错：补丁文件坏了 DSH 会先失败，
 * 这里不必抢在它前面把真正的原因埋掉。
 *
 * @returns {Record<string, any>|undefined} 既有的 provider 定义
 */
function existingDeclaration() {
  const { parse } = loadYaml()
  try {
    const parsed = parse(readFileSync(TARGET, 'utf8'))
    if (!Array.isArray(parsed)) return undefined
    const row = parsed
      .filter((item) => item?.id === TARGET_ENTRY_ID && item.insert === undefined && item.config !== undefined)
      .pop()
    return row?.config?.providers?.[PROVIDER_KEY]
  } catch {
    return undefined
  }
}

const declared = existingDeclaration()
if (declared !== undefined && !agreesWith(profile, declared) && !force) {
  console.error(`✗ profile 里已有一份与本插件不一致的 providers.${PROVIDER_KEY}，已拒绝覆盖：${TARGET}`)
  console.error(`  第一处差异：${firstDifference(profile, declared)}`)
  console.error('')
  console.error('两种处置：')
  console.error('  · 交给本插件管理：先手工删掉那段定义，再重跑本命令；')
  console.error('  · 确认要覆盖它：加 --force。')
  process.exit(1)
}
if (declared !== undefined && !agreesWith(profile, declared) && force) {
  console.log(`⚠ 既有定义与本插件不一致（${firstDifference(profile, declared)}），按 --force 覆盖`)
}

/** 目标文件切分后的全部行。 */
const before = readFileSync(TARGET, 'utf8').split('\n')

/**
 * 取出所有顶层条目的 id，保持出现顺序。
 *
 * @param {string[]} lines 按行切分的文件内容
 * @returns {string[]} 条目 id 列表
 */
const idsOf = (lines) => lines.filter((l) => l.startsWith('- id: ')).map((l) => l.slice('- id: '.length).trim())

/**
 * 定位某个顶层条目在行数组中的区间。
 *
 * @param {string[]} lines 按行切分的文件内容
 * @param {string} id 条目 id
 * @returns {[number, number]|null} 左闭右开的起止下标；不存在时返回 null
 */
function rangeOf(lines, id) {
  const start = lines.indexOf(`- id: ${id}`)
  if (start === -1) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('- id: ')) { end = i; break }
  }
  return [start, end]
}

/** 取出某条目内 providers 下的直接子键名。 */
const childKeys = (lines, id) => {
  const range = rangeOf(lines, id)
  if (range === null) return []
  const [, end] = range
  let at = -1
  for (let i = range[0]; i < end; i++) {
    if (/^\s*providers:\s*$/.test(lines[i])) { at = i; break }
  }
  if (at === -1) return []
  const width = lines[at].match(/^ */)[0].length + 2
  const keys = []
  for (let i = at + 1; i < end; i++) {
    const line = lines[i]
    if (line.trim() === '') continue
    const pad = line.match(/^ */)[0].length
    if (pad < width) break
    if (pad === width) {
      const m = line.trim().match(/^([A-Za-z0-9_][\w.-]*):(\s|$)/)
      if (m) keys.push(m[1])
    }
  }
  return keys
}

const result = applyProviderBlock(before, profile, PROVIDER_KEY, TARGET_ENTRY_ID)

if (result.action === 'absent') {
  console.error(`✗ 目标文件里找不到可合并的位置：需要一条 id 为 ${TARGET_ENTRY_ID} 且含 providers 的条目。`)
  console.error('  本项目不负责创建 llm-pi-ai 行，它是 DSH 自带的。')
  process.exit(1)
}

// ── 断言：任一不成立即中止，不写盘 ──
const after = result.lines
const problems = []
const beforeIds = idsOf(before)
const afterIds = idsOf(after)
if (beforeIds.join(',') !== afterIds.join(',')) problems.push('顶层条目的增删或顺序发生了变化')
for (const id of beforeIds) {
  if (id === TARGET_ENTRY_ID) continue
  const a = rangeOf(before, id)
  const b = rangeOf(after, id)
  if (a === null || b === null || before.slice(...a).join('\n') !== after.slice(...b).join('\n')) {
    problems.push(`条目 ${id} 的内容被意外改动`)
  }
}
const beforeKeys = childKeys(before, TARGET_ENTRY_ID)
const afterKeys = childKeys(after, TARGET_ENTRY_ID)
const keptBefore = beforeKeys.filter((k) => k !== PROVIDER_KEY).sort().join(',')
const keptAfter = result.others.slice().sort().join(',')
if (keptBefore !== keptAfter) problems.push('合并后同级 provider 键集合与合并前不一致')
if (!afterKeys.includes(PROVIDER_KEY)) problems.push(`合并结果里没有 ${PROVIDER_KEY}`)

if (problems.length > 0) {
  console.error('✗ 断言失败，未写盘：')
  for (const p of problems) console.error(`   ${p}`)
  process.exit(1)
}

const actionText = { added: '新增', updated: '更新', unchanged: '已是最新', absent: '未处理' }[result.action]
console.log(`${dryRun ? '【演练】' : '【写入】'} ${TARGET}`)
console.log(`  ${actionText} providers.${PROVIDER_KEY}（${profile.models?.length ?? 0} 个模型）`)
console.log(`  保留的其它 provider：${result.others.length ? result.others.join(', ') : '（无）'}`)
console.log(`  顶层条目 ${beforeIds.length} 个，增减 ${afterIds.length - beforeIds.length} 个`)

if (dryRun) {
  console.log('\n--- 合并后 providers 下的同级键 ---')
  console.log('  ' + afterKeys.join('\n  '))
  process.exit(0)
}

/** 备份文件名的时间戳，去掉冒号与点以便用于文件名。 */
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
/** 备份文件路径。 */
const backup = `${TARGET}.bak-${stamp}`
copyFileSync(TARGET, backup)
console.log(`  已备份：${backup}`)
writeFileSync(TARGET, after.join('\n'))
console.log('✓ 写入完成')