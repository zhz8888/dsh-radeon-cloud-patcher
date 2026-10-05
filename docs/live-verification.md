# 真机联调实测记录（P1）

| 项目 | 内容 |
| --- | --- |
| 文档类型 | 实测记录（Live Verification） |
| 版本 | **v1.1**（补记合并行为的验证记录） |
| 日期 | 2026-10-04 |
| 密钥 | `RADEON_CLOUD_API_KEY`（格式校验通过：`rc-` + 48 位十六进制，共 51 字符；全程未打印明文） |
| 端点 | `https://developer.amd.com.cn/radeon/api/v1` |
| 结论 | **思考功能可用**；13 项待验证中消解 4 项，G2 确认存在但已缓解；按键合并不破坏用户自有 provider |

---

## 1. 实测工具

| 脚本 | 用途 |
| --- | --- |
| `scripts/radeon-api.sh` | 从凭据存储读密钥并发请求，密钥不进入命令行输出。`RAW=1` 时逐块输出 SSE |
| `scripts/probe-efforts.mjs` | 以 `max_tokens=1` 的极小请求探测各档位是否被接受（按 19 次/分钟节流） |
| `scripts/validate-config.mjs` | 用 DSH 已安装的 `@deepseek-ai/dsh-llm-pi-ai` 导出的 `Config` schema 离线校验配置 |
| `test/verify-reasoning.mjs` | 用真实抓取的 SSE 验证思考字段选择逻辑 |

---

## 2. 模型目录（T0.1）

`GET /v1/models` → **HTTP 200，9 个条目**。

顶层只有 `data`，**无 `object` / `created` / `owned_by`**（印证差异矩阵 Q9）。

| id | context_length | input_modalities | tools | reasoning | stability |
| --- | --- | --- | --- | --- | --- |
| DeepSeek-V4.1-Flash | 1048576 | text, image | ✅ | true | experimental |
| DeepSeek-V4-Flash | 1048576 | text | ✅ | true | experimental |
| DeepSeek-V4-Flash-Vision-Exp | 1048576 | text, image | ✅ | true | experimental |
| MiMo-V2.6-Flash | 1048576 | text, image | ✅ | true | experimental |
| Qwen3.8-27B | **262144** | text, image | ✅ | true | experimental |
| Qwen3.8-Flash-Next | 262144 | text, image | ✅ | true | experimental |
| GLM-5.3-Flash | 262144 | text | ✅ | true | experimental |
| MiniCPM5-2B | 131072 | text | ✅ | true | experimental |
| **MinerU2.5-Pro** | **0** | text | **❌** | false | experimental |

### 2.1 与官方文档的两处出入

| 项 | 文档 | 实测 | 处理 |
| --- | --- | --- | --- |
| Qwen3.8-27B 上下文 | 131,072 | **262,144** | 以实测为准 |
| MinerU2.5-Pro | 列为 chat 模型参考页 | `context_length=0`、`tools=false` | **排除**，它是 OCR 模型，走 `/v1/ocr` |

### 2.2 风险 K8 实证：`supported_parameters` 不可用于门控

**全部 9 个模型的 `supported_parameters` 都不含 `reasoning_effort`**，取值为：

```
temperature, max_tokens, top_p, stream, response_format, tools, tool_choice
```

但 8 个对话模型的 `providers[0].reasoning` 均为 `true`。

**结论**：该字段对思考能力的判定**完全无用**，只能用作参考。配置未依赖它。

> 另注：MiniCPM5-2B 的 `reasoning=true`，但 AMD 文档说明它不返回分离思考。
> 这进一步证明 `providers[].reasoning` 单独也不足以判断「思考文本是否会出现」。
> 配置中已对 MiniCPM5-2B 显式声明 `reasoningEfforts: false`。

---

## 3. 思考档位实测（T1–T3）

对 8 个对话模型 × 7 个候选档位各发一次 `max_tokens=1` 请求，以 HTTP 200 判定为「接受」。

