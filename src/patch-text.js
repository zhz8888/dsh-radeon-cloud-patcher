/**
 * 在补丁文件里按键增删改 llm-pi-ai 的 providers.<key> 文本块。
 *
 * 为什么必须做文本级编辑：provider 定义最终要写进 profile 的 cordis.patch.yml，
 * 而那是用户自己维护的文件。若把整份 YAML 解析后再序列化，注释、缩进风格、
 * 键的书写顺序都会被重排，等于用工具把用户的文件重写了一遍。
 *
 * 因此这里只做「定位到那一个块 → 用新内容替换或插入」，其余字节一律不动。
 *
 * 本模块是纯文本函数，不解析 YAML 结构，只按缩进和顶层条目标记定位。
 */

import { loadYaml } from './yaml.js'

/**
 * 生成缩进指定数量的空格。
 *
 * @param {number} width 缩进宽度
 * @returns {string} 空格串
 */
const indentOf = (width) => ' '.repeat(width)

/**
 * 找出某个顶层条目在行数组中的区间。
 *
 * @param {string[]} lines 按行切分的文件内容
 * @param {string} id 条目 id
 * @returns {[number, number]|null} 左闭右开的起止下标；不存在时返回 null
 */
function entryRange(lines, id) {
  const start = lines.findIndex((line) => line === `- id: ${id}`)
  if (start === -1) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('- id: ')) { end = i; break }
  }
  return [start, end]
}

/**
 * 取出某一行前导的空格数。
 *
 * @param {string} line 行内容
 * @returns {number} 前导空格数
 */
function leadingSpaces(line) {
  const match = line.match(/^ */)
  return match[0].length
}

/**
 * 判断某行是否是一个 `键:` 或 `键: 值` 形式的映射条目。
 *
 * @param {string} line 行内容
 * @returns {boolean} 是否为映射条目
 */
function isMappingLine(line) {
  return /^(\s+)([A-Za-z0-9_][\w.-]*|"[^"]*"|'[^']*'):(\s|$)/.test(line)
}

/**
 * 取出映射条目的键名。
 *
 * @param {string} line 行内容
 * @returns {string|null} 键名；该行不是映射条目时返回 null
 */
function mappingKey(line) {
  const match = line.match(/^\s+([A-Za-z0-9_][\w.-]*|"[^"]*"|'[^']*'):(\s|$)/)
  if (!match) return null
  return match[1].replace(/^['"]|['"]$/g, '')
}

/**
 * 把 provider 定义序列化为给定缩进的 YAML 文本块。
 *
 * @param {Record<string, any>} profile provider 定义
 * @param {number} width 目标缩进宽度
 * @returns {string[]} 行数组，不含尾部空行
 */
export function renderProfileBlock(profile, width) {
  const { stringify } = loadYaml()
  const rendered = stringify(profile, { lineWidth: 0 }).split('\n')
  while (rendered.length > 0 && rendered.at(-1).trim() === '') rendered.pop()
  const pad = indentOf(width)
  return rendered.map((line) => (line.length === 0 ? '' : pad + line))
}

/**
 * 在补丁行数组中增删改 llm-pi-ai 的 providers.<providerKey> 块。
 *
 * 只触碰该块，其余行原样保留：
 *   - 块已存在且内容一致 → action 为 unchanged，不做任何改动；
 *   - 块已存在但内容不同 → 就地替换；
 *   - 块不存在 → 插入到 providers 下的同级位置（按字典序排在相邻块之间）。
 *
 * @param {string[]} lines 按行切分的补丁文件内容
 * @param {Record<string, any>} profile 要写入的 provider 定义
 * @param {string} providerKey provider 键名
 * @param {string} entryId 目标条目 id
 * @returns {{ lines: string[], action: 'absent'|'unchanged'|'added'|'updated', others: string[] }}
 *   others 为合并后同级 provider 键名中除 providerKey 之外的部分
 */
export function applyProviderBlock(lines, profile, providerKey, entryId = 'llm-pi-ai') {
  const range = entryRange(lines, entryId)
  if (range === null) return { lines, action: 'absent', others: [] }
  const [entryStart, entryEnd] = range

  // 找到 providers: 所在的缩进
  let providersAt = -1
  for (let i = entryStart; i < entryEnd; i++) {
    const match = lines[i].match(/^(\s*)providers:\s*$/)
    if (match) { providersAt = i; break }
  }
  if (providersAt === -1) return { lines, action: 'absent', others: [] }

  const childIndent = leadingSpaces(lines[providersAt]) + 2

  // 收集 providers 下的直接子键及其块范围
  const keys = []
  for (let i = providersAt + 1; i < entryEnd; i++) {
    if (leadingSpaces(lines[i]) < childIndent) break
    if (leadingSpaces(lines[i]) === childIndent) {
      const key = mappingKey(lines[i])
      if (key === null) continue
      let blockEnd = i + 1
      for (let j = i + 1; j < entryEnd; j++) {
        const l = lines[j]
        if (l.trim() === '') continue
        if (leadingSpaces(l) <= childIndent) break
        blockEnd = j + 1
      }
      keys.push({ key, start: i, end: blockEnd })
      i = blockEnd - 1
    }
  }

  const others = keys.filter((k) => k.key !== providerKey).map((k) => k.key)
  const target = keys.find((k) => k.key === providerKey)
  // 完整的块 = 键行 + 字段行。新增与替换两条路径都用它，避免替换时丢掉键行。
  const block = [`${indentOf(childIndent)}${providerKey}:`, ...renderProfileBlock(profile, childIndent + 2)]

  if (target) {
    const before = lines.slice(target.start, target.end).join('\n')
    const after = block.join('\n')
    if (before === after) return { lines, action: 'unchanged', others }
    const next = [...lines.slice(0, target.start), ...block, ...lines.slice(target.end)]
    return { lines: next, action: 'updated', others }
  }

  // 新增：按字典序插到相邻键之间；没有相邻键则追加在 providers 块末尾
  const at = keys.findIndex((k) => k.key > providerKey)
  const insertAt = at === -1 ? (keys.length === 0 ? providersAt + 1 : keys.at(-1).end) : keys[at].start
  const next = [...lines.slice(0, insertAt), ...block, ...lines.slice(insertAt)]
  return { lines: next, action: 'added', others }
}

/** 供外部复用的映射行判定。 */
export { isMappingLine, mappingKey }