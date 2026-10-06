#!/usr/bin/env node
/**
 * 包清单的不变式测试。
 *
 * 钉住三件「改一处就得改全」的事：
 *
 *   1. DSH 兼容范围在三处声明——`peerDependencies`、`engines.dsh`、
 *      `dsh.compatibility.dsh`——必须逐字一致。DSH 的安装闸门**只读 peer**，
 *      另两处是给人看的；不一致会把排查方向带偏。
 *   2. 该范围**无上界**。有上界就得在 DSH 每个大版本上重发一版插件放宽范围，
 *      这正是本次改成 `>=0.2.0-rc.1` 要摆脱的事。
 *   3. 清单里指到的文件真实存在，且都被 `files` 白名单覆盖——否则发到 npm 的
 *      包里会缺文件，而本地测试全绿。
 *
 * 用法: node test/manifest.test.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 本测试文件所在目录。 */
const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 仓库根目录。 */
const ROOT = path.resolve(HERE, '..')
/** 本包的清单。 */
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

/** 期望的 DSH 兼容范围：有下界、无上界。 */
const RANGE = '>=0.2.0-rc.1'

/** 逐项检查结果。 */
const checks = []
/**
 * 登记一项检查。
 *
 * @param {string} label 检查项描述
 * @param {boolean} ok 是否通过
 */
const check = (label, ok) => checks.push([label, ok])

const peers = manifest.peerDependencies ?? {}
const dshPeers = Object.entries(peers).filter(([name]) => name.startsWith('@deepseek-ai/dsh'))
check('peerDependencies 里声明了 DSH 官方包', dshPeers.length > 0)
check('每个 @deepseek-ai/dsh* peer 都是无上界的 >=0.2.0-rc.1',
  dshPeers.every(([, range]) => range === RANGE))
check('engines.dsh 与 peer 逐字一致', manifest.engines?.dsh === RANGE)
check('dsh.compatibility.dsh 与 peer 逐字一致', manifest.dsh?.compatibility?.dsh === RANGE)
check('范围里没有上界（不再需要为 DSH 升版本重发插件）', !RANGE.includes('<'))
check('cordis 也是只有下界的 >=4.0.2（不参与闸门，但会卡 pnpm 的 peer 解析）',
  peers['@deepseek-ai/cordis'] === '>=4.0.2')

// ── 清单指向的文件必须存在，并且在 files 白名单里 ──
/** 清单里指向包内文件的字段。 */
const declared = [
  ['main', manifest.main],
  ['dsh.bundle.patch', manifest.dsh?.bundle?.patch],
  ['exports["./client"]', manifest.exports?.['./client']],
  ['exports["./merge"]', manifest.exports?.['./merge']],
  ['exports["./provider"]', manifest.exports?.['./provider']],
]
const files = manifest.files ?? []
/**
 * 判断某个包内相对路径是否被 files 白名单覆盖。
 *
 * @param {string} relative 形如 ./src/index.js 的相对路径
 * @returns {boolean} 是否会被发布出去
 */
const covered = (relative) => {
  const parts = relative.replace(/^\.\//, '').split('/')
  return parts.length === 1 ? files.includes(parts[0]) : files.includes(parts[0])
}

for (const [label, relative] of declared) {
  check(`${label} 指向的文件存在（${relative}）`, relative !== undefined && existsSync(path.join(ROOT, relative)))
  check(`${label} 在 files 白名单里`, relative !== undefined && covered(relative))
}

check('dsh.client.platform 声明为 web', manifest.dsh?.client?.platform === 'web')
check('补丁文件被 files 白名单覆盖', covered(manifest.dsh?.bundle?.patch ?? ''))

let failed = 0
for (const [label, ok] of checks) {
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${label}`)
}

console.log()
console.log(`共 ${checks.length} 项，未通过 ${failed} 项`)
if (failed > 0) process.exit(1)
console.log('✓ 包清单的三处版本声明一致、无上界，且指向的文件都存在')