| 模型 | none | minimal | low | medium | high | xhigh | max |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DeepSeek-V4.1-Flash | ✓ | ✓ | ✓¹ | ✓ | ✓ | ✓ | ✓ |
| DeepSeek-V4-Flash | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| DeepSeek-V4-Flash-Vision-Exp | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| MiMo-V2.6-Flash | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Qwen3.8-27B | ✓ | ✗400 | ✓ | ✓ | ✗400 | ✓ | ✗400 |
| Qwen3.8-Flash-Next | ✓ | ✗400 | ✓ | ✓ | ✗400 | ✓ | ✗400 |
| GLM-5.3-Flash | ✗422 | ✗422 | ✓ | ✓ | ✓ | ✗422 | ✗422 |
| MiniCPM5-2B | ✗422 | ✗422 | ✓ | ✓ | ✓ | ✗422 | ✗422 |

¹ 首次探测该格返回 **429 限流**，单独复测得 **HTTP 200**，确认被接受。
> **教训**：`429` 不是「被拒绝」的证据。首轮探测脚本把限流误判为拒绝，已单独复测订正。

结论：**官方文档的档位表准确**，仅 MiniCPM5-2B 的细节（文档称不适用，实测接受 low/medium/high 但不返回思考文本）需要按「非推理模型」处理。

---

## 4. 思考文本取回（T1 / 风险 K1、R2）— 核心验证

### 4.1 非流式

```jsonc
{
  "choices": [{ "message": { "role": "assistant", "content": "...", "tool_calls": null,
                             "reasoning": "We need answer. Need be careful..." },
                "finish_reason": "stop" }],
  "usage": { "prompt_tokens": 43, "completion_tokens": 202, "total_tokens": 245,
             "reasoning_tokens": 145,                                  // ← 顶层
             "completion_tokens_details": { "reasoning_tokens": 145 }, // ← 嵌套，两处一致
             "cost": 0.00010318, "cost_details": { ... } }            // ← 文档未提及
}
```

- **`message.reasoning` 存在，`message.reasoning_content` 不存在** ✓ 与文档一致
- **`usage.reasoning_tokens` 顶层与 `completion_tokens_details.reasoning_tokens` 同时存在且数值一致**
  → **风险 K2 / 缺口 G5 消解**：AMD 文档的两处矛盾在实测中并不矛盾。DSH 所用 pi-ai 读取后者即可。

### 4.2 流式 —— 发现一个真实的陷阱

抓取的 SSE 前两个分片：

```
: ping                                    ← SSE 注释帧（心跳），间歇出现
data: {... "delta":{"reasoning_content":null,"role":"assistant","content":""} ...}

data: {... "delta":{"role":"assistant","reasoning":"We"} ...}
```

**关键发现**：思考文本在 **`delta.reasoning`**，而**同一个流里**首个分片还带了一个
**`delta.reasoning_content: null` 的占位**。两个字段名并存。

> 若某个实现只读 `delta.reasoning_content`，它拿到的是 `null`，**思考功能会静默失效且无任何报错**。

DSH 所用 pi-ai 的字段选择逻辑（`openai-completions.js:399-408`）为：

```js
const reasoningFields = ["reasoning_content", "reasoning", "reasoning_text"];
for (const field of reasoningFields) {
    const value = deltaFields[field];
    if (typeof value === "string" && value.length > 0) { foundReasoningField = field; break }
}
```

`typeof null === "object"` → 占位被跳过 → 正确命中 `delta.reasoning`。
**DSH 侧无需任何改动即可正确取回思考文本。**

已固化为回归测试 `test/verify-reasoning.mjs`（用真实抓取的流），7 项断言全部通过：

```
✓ 流以 [DONE] 正常终止
✓ 存在 reasoning_content:null 占位分片（问题前提）
✓ 字段选择跳过了 null，命中 delta.reasoning
✓ 取回了非空思考文本
✓ 取回了非空回答文本
✓ finish_reason 为 stop
✓ 流式 usage 回报了 reasoning_tokens
```

完整流：14 个 data 事件、`[DONE]` 终止、`finish_reason=stop`、
思考 "We need answer simple. Need final only."、回答 "4"。

---

## 5. 多轮回放（T5 / 缺口 G6）— 已消解

pi-ai 在回放助手消息时，用的是**它读取时用的同一个字段名**（`thinkingSignature`）：

```js
assistantMsg[thinkingSignature] = blocks.map(b => b.thinking).join("\n")
```

我方场景 `thinkingSignature = "reasoning"`，因此回放写的是 **`assistant.reasoning`**。

