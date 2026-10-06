#!/usr/bin/env node
/**
 * 补丁文件与 provider 定义的一致性测试。
 *
 * provider/radeon-cloud.yml 是唯一真源，cordis.plugin.patch.yml 里的定义区块
 * 是它渲染出来的副本。这个测试同时钉住两件事：
 *
 *   1. 副本与真源在语义上一致，且生成器再跑一遍不会产生任何改动（连格式都不许漂）；
 *   2. 补丁结构本身就是「删除按钮永不出现」的实现——定义落在本插件的 bundle 层，
 *      llm-pi-ai 的 config 里除本 provider 之外不许有别的东西，
 *      本插件的条目 id / name 也必须是 DSH 惯例里的那两个值。
 *
 * 用法: node test/patch-sync.test.mjs
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadYaml } from '../src/yaml.js'
import { deepEqual, PROVIDER_KEY, TARGET_ENTRY_ID } from '../src/merge.js'
import { BLOCK_BEGIN, BLOCK_END, PATCH_FILE, SOURCE_FILE, spliceBlock } from '../scripts/sync-bundle-patch.mjs'

/** 本测试文件所在目录。 */
const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 仓库根目录。 */
const ROOT = path.resolve(HERE, '..')

/** 补丁文件全文。 */
const patchText = readFileSync(PATCH_FILE, 'utf8')
/** 定义真源全文。 */
const definitionText = readFileSync(SOURCE_FILE, 'utf8')
/** 解析后的补丁行。 */
const rows = loadYaml().parse(patchText)
/** 解析后的定义。 */
const definition = loadYaml().parse(definitionText)
/** 本插件的包声明。 */
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

/** 逐项检查结果。 */
const checks = []
/**
 * 登记一项检查。
 *
 * @param {string} label 检查项描述
 * @param {boolean} ok 是否通过
 */
const check = (label, ok) => checks.push([label, ok])

check('补丁文件是 YAML 数组', Array.isArray(rows))

/** llm-pi-ai 的覆盖行。 */
const llmRow = rows.find((row) => row?.id === TARGET_ENTRY_ID && row.insert === undefined)
check(`补丁里有一条针对 ${TARGET_ENTRY_ID} 的覆盖`, llmRow !== undefined)
check(`覆盖行只声明 providers.${PROVIDER_KEY}`,
  deepEqual(Object.keys(llmRow?.config ?? {}), ['providers'])
  && deepEqual(Object.keys(llmRow?.config?.providers ?? {}), [PROVIDER_KEY]))
check('补丁里的定义与 provider/radeon-cloud.yml 语义一致',
  deepEqual(llmRow?.config?.providers?.[PROVIDER_KEY], definition))

check('生成区块的起止标记都在',
  patchText.includes(BLOCK_BEGIN) && patchText.includes(BLOCK_END))
check('生成器再跑一遍不产生任何改动（连格式都不许漂）',
  spliceBlock(patchText, definitionText) === patchText)

/** 本插件的 insert 行。 */
const inserted = rows.flatMap((row) => row?.insert ?? []).find((row) => row?.id === 'radeon-cloud-patcher')
check('补丁插入了本插件自己那一行', inserted !== undefined)
check('id 用不带作用域的短名（DSH 惯例）', inserted?.id === 'radeon-cloud-patcher')
check('name 是带引号的完整包名', inserted?.name === manifest.name)
check('本插件的条目不带 config（校验与判定都是无条件的）', inserted?.config === undefined)

check('定义落在本插件的补丁层，而不是任何别的地方',
  rows.filter((row) => row?.config?.providers !== undefined).length === 1)

let failed = 0
for (const [label, ok] of checks) {
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${label}`)
}

console.log()
console.log(`共 ${checks.length} 项，未通过 ${failed} 项`)
if (failed > 0) process.exit(1)
console.log('✓ 补丁层与定义真源一致，且结构符合「删除按钮永不出现」的要求')
