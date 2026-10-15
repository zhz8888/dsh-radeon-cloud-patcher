#!/usr/bin/env node
/**
 * 「插件」页显示名称的契约测试。
 *
 * 背景：DSH 的插件页标题取自包内的 locale 文件——`readPluginMeta`（dsh-app-boot）
 * 会解析 `<包名>/locale/en.json`，把其中的 `meta.title` / `meta.description`
 * 按语言收成一张表，前端再按当前语言取值；**取不到就回落到 package.json 的
 * `name`**，也就是把整个 npm 包名原样显示在插件页上。
 *
 * 这个回落全程没有任何报错，因此是一件典型的静默失效：
 *
 *   - 少了 `exports` 里的 `./locale/*.json` 模式 → Node 解析抛
 *     ERR_PACKAGE_PATH_NOT_EXPORTED，被 `optionalResourcePath` 吞掉 → 回落；
 *   - 少了 `locale/en.json` → 整个目录扫描被跳过（只有 en 存在才会去读同目录
 *     的其它语言文件），zh.json 写得再好也不生效；
 *   - `files` 里漏了 `locale` → 本地全绿，发到 npm 的包里却没有这些文件。
 *
 * 三种都只在用户的插件页上表现为「名字不好看」，测试不覆盖就没人会发现。
 *
 * 校验方式分两层，区别要清楚：
 *   - 解析那一层走 Node 真实的 `exports` 解析（包自引用），与 DSH 调
 *     `loader.resolveSync` 是同一条路径，不是重写一份模式匹配；
 *   - 语言表的组装与取值按 `localizedText` / `resolveText` 的语义复刻，
 *     这层是模拟，但它只决定「显示成哪一句」，不影响上面那条解析结论。
 *
 * 用法: node test/plugin-meta.test.mjs
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 本测试文件所在目录。 */
const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 仓库根目录。 */
const ROOT = path.resolve(HERE, '..')
/** 本包的清单。 */
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
/** 语言文件名必须符合的形态，取自 DSH 的 LANGUAGE_ID。 */
const LANGUAGE_ID = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u

/** 逐项检查结果。 */
const checks = []
/**
 * 登记一项检查。
 *
 * @param {string} label 检查项描述
 * @param {boolean} ok 是否通过
 */
const check = (label, ok) => checks.push([label, ok])

/**
 * 按 DSH 的路径解析 `<包名>/<子路径>`，走 Node 真实的 exports 解析。
 *
 * @param {string} subpath 形如 /locale/en.json 的包内子路径
 * @returns {string|undefined} 解析到的绝对路径；解析失败时 undefined
 */
function resolveInPackage(subpath) {
  try {
    return fileURLToPath(import.meta.resolve(`${manifest.name}${subpath}`))
  } catch {
    return undefined
  }
}

/**
 * 读取一个 locale 文件并校验其形状。
 *
 * @param {string} file 绝对路径
 * @returns {{ok: boolean, reason?: string, meta?: {title?: string, description?: string}}} 校验结果
 */
function readLocale(file) {
  /** 语言文件名不合规时 DSH 会直接抛错，整个元信息退化成一条错误提示。 */
  const language = path.basename(file, '.json')
  if (!LANGUAGE_ID.test(language)) return { ok: false, reason: `文件名 ${language} 不是语言 id` }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    return { ok: false, reason: `不是合法 JSON：${String(err)}` }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: '顶层必须是对象' }
  }
  const meta = parsed.meta
  if (meta === undefined) return { ok: true, meta: {} }
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) {
    return { ok: false, reason: 'meta 必须是对象' }
  }
  // textOf 的判据：空串或纯空白同样会抛错，不只是类型不符。
  for (const field of ['title', 'description']) {
    const value = meta[field]
    if (value === undefined) continue
    if (typeof value !== 'string' || value.trim() === '') {
      return { ok: false, reason: `meta.${field} 必须是非空字符串` }
    }
  }
  return { ok: true, meta }
}

const localeDir = path.join(ROOT, 'locale')
const localeFiles = existsSync(localeDir)
  ? readdirSync(localeDir).filter((name) => name.endsWith('.json')).map((name) => path.join(localeDir, name))
  : []

