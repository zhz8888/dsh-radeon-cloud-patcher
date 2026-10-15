#!/usr/bin/env node
/**
 * 逐模型探测 Radeon Cloud 实际接受哪些 reasoning_effort 档位。
 *
 * 必要性：模型目录接口返回的 supported_parameters 字段里并不包含
 * reasoning_effort，因此无法从目录推断某模型支持哪些档位；而各模型支持的
 * 档位互不相同，传入不受支持的档位会被拒绝（400 或 422）而非降级忽略。
 * 档位只能靠实际请求逐个试探得出。
 *
 * 探测手法：对每个「模型 × 档位」组合发一次 max_tokens 为 1 的极小请求，
 * 只看 HTTP 状态码，200 即视为接受，不关心回复内容；这样单次探测的产出
 * token 成本可忽略。
 *
 * 只有 200 才是「接受」；400 与 422 才是「拒绝」。429（限流）与 5xx
 * （上游偶发故障，README 记录过 504 被包装成 500）都不构成结论，本脚本会
 * 自动重测，避免把「测不出来」写成档位表里的一个 ✗——那会让用户在选择器里
 * 少一个本来可用的档位，且全程不产生任何报错。
 *
 * 用法: node scripts/probe-efforts.mjs [--only ModelId] [--tiers a,b,c] [--interval 毫秒]
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** promisify 后的 execFile，用于调用本目录下的 API 调用助手。 */
const execFileAsync = promisify(execFile)
/** 本脚本文件所在目录。 */
const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 发起请求的可执行助手脚本路径。 */
const HELPER = path.join(HERE, 'radeon-api.sh')

/** 待探测的候选档位全集。 */
const ALL_TIERS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** 命令行参数列表。 */
const argv = process.argv.slice(2)

/**
 * 读取指定选项后面的取值。
 *
 * @param {string} flag 选项名，含前导 --
 * @returns {string|undefined} 紧随其后的取值；选项不存在时返回 undefined
 */
const argOf = (flag) => {
  const i = argv.indexOf(flag)
  return i === -1 ? undefined : argv[i + 1]
}
/** 只探测这一个模型；未指定时探测全部对话模型。 */
const only = argOf('--only')
/** 只探测这些档位，逗号分隔；未指定时用 ALL_TIERS。 */
const tiers = (argOf('--tiers') ?? ALL_TIERS.join(',')).split(',')

/** 相邻两次请求之间的默认最小间隔。
 *
 * 网关的账户限流是每分钟 20 次（响应头 x-ratelimit-limit-user-rpm）。原先取
 * 3100 毫秒看似合规（≈19.4 次/分），但节流判据是「距上次请求满 3.1 秒」，
 * 第 21 次请求会落在与第 1 次同一个滚动窗口内，实测必踩 429。取 4500 毫秒
 * 把网关这一层躲开；上游自身仍会偶发限流，那由下面的重测兜住。 */
const DEFAULT_INTERVAL_MS = 4500
/** 相邻两次请求之间的最小间隔，可用 --interval 覆盖。 */
const MIN_INTERVAL_MS = Number(argOf('--interval') ?? DEFAULT_INTERVAL_MS)
/** 命中 429 后的冷却时长：服务端 Retry-After 为 60 秒，多留几秒余量。 */
const RATE_LIMIT_COOLDOWN_MS = 65000
/** 命中 5xx 后的重试间隔。上游偶发故障，等几秒再问通常就好了。 */
const UPSTREAM_RETRY_DELAY_MS = 5000
/** 单个「模型 × 档位」组合命中可重试错误后最多重测的次数。 */
const MAX_RETRIES = 2

/** 上一次请求发出的时间戳，用于计算需要等待多久。 */
let lastAt = 0

/**
 * 等待到距上次请求已满最小间隔。
 *
 * @returns {Promise<void>} 等待结束后 resolve
 */
async function throttle() {
  const now = Date.now()
  const wait = lastAt + MIN_INTERVAL_MS - now
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastAt = Date.now()
}

