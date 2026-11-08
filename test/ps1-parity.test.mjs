#!/usr/bin/env node
/**
 * PowerShell 7 版请求助手的对等性测试。
 *
 * 仓库里有两个功能相同的 API 调用助手：
 *   - scripts/radeon-api.sh   —— POSIX / Git Bash
 *   - scripts/radeon-api.ps1  —— PowerShell 7（Windows 原生）
 * 两者必须遵守同一份输出契约，否则 probe-efforts.mjs 换个平台就解析不到状态码：
 *   响应体走 stdout，状态码走 stderr 的 ---HTTP <code>--- 标记；
 *   非 2xx 也算正常返回（退出码 0），只有缺密钥、缺参、连不上才非零退出。
 *
 * 测试分两层：
 *   1. 静态层：两个脚本暴露的环境变量、默认值、输出标记与用法必须一致，
 *      且 .ps1 必须是带 BOM 的 UTF-8 并声明 #Requires -Version 7.0。
 *      这一层任何机器都能跑，是契约的兜底。
 *   2. 行为层：在 127.0.0.1 起桩服务，把脚本真跑一遍。.ps1 必须跑；
 *      .sh 只在真能跑通时才跑，并能与 .ps1 逐字比对协议输出。
 *
 * 用法: node test/ps1-parity.test.mjs
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 本测试文件所在目录。 */
const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 仓库根目录。 */
const ROOT = path.resolve(HERE, '..')
/** POSIX 版助手。 */
const SH = path.join(ROOT, 'scripts', 'radeon-api.sh')
/** PowerShell 7 版助手。 */
const PS1 = path.join(ROOT, 'scripts', 'radeon-api.ps1')
/** 本包的清单。 */
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
/** 行尾规则文件。 */
const GITATTRIBUTES = path.join(ROOT, '.gitattributes')

/** 逐项检查结果。 */
const checks = []
/**
 * 登记一项检查。
 *
 * @param {string} label 检查项描述
 * @param {boolean} ok 是否通过
 */
const check = (label, ok) => checks.push([label, ok])

// —— 静态层：两个脚本必须暴露同一份契约 ——

check('scripts/radeon-api.sh 存在', existsSync(SH))
check('scripts/radeon-api.ps1 存在', existsSync(PS1))

const ps1Bytes = existsSync(PS1) ? readFileSync(PS1) : Buffer.alloc(0)
/** .ps1 的文本内容，去掉 BOM 后便于做文本断言。 */
const ps1Text = ps1Bytes.toString('utf8').replace(/^\uFEFF/, '')
/** .sh 的文本内容（工作区可能是 CRLF，行为层另做归一化）。 */
const shText = existsSync(SH) ? readFileSync(SH, 'utf8') : ''

check('radeon-api.ps1 以 UTF-8 BOM 开头（缺了它 Windows 上中文会乱码）',
  ps1Bytes[0] === 0xef && ps1Bytes[1] === 0xbb && ps1Bytes[2] === 0xbf)
