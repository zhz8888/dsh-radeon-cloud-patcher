#!/usr/bin/env node
/**
 * 回归测试：验证从 Radeon 流式响应中取回思考文本的字段选择逻辑是正确的。
 *
 * Radeon 的 SSE 分片存在一个容易致错的形态：思考文本放在 delta.reasoning，
 * 但同一个流的**首个分片**还会带一个 delta.reasoning_content 为 null 的占位。
 * 于是两个字段名在同一流中并存，且占位值是 null 而不是空字符串。
 * 只读 reasoning_content 的实现会取到 null，思考内容静默丢失且不产生任何报错。
 *
 * 正确的判定条件必须是「值为非空字符串」，而不是「字段存在」或「值非 null」：
 * null 的 typeof 是 "object"，会被这一条件自然排除，从而正确落到 reasoning。
 * 本测试用一份真实抓取的流验证该条件确实能取回思考文本。
 *
 * 用法: node test/verify-reasoning.mjs
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 本测试文件所在目录。 */
const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 真实抓取的 SSE 流内容，含思考文本与 null 占位分片。 */
const fixture = readFileSync(path.join(HERE, 'fixtures', 'stream-reasoning.sse'), 'utf8')

// DSH 读取思考文本时依次尝试的字段名，取第一个「值为非空字符串」的字段。
// 顺序很重要：reasoning_content 在前，正好让 null 占位被下面的条件挡掉。
const reasoningFields = ['reasoning_content', 'reasoning', 'reasoning_text']

/**
 * 从一个 delta 分片中选出承载思考文本的字段。
 *
 * @param {Record<string, unknown>} delta SSE 分片里的 delta 对象
 * @returns {string|null} 命中的字段名；三个字段都没有非空字符串时返回 null
 */
function pickReasoning(delta) {
  for (const field of reasoningFields) {
    const value = delta[field]
    if (typeof value === "string" && value.length > 0) return field
  }
  return null
}

/** 累积起来的思考文本。 */
let thinking = ''
/** 累积起来的回答文本。 */
let answer = ''
/** 是否出现过 reasoning_content 为 null 的占位分片。 */
let sawNullPlaceholder = false
/** 实际命中并被采用的字段名，仅记录第一次命中的那个。 */
let fieldUsed = null
/** 是否收到流结束标记 [DONE]。 */
let sawDone = false
/** 最后一次出现的 finish_reason。 */
let finishReason = null
/** 最后一个 usage 分片里的 reasoning_tokens。 */
let reasoningTokens = null
/** 解析成功的 data 分片总数。 */
let events = 0

for (const line of fixture.split('\n')) {
  // 非 data 行是 SSE 注释帧（心跳），不承载数据。
  if (!line.startsWith('data: ')) continue
  const payload = line.slice(6).trim()
  if (payload === '[DONE]') { sawDone = true; continue }
  let frame
  try { frame = JSON.parse(payload) } catch { continue }
  events++

  const choice = frame.choices?.[0]
  if (choice?.delta) {
    const d = choice.delta
    // 记录 null 占位是否出现，用于确认测试样本确实覆盖了问题形态。
    if (d.reasoning_content === null) sawNullPlaceholder = true
    const field = pickReasoning(d)
    if (field !== null) {
      fieldUsed ??= field
      thinking += d[field]
    }
    if (typeof d.content === 'string') answer += d.content
  }
  if (choice?.finish_reason) finishReason = choice.finish_reason
  if (frame.usage?.reasoning_tokens !== undefined) reasoningTokens = frame.usage.reasoning_tokens
}

/** 待检查的断言项，每项为一个说明与布尔结果。 */
const checks = [
  ['流以 [DONE] 正常终止', sawDone],
  ['存在 reasoning_content:null 占位分片（问题前提）', sawNullPlaceholder],
  ['字段选择跳过了 null，命中 delta.reasoning', fieldUsed === 'reasoning'],
  ['取回了非空思考文本', thinking.trim().length > 0],
  ['取回了非空回答文本', answer.trim().length > 0],
  ['finish_reason 为 stop', finishReason === 'stop'],
  ['流式 usage 回报了 reasoning_tokens', typeof reasoningTokens === 'number' && reasoningTokens > 0],
]

/** 未通过的断言数量。 */
let failed = 0
for (const [label, ok] of checks) {
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${label}`)
}

console.log()
console.log(`事件数 ${events} | 命中字段 ${fieldUsed} | 思考 ${thinking.length} 字 | 回答 ${JSON.stringify(answer)} | reasoning_tokens ${reasoningTokens}`)
console.log(`思考文本: ${JSON.stringify(thinking.trim())}`)

if (failed > 0) {
  console.error(`\n✗ ${failed} 项未通过`)
  process.exit(1)
}
console.log('\n✓ 全部通过 —— DSH 的思考功能可从 Radeon 流中正确取回思考文本')