check('locale/ 目录存在', existsSync(localeDir))
// 只有 en.json 能被解析时，DSH 才会去扫同目录的其它语言文件。
check('locale/en.json 存在（它是整目录扫描的开关）', existsSync(path.join(localeDir, 'en.json')))
check('locale/ 里至少有 en.json 与 zh.json', localeFiles.length >= 2)

// ── 解析那一层：走真实 exports ──
const resolvedEnglish = resolveInPackage('/locale/en.json')
check(`${manifest.name}/locale/en.json 能经 exports 解析（缺 ./locale/*.json 模式会静默回落）`,
  resolvedEnglish !== undefined)
check('解析结果指向真实存在的文件', resolvedEnglish !== undefined && existsSync(resolvedEnglish))

// 每个语言文件都必须能各自被解析到：漏一个，那种语言就会回落成 npm 包名。
/** 经 exports 解析失败的语言文件。 */
const unreachable = localeFiles
  .map((file) => path.basename(file))
  .filter((name) => resolveInPackage(`/locale/${name}`) === undefined)
check(`locale/ 下每个语言文件都能经 exports 解析（不可达：${unreachable.join(', ') || '无'}）`,
  unreachable.length === 0)

check('locale 在 files 白名单里（否则发到 npm 的包里没有它）',
  (manifest.files ?? []).includes('locale'))
check('exports 里声明了 ./locale/*.json 模式',
  typeof manifest.exports?.['./locale/*.json'] === 'string')

// ── 形状那一层：按 DSH 的读取规则校验每个语言文件 ──
/** 语言 id → 该语言的 title 取值。 */
const titles = new Map()
/** 语言 id → 该语言的 description 取值。 */
const descriptions = new Map()
/** 读取失败的说明。 */
const malformed = []
for (const file of localeFiles) {
  const result = readLocale(file)
  if (!result.ok) {
    malformed.push(`${path.basename(file)}：${result.reason}`)
    continue
  }
  const id = path.basename(file, '.json').toLowerCase()
  // DSH 按小写语言 id 建表，重复会让整个元信息读取抛错。
  if (titles.has(id) || descriptions.has(id)) {
    malformed.push(`${path.basename(file)}：语言 id ${id} 重复`)
    continue
  }
  if (result.meta.title !== undefined) titles.set(id, result.meta.title)
  if (result.meta.description !== undefined) descriptions.set(id, result.meta.description)
}
check(`locale 文件都符合 DSH 的读取规则（${malformed.join('；') || '无问题'}）`, malformed.length === 0)

// ── 用户可见的那一层：按 localizedText / resolveText 取值 ──
/**
 * 复刻 DSH 的 localizedText：没有任何语言给出该字段时回落成给定文本。
 *
 * @param {Map<string, string>} values 语言 id → 取值
 * @param {string} fallback 回落文本（这里是 package.json 的 name）
 * @returns {string|Record<string, string>} 单语言回落文本，或多语言取值表
 */
const localizedText = (values, fallback) => {
  if (values.size === 0) return fallback
  return { en: fallback, ...Object.fromEntries(values) }
}

/**
 * 复刻 DSH 的 resolveText：按当前语言取值，最终回落到 en。
 *
 * @param {string|Record<string, string>} text 多语言取值表或普通字符串
 * @param {string} locale 当前语言 id
 * @returns {string} 实际显示出来的文本
 */
const resolveText = (text, locale) => {
  if (typeof text === 'string') return text
  return text[locale.toLowerCase()] ?? text.en
}

/** 插件页实际显示的标题（按 DSH 的规则算出来）。 */
const title = localizedText(titles, manifest.name)
/** DSH 内置语言，见 dsh-client-locale 的 LOCALE_IDS。 */
const LOCALES = ['zh', 'en']
for (const locale of LOCALES) {
  const shown = resolveText(title, locale)
  check(`插件页在 ${locale} 下显示的是插件名而不是 npm 包名（${shown}）`, shown !== manifest.name)
}

let failed = 0
for (const [label, ok] of checks) {
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${label}`)
}

console.log()
console.log(`共 ${checks.length} 项，未通过 ${failed} 项`)
if (failed > 0) process.exit(1)
console.log('✓ 插件页显示名称由包内 locale 文件提供，且解析路径与 npm 发布范围都已到位')