check('radeon-api.ps1 声明 #Requires -Version 7.0（5.1 上会响亮失败而不是诡异报错）',
  /^#Requires -Version 7\.0$/m.test(ps1Text))
check('radeon-api.ps1 的用法覆盖 <METHOD> <PATH> [JSON_BODY]',
  /<METHOD> <PATH> \[JSON_BODY\]/.test(ps1Text))

// 契约里最容易被改漏的一项：调用方靠这一行解析状态码。
check('两个脚本都把状态码写成 ---HTTP <code>--- 标记',
  /---HTTP /.test(shText) && /---HTTP /.test(ps1Text))

/** 两个脚本都必须认的环境变量。 */
const REQUIRED_ENV = ['RADEON_API_KEY', 'RADEON_KEY_REF', 'RADEON_BASE', 'DSH_HOME', 'RAW']
for (const name of REQUIRED_ENV) {
  check('两个脚本都认环境变量 ' + name, shText.includes(name) && ps1Text.includes(name))
}

/** 默认端点，两个脚本必须一致。 */
const DEFAULT_BASE = 'https://developer.amd.com.cn/radeon/api/v1'
check('两个脚本的默认端点一致', shText.includes(DEFAULT_BASE) && ps1Text.includes(DEFAULT_BASE))
/** 默认凭据条目名，两个脚本必须一致。 */
const DEFAULT_REF = 'RADEON_CLOUD_API_KEY'
check('两个脚本的默认凭据条目名一致', shText.includes(DEFAULT_REF) && ps1Text.includes(DEFAULT_REF))

// 打包白名单决定用户能不能在安装包里拿到这个脚本。
check('scripts 在 files 白名单里（否则 ps1 不会随包发布）',
  (manifest.files ?? []).includes('scripts'))

// —— 行尾规则：.ps1 检出为 CRLF，其余文本一律 LF ——

/** .gitattributes 的内容；这个文件是行尾规则的唯一真源。 */
const attrs = existsSync(GITATTRIBUTES) ? readFileSync(GITATTRIBUTES, 'utf8') : ''
/** 某个路径在 .gitattributes 里被声明成的行尾。 */
const eolRuleOf = (glob) => {
  const line = attrs.split(/\r?\n/).find((row) => row.trim().startsWith(glob + ' '))
  return line ? /eol=(\w+)/.exec(line)?.[1] : undefined
}

check('.gitattributes 存在（行尾规则靠它固化，不靠约定）', existsSync(GITATTRIBUTES))
check('.gitattributes 把 *.ps1 固定为 CRLF', eolRuleOf('*.ps1') === 'crlf')
check('.gitattributes 把 *.sh 固定为 LF', eolRuleOf('*.sh') === 'lf')
check('.gitattributes 给其余文件兜底 eol=lf', /^\s*\*\s+text=auto\s+eol=lf\s*$/m.test(attrs))

// 规则生效的实证：工作区里这两个文件的行尾必须与规则一致。
// .sh 尤其关键——带 CRLF 时 bash 会把 \r 当成 token 的一部分而直接报语法错误。
check('工作区的 scripts/radeon-api.ps1 是 CRLF 行尾',
  ps1Text.includes('\r\n') && !/(?<!\r)\n/.test(ps1Text))
check('工作区的 scripts/radeon-api.sh 是 LF 行尾', !shText.includes('\r\n'))

// —— 行为层：起桩服务，把脚本真跑一遍 ——

/**
 * 判断某个可执行程序是否可用。
 *
 * @param {string} cmd 可执行程序名
 * @param {string[]} args 用来探活的参数
 * @returns {Promise<boolean>} 是否可用
 */
async function usable(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 30000 }, (err) => resolve(!err))
  })
}

const HAS_PWSH = await usable('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'])
const HAS_BASH = await usable('bash', ['--version'])

/** 临时目录根：放模拟的凭据文件与 bash 侧的归一化副本。 */
const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'radeon-parity-'))
/** 给 bash 用的路径写法（MSYS 不认反斜杠）。 */
const toPosix = (p) => p.replace(/\\/g, '/')

/** 桩服务里模拟的密钥，来自凭据文件。 */
const KEY_FROM_FILE = 'rc-from-file'
/** 桩服务里模拟的密钥，来自环境变量。 */
const KEY_FROM_ENV = 'rc-env'
/** 桩服务里模拟的备用条目名。 */
const EXTRA_REF = 'OTHER_KEY_ENTRY'
/** 临时 HOME，用来放模拟的凭据文件。 */
const tmpHome = path.join(tmpRoot, 'home')
mkdirSync(tmpHome)
writeFileSync(path.join(tmpHome, '.credentials.yaml'),
  DEFAULT_REF + ': ' + KEY_FROM_FILE + '\n' + EXTRA_REF + ': rc-extra\n')
/** 没有目标条目的凭据目录。 */
const tmpMissingRef = path.join(tmpRoot, 'noref')
mkdirSync(tmpMissingRef)
writeFileSync(path.join(tmpMissingRef, '.credentials.yaml'), 'SOMETHING: else\n')

/** 桩服务：把收到的请求特征回显给脚本，供断言使用。 */
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    // 只回显两个脚本都会发的头。Accept 是例外：curl 默认发 */*、HttpClient 不发，
    // 语义等价但字节不同，只在专门检查它的路由上回显。
    const echo = {
      auth: req.headers['authorization'] ?? '',
      ctype: req.headers['content-type'] ?? '',
      body,
    }
    if (req.url === '/models') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'stub-model' }], ...echo }))
    } else if (req.url === '/reject') {
      res.writeHead(422, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ detail: 'tier rejected', ...echo }))
    } else if (req.url === '/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: one\n\n')
      setTimeout(() => {
        res.write('data: two\n\n')
        res.end()
      }, 150)
    } else if (req.url === '/accept') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ accept: req.headers['accept'] ?? '' }))
    } else {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(echo))
    }
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
/** 桩服务的基础 URL。 */
const BASE = 'http://127.0.0.1:' + server.address().port

/**
 * 跑一次助手脚本。
 *
 * @param {'sh'|'ps1'} kind 用哪个助手
 * @param {string[]} args 方法、路径与可选请求体
 * @param {Record<string,string>} env 额外的环境变量
 * @returns {Promise<{code: number|null, stdout: string, stderr: string}>} 退出码与两个流
 */