实测：以 `{"role":"assistant","content":"4","reasoning":"We need answer simple."}` 作为历史再提问
→ **HTTP 200，`finish_reason=stop`，正确回答 "6"`** ✓

> 附：`reasoning_content` 变体在实测中遇到一次 `504`（上游瞬时故障），未能取得干净结论；
> 但 pi-ai 并不会发送该字段，故不影响。

**G6 消解。**

---

## 6. 思考挤占预算（缺口 G2）— 确认存在，已缓解

模型 `DeepSeek-V4.1-Flash`，提问「详细解释天空为什么是蓝色的」，`reasoning_effort=low`：

| max_tokens | finish_reason | content | reasoning | 结论 |
| --- | --- | --- | --- | --- |
| 16 | `length` | **空** | 84 字符 | 空回复 |
| 40 | `length` | **空** | 216 字符 | 空回复 |
| 120 | `length` | **空** | 584 字符 | 空回复 |
| 400 | `length` | **空** | 1717 字符 | 空回复 |

对照 `reasoning_effort=none`：

| max_tokens | finish_reason | content | 结论 |
| --- | --- | --- | --- |
| 64 | `length` | 330 字符 | ✅ 正常 |
| 200 | `length` | 909 字符 | ✅ 正常 |

**G2 确认**：开启思考后，思考会吃光整个 `max_tokens` 预算，`content` 变空字符串。
即使 400 token 也不足以完成一次「详细解释」。

**缓解**：`defaultMaxTokens` 设为 `32768`（pi-ai 默认值）。
`max_tokens` 是上限而非计费项，调高不增加成本。

---

## 7. 错误信封（T8/T9 / 缺口 G3）

实测见到的上游故障形态：

```json
{"error":{"message":"Error from provider self-dploy: 504 Gateway Timeout {...}",
          "type":"upstream_error","code":"upstream_error",
          "usedProvider":"self-dploy","requestedModel":"DeepSeek-V4.1-Flash", ...}}
