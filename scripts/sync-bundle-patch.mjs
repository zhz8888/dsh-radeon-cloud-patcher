#!/usr/bin/env node
/**
 * 把 provider/radeon-cloud.yml 同步进 cordis.plugin.patch.yml 的生成区块。
 *
 * 为什么定义要出现在补丁文件里：设置页的「删除」按钮只在
 * 「该 provider 路径存在于用户层、且不存在于 base 层」时渲染。定义放在
 * profile 的 cordis.patch.yml（用户层）就必然带删除按钮；放在本插件的
 * bundle 层（本文件）则永远没有——卸载插件就等于删除供应商。
 *
 * 为什么不直接读文件：DSH 的补丁是静态 YAML，没有「引用另一个文件」的语法。
 * 因此定义必须以文本形式出现在补丁里，而唯一真源仍是 provider/radeon-cloud.yml：
 * 这个脚本负责把真源渲染进区块，test/patch-sync.test.mjs 负责断言两者一致。
 *
 * 用法:
 *   node scripts/sync-bundle-patch.mjs        同步（有变化才写盘）
 *   node scripts/sync-bundle-patch.mjs --check  只检查，落后即非零退出
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 本脚本文件所在目录。 */
const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 仓库根目录。 */
const ROOT = path.resolve(HERE, '..')

/** 定义的唯一真源。 */
export const SOURCE_FILE = path.join(ROOT, 'provider', 'radeon-cloud.yml')
/** 携带定义副本的补丁文件。 */
export const PATCH_FILE = path.join(ROOT, 'cordis.plugin.patch.yml')

/** 生成区块的起始标记（缩进后写入补丁）。 */
export const BLOCK_BEGIN = '# >>> 生成区块：provider/radeon-cloud.yml 的副本，由 scripts/sync-bundle-patch.mjs 维护'
/** 生成区块的结束标记。 */
export const BLOCK_END = '# <<< 生成区块结束'
/** 定义在补丁里的缩进：providers.radeon-cloud 之下每层 2 空格，键从第 8 列开始。 */
export const BLOCK_INDENT = ' '.repeat(8)

/**
 * 把定义文本渲染成补丁里的区块（含起止标记）。
 *
 * 注释与空行原样保留：补丁文件是给人读的，定义里的「为什么」不能在副本里丢失。
 *
 * @param {string} definitionText provider/radeon-cloud.yml 的全文
 * @returns {string} 可直接替换进补丁的多行文本
 */
export function renderBlock(definitionText) {
  const body = definitionText.replace(/\n+$/, '').split('\n')
    .map((line) => (line.trim() === '' ? '' : BLOCK_INDENT + line))
  return [`${BLOCK_INDENT}${BLOCK_BEGIN}`, ...body, `${BLOCK_INDENT}${BLOCK_END}`].join('\n')
}

/**
 * 把补丁文本里的生成区块替换为给定定义渲染出的区块。
 *
 * @param {string} patchText 补丁文件全文
 * @param {string} definitionText provider/radeon-cloud.yml 的全文
 * @returns {string} 替换后的补丁全文
 * @throws {Error} 找不到起止标记（说明补丁被手工改坏了）时抛出
 */
export function spliceBlock(patchText, definitionText) {
  const lines = patchText.split('\n')
  const beginAt = lines.findIndex((line) => line.trim() === BLOCK_BEGIN)
  const endAt = lines.findIndex((line) => line.trim() === BLOCK_END)
  if (beginAt === -1 || endAt === -1) {
    throw new Error(`补丁文件里找不到生成区块标记：${BLOCK_BEGIN} / ${BLOCK_END}`)
  }
  if (endAt < beginAt) throw new Error('补丁文件里的生成区块标记顺序颠倒')
  return [
    ...lines.slice(0, beginAt),
    ...renderBlock(definitionText).split('\n'),
    ...lines.slice(endAt + 1),
  ].join('\n')
}

/** 命令行入口。 */
function main() {
  const checkOnly = process.argv.slice(2).includes('--check')
  const definition = readFileSync(SOURCE_FILE, 'utf8')
  const before = readFileSync(PATCH_FILE, 'utf8')
  const after = spliceBlock(before, definition)
  if (after === before) {
    console.log('✓ cordis.plugin.patch.yml 的定义区块已是最新')
    return
  }
  if (checkOnly) {
    console.error('✗ cordis.plugin.patch.yml 的定义区块落后于 provider/radeon-cloud.yml')
    console.error('  请执行：pnpm sync:patch')
    process.exit(1)
  }
  writeFileSync(PATCH_FILE, after)
  console.log('✓ 已把 provider/radeon-cloud.yml 同步进 cordis.plugin.patch.yml')
}

/* v8 ignore next 3 -- 仅在被直接执行时进入命令行分支，被测试导入时不执行 */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