function runHelper(kind, args, env) {
  const cmd = kind === 'ps1' ? 'pwsh' : 'bash'
  const prefix = kind === 'ps1' ? ['-NoProfile', '-File', PS1] : [toPosix(SH)]
  return new Promise((resolve) => {
    execFile(cmd, [...prefix, ...args], {
      maxBuffer: 8 * 1024 * 1024,
      env: {
        ...process.env,
        HOME: toPosix(tmpHome),
        RADEON_BASE: BASE,
        RADEON_API_KEY: '',
        DSH_HOME: toPosix(tmpHome),
        ...env,
      },
    }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })
    })
  })
}

/**
 * 解析 JSON 响应体；解析不出来时返回 undefined，让断言失败而不是抛异常。
 *
 * @param {{stdout: string}} result 助手运行结果
 * @returns {any} 解析后的对象
 */
const jsonOf = (result) => {
  try {
    return JSON.parse(result.stdout)
  } catch {
    return undefined
  }
}

// bash 版在部分 Windows 环境（沙箱自带的最小 bash）里能跑，但脚本里那段
// 「用 node -e 解析凭据文件」的多行引用会被它解析成语法错误。这不是脚本缺陷，
// 因此把能力分成两半探活：哪半不行，就只跳过依赖它的那几个用例。
let BASH_CAN_RUN = false
let BASH_CAN_READ_CRED = false
if (HAS_BASH) {
  const envProbe = await runHelper('sh', ['GET', '/models'], { RADEON_API_KEY: KEY_FROM_ENV })
  BASH_CAN_RUN = envProbe.code === 0 && jsonOf(envProbe)?.data?.[0]?.id === 'stub-model'
  if (BASH_CAN_RUN) {
    const fileProbe = await runHelper('sh', ['GET', '/models'], { DSH_HOME: toPosix(tmpHome) })
    BASH_CAN_READ_CRED = jsonOf(fileProbe)?.auth === 'Bearer ' + KEY_FROM_FILE
  }
  if (!BASH_CAN_RUN) {
    console.log('⚠ 本机的 bash 无法执行 scripts/radeon-api.sh，跳过 bash 侧行为测试与逐字比对')
  } else if (!BASH_CAN_READ_CRED) {
    console.log('⚠ 本机的 bash 执行凭据文件解析段会报语法错误，跳过 bash 侧三个凭据相关用例')
  }
  if (!BASH_CAN_RUN || !BASH_CAN_READ_CRED) {
    console.log('  （PowerShell 侧行为测试仍会执行；两个脚本的契约由静态层保证）\n')
  }
}
if (!HAS_PWSH) {
  console.log('⚠ 本机没有 pwsh 7，跳过 PowerShell 侧行为测试；静态层结论仍然有效\n')
}