/**
 * 对一个「模型 × 档位」组合发起一次探测请求。
 *
 * @param {string} model 模型 id
 * @param {string} effort reasoning_effort 取值
 * @returns {Promise<{status: number, error?: string}>} HTTP 状态码；取不到时为 -1
 */
async function call(model, effort) {
  for (let attempt = 0; ; attempt += 1) {
    const res = await once(model, effort)
    // 429 是限流，5xx 是上游故障，两者都测不出该档位的真实结论。直接返回会把
    // 「没测到」写成「不接受」，进而从档位表里删掉一个本来可用的档位，所以必须重测。
    const delay = res.status === 429
      ? RATE_LIMIT_COOLDOWN_MS
      : res.status >= 500 ? UPSTREAM_RETRY_DELAY_MS : 0
    if (delay === 0 || attempt >= MAX_RETRIES) return res
    process.stderr.write(
      `  ${model.padEnd(30)} ${effort.padEnd(9)} ${res.status} 非结论，`
      + `${delay / 1000} 秒后重测（第 ${attempt + 1} 次）\n`,
    )
    await new Promise((r) => setTimeout(r, delay))
  }
}

/**
 * 发起一次探测请求，不做限流重试。
 *
 * @param {string} model 模型 id
 * @param {string} effort reasoning_effort 取值
 * @returns {Promise<{status: number, error?: string}>} HTTP 状态码；取不到时为 -1
 */
async function once(model, effort) {
  await throttle()
  // max_tokens 压到 1，让这次请求只为确认档位是否被接受，不产生实际产出。
  const body = JSON.stringify({
    model,
    reasoning_effort: effort,
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 1,
    stream: false,
  })
  try {
    const { stderr } = await execFileAsync(HELPER, ['POST', '/chat/completions', body], {
      maxBuffer: 8 * 1024 * 1024,
    })
    const code = /---HTTP (\d+)---/.exec(stderr)?.[1]
    return { status: Number(code) }
  } catch (err) {
    const code = /---HTTP (\d+)---/.exec(err.stderr ?? '')?.[1]
    return { status: code ? Number(code) : -1, error: (err.stderr ?? err.message ?? '').slice(0, 200) }
  }
}

/** 模型目录中 data 数组的原始条目。 */
const catalog = await new Promise((resolve, reject) => {
  execFileAsync(HELPER, ['GET', '/models'], { maxBuffer: 8 * 1024 * 1024 })
    .then(({ stdout }) => resolve(JSON.parse(stdout).data ?? []))
    .catch(reject)
})

// 目录里混有非对话模型：MinerU2.5-Pro 走独立的 /v1/ocr 端点，
// 其 context_length 为 0、tools 为 false。用这两个字段把这类条目筛掉。
/** 待探测的模型 id 列表。 */
const models = catalog
  .filter((m) => (m.providers?.[0]?.tools ?? false) && (m.context_length ?? 0) > 0)
  .map((m) => m.id)
  .filter((id) => (only ? id === only : true))

console.error(`探测 ${models.length} 个模型 × ${tiers.length} 个档位，约需 ${Math.ceil((models.length * tiers.length * MIN_INTERVAL_MS) / 60000)} 分钟\n`)

/** 探测结果，键为模型 id，值为「档位 → HTTP 状态码」的映射。 */
const result = {}
for (const model of models) {
  result[model] = {}
  for (const effort of tiers) {
    const { status } = await call(model, effort)
    result[model][effort] = status
    // 200 为接受；400 与 422 为档位不被接受；冷却重测后仍非这三者的
    // （例如持续 429、5xx）说明这次没测出结论，须人工复测后手工入表。
    const mark = status === 200 ? '✓' : status === 400 ? '✗400' : status === 422 ? '✗422' : `?${status}`
    process.stderr.write(`  ${model.padEnd(30)} ${effort.padEnd(9)} ${mark}\n`)
  }
}

// 结果打到标准输出，便于重定向到文件后做进一步处理。
console.log(JSON.stringify(result, null, 2))