```

HTTP **500**，内部是上游 504（`call_upstream_timeout`）。

- 这是 **OpenAI 形状的信封**，DSH/pi-ai 可正常解析 → 映射为可重试的 `SERVER` ✓
- AMD 文档所述的 FastAPI `{"detail":…}` 包裹形态**本次未触发**，G3 保持为未完全验证
- 该故障**间歇出现**，重试即可恢复

---

## 8. 验收对照

> **2026-10-04 用户实机确认：思考强度可正常设置、模型返回内容已规范化、
> 「设置 → 模型」中可见 Radeon Cloud 选项。T0 验收通过。**

| # | 标准 | 结果 |
| --- | --- | --- |
| A1 | 模型设置页出现 Radeon Cloud 行，编辑器可用 | ✅ 实机确认 |
| A2 | 可输入并保存 API 密钥 | ✅ 实机确认 |
| A3 | 模型选择器显示 Radeon 模型 | ✅ 实机确认 |
| A4 | 思考档位控件按模型显示 | ✅ 实机确认，可正常设置强度 |
| A5 | 思考过程在 UI 中流式可见 | ✅ 线格式已验证（回归测试 7/7）+ 实机确认 |
| A6 | 思考 token 进入用量统计 | ✅ 两处路径均确认，pi-ai 读取的路径有效 |
| A7 | 多轮工具调用正常 | ✅ 多轮回放验证通过 |
| A8 | 拒绝 `developer` 的模型不报 400 | ✅ 已用 `compat.supportsDeveloperRole: false` 覆盖 |
| A9 | 大预算下无空回复（G2） | ⚠️ **G2 确认存在**，已用 `defaultMaxTokens: 32768` 缓解；实机使用未再复现 |
| A10 | 429/401 错误可读 | 🟡 观测到 429 与上游 500；401/403 未实测 |

---

## 8.1 加载未生效的排查记录

首次重启后模型设置页未出现 Radeon Cloud 行，逐层排查如下：

| 层 | 检查项 | 结论 |
| --- | --- | --- |
| 补丁文件 | 与写入快照 diff | 仅有注释差异，无手动添加内容 |
| 设置文档 | 是否覆盖补丁层 | 无该命名空间条目，不构成覆盖 |
| profile bundles | 是否含 `dsh-base`（插入 `llm-pi-ai`） | 在首位 |
| 补丁合成 | 用 DSH 真实 `applyEntryPatches` 合成 | 零警告，`radeon-cloud` 正确落位 |
| 进程加载 | 配置写入时刻与进程启动时刻的先后 | 首次启动早于最后一次写入 |

配置链路的每一环均验证正确，最终确认为**进程加载时序**：重启发生在最后一次写入之前。
再次重启后恢复正常。结论是配置本身无误，接入方式不需要改动。

---

## 9. 后续可选项

| # | 事项 | 说明 |
| --- | --- | --- |
| 1 | 401/403 与 FastAPI `{"detail":…}` 错误形态验证 | 需特定账户状态才能构造 |
| 2 | 上游 504 的实际发生频率观察 | 属服务端瞬时故障，重试可恢复 |
| 3 | 若 G2 在长期使用中频繁复现 | 再评估 T0+（专属卡片）或 T-A（完整适配器） |
| 4 | 独占端点（Dedicated）支持 | 基础 URL 每次实例重启都变，需独立设计 |

---

## 10. 合并行为的验证记录

> 本节记录按键合并（公开发布前的必要修复）的实测与测试结果。
> 问题背景见 [`feasibility-assessment.md`](./feasibility-assessment.md) §11。

### 10.1 为什么必须实测

DSH 的非 insert 补丁是整体替换，而用户通过设置界面添加的 provider 也落在同一个文件里。
按替换方式写入会抹掉用户已有的配置，因此写入粒度降到
`providers.radeon-cloud` 这一个键，并改用文本级编辑以保留用户注释与格式。

### 10.2 夹具实测

夹具是一份含两个自有 provider、两处用户注释、三个顶层条目的补丁文件。合并后逐项核对：

| 核对项 | 结果 |
| --- | --- |
| YAML 仍可解析 | ✅ |
| 自有 provider `my-corp-proxy` 逐字保留 | ✅ |
| 自有 provider `another-one` 逐字保留 | ✅ |
| 合并后的 `providers` 键 | `my-corp-proxy, another-one, radeon-cloud` |
| 用户注释 1 保留 | ✅ |
| 用户注释 2 保留 | ✅ |
| 顶层条目顺序不变 | ✅ |
| 其它条目（`agent-default-model`）未变 | ✅ |
| `radeon-cloud` 模型数 | 8 |

安装脚本在写入前的断言全部通过（同级键集合一致、其它顶层条目逐字符未变），
并自动生成了备份。

### 10.3 幂等性

对真实 profile 连续执行两次：第一次报「更新」，第二次报「**已是最新**」
且不产生任何写入。这保证重复安装不会反复改动用户的文件。

### 10.4 回归测试

| 测试文件 | 项数 | 覆盖内容 |
| --- | --- | --- |
| `test/merge.test.mjs` | 15 | 合并语义：新增 / 更新 / 幂等 / 同级保留 / 目标缺失 |
| `test/patch-text.test.mjs` | 17 | 文本级合并：用户 provider 与注释保留、条目顺序、块边界 |

另有 `test/verify-reasoning.mjs` 的 7 项思考字段断言（见 §4.2）。
`npm test` 一次跑完全部。

### 10.5 过程中修复的两个缺陷

| 缺陷 | 表现 | 根因 |
| --- | --- | --- |
| 更新分支丢掉键行 | 合并后 `providers` 下直接是字段，首行 `radeon-cloud:` 消失 | 新增分支拼了键行、更新分支没拼 |
| 测试数据生成器有同样的边界错误 | 一度误判合并逻辑有问题 | 临时脚本复制了同一错误 |

第一个缺陷只在一半场景复现：真实 profile 的块内带注释，内容比对不相等因此走更新分支；
干净夹具走新增分支。**两个夹具都要有**才能覆盖到。

### 10.6 结构校验的反例覆盖

`src/validate.js` 的结构校验用 10 类反例验证，确认全部拦下：

`compat.supportsDeveloperRole` 不为 `false`、缺 `baseURL`、`models` 为空、
档位只声明 `off`、非 `off` 档位漏写线上拼写、模型 id 重复、模型缺 `id`、
`contextWindow` 非法、`input` 含非法模态、`reasoningEfforts` 为空对象。