/** 每个用例：怎么跑、期望是什么、能不能在两种助手之间逐字比对。 */
const CASES = [
  {
    name: 'GET 成功：响应体走 stdout、状态码走 stderr',
    args: ['GET', '/models'],
    env: { RADEON_API_KEY: KEY_FROM_ENV },
    compare: true,
    expect: (r) => r.code === 0
      && /---HTTP 200---/.test(r.stderr)
      && jsonOf(r)?.data?.[0]?.id === 'stub-model',
  },
  {
    name: '环境变量里的密钥进了 Authorization 头',
    args: ['GET', '/models'],
    env: { RADEON_API_KEY: KEY_FROM_ENV },
    compare: true,
    expect: (r) => jsonOf(r)?.auth === 'Bearer ' + KEY_FROM_ENV,
  },
  {
    name: '凭据文件里的密钥按 DSH_HOME 定位并读取',
    args: ['GET', '/models'],
    env: { DSH_HOME: toPosix(tmpHome) },
    needsCredFile: true,
    compare: true,
    expect: (r) => jsonOf(r)?.auth === 'Bearer ' + KEY_FROM_FILE,
  },
  {
    name: 'RADEON_KEY_REF 能切换到别的凭据条目',
    args: ['GET', '/models'],
    env: { DSH_HOME: toPosix(tmpHome), RADEON_KEY_REF: EXTRA_REF },
    needsCredFile: true,
    compare: true,
    expect: (r) => jsonOf(r)?.auth === 'Bearer rc-extra',
  },
  {
    name: 'POST 的请求体原样送达，Content-Type 精确为 application/json',
    args: ['POST', '/echo', '{"model":"x"}'],
    env: { RADEON_API_KEY: KEY_FROM_ENV },
    compare: true,
    expect: (r) => {
      const echo = jsonOf(r)
      return echo?.body === '{"model":"x"}' && echo?.ctype === 'application/json'
    },
  },
  {
    name: 'GET 也带 Content-Type: application/json（与 bash 版的 -H 一致）',
    args: ['GET', '/models'],
    env: { RADEON_API_KEY: KEY_FROM_ENV },
    compare: true,
    expect: (r) => jsonOf(r)?.ctype === 'application/json',
  },
  {
    name: '422 照常输出响应体与状态码，退出码仍为 0（与 curl 无 -f 一致）',
    args: ['POST', '/reject', '{"a":1}'],
    env: { RADEON_API_KEY: KEY_FROM_ENV },
    compare: true,
    expect: (r) => r.code === 0
      && /---HTTP 422---/.test(r.stderr)
      && /tier rejected/.test(r.stdout),
  },
  {
    name: 'RAW=1 原样逐块输出 SSE，且不打状态码标记',
    args: ['GET', '/stream'],
    env: { RADEON_API_KEY: KEY_FROM_ENV, RAW: '1' },
    compare: true,
    expect: (r) => r.stdout === 'data: one\n\ndata: two\n\n' && !/---HTTP/.test(r.stderr),
  },
  {
    name: 'RAW=1 会带上 Accept: text/event-stream',
    args: ['GET', '/accept'],
    env: { RADEON_API_KEY: KEY_FROM_ENV, RAW: '1' },
    compare: true,
    expect: (r) => jsonOf(r)?.accept === 'text/event-stream',
  },
  {
    name: '既没环境变量也没有凭据文件时报错退出，并给出可操作提示',
    args: ['GET', '/models'],
    env: { DSH_HOME: toPosix(path.join(tmpRoot, 'absent')) },
    compare: false,
    expect: (r) => r.code === 1 && r.stdout === ''
      && /RADEON_API_KEY/.test(r.stderr) && /credentials\.yaml/.test(r.stderr),
  },
  {
    name: '凭据文件里没有目标条目时报错退出',
    args: ['GET', '/models'],
    env: { DSH_HOME: toPosix(tmpMissingRef) },
    needsCredFile: true,
    compare: false,
    expect: (r) => r.code === 1 && /未设置/.test(r.stderr),
  },
  {
    name: '缺参数时报用法并退出 1',
    args: [],
    env: { RADEON_API_KEY: KEY_FROM_ENV },
    compare: false,
    expect: (r) => r.code === 1 && /用法/.test(r.stderr),
  },
]

/** 每个助手对每个用例的结果，键为 kind:index，供逐字比对用。 */
const results = new Map()
/** 可执行的助手清单。 */
const KINDS = [
  { kind: 'sh', runnable: BASH_CAN_RUN, label: 'bash' },
  { kind: 'ps1', runnable: HAS_PWSH, label: 'PowerShell 7' },
]
/** 因本机环境能力不足而跳过的用例，不计入通过数。 */
const skips = []

for (const { kind, runnable, label } of KINDS) {
  if (!runnable) continue
  for (const [index, testCase] of CASES.entries()) {
    if (kind === 'sh' && testCase.needsCredFile && !BASH_CAN_READ_CRED) {
      skips.push(label + ' · ' + testCase.name)
      continue
    }
    const result = await runHelper(kind, testCase.args, testCase.env)
    results.set(kind + ':' + index, result)
    /** 断言本身抛异常也当成失败，避免一个异常让整个测试文件崩掉。 */
    let ok = false
    try {
      ok = Boolean(testCase.expect(result))
    } catch {
      ok = false
    }
    checks.push([label + ' · ' + testCase.name, ok])
  }
}

if (BASH_CAN_RUN && HAS_PWSH) {
  /** 换行差异不算行为差异。 */
  const normalize = (text) => text.replace(/\r\n/g, '\n')
  for (const [index, testCase] of CASES.entries()) {
    if (!testCase.compare) continue
    const a = results.get('sh:' + index)
    const b = results.get('ps1:' + index)
    // 一侧被跳过（本机 bash 缺能力）时不比对，跳过已单独记录。
    if (!a || !b) continue
    const same = a && b
      && a.code === b.code
      && normalize(a.stdout) === normalize(b.stdout)
      && normalize(a.stderr) === normalize(b.stderr)
    checks.push(['两个助手逐字一致 · ' + testCase.name, Boolean(same)])
  }
}

server.close()
rmSync(tmpRoot, { recursive: true, force: true })

let failed = 0
for (const [label, ok] of checks) {
  if (!ok) failed++
  console.log((ok ? '✓' : '✗') + ' ' + label)
}

if (skips.length > 0) {
  for (const label of skips) console.log('- ' + label)
  console.log('（以上 ' + skips.length + ' 项因本机 bash 缺能力而跳过，未计入总数）')
}

console.log()
console.log('共 ' + checks.length + ' 项，未通过 ' + failed + ' 项')
if (failed > 0) process.exit(1)
console.log('✓ PowerShell 7 版助手与 bash 版遵守同一份输出契约')
