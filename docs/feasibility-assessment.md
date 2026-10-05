# Radeon Cloud Patcher — 可行性评估报告

| 项目 | 内容 |
| --- | --- |
| 文档类型 | 可行性评估（Feasibility Assessment） |
| 版本 | **v2.3**（补记薄壳阶段的关键发现：配置会破坏用户自有的 provider） |
| 日期 | 2026-10-04 |
| 状态 | **✅ 已交付并通过实机验收** — 思考强度可正常设置，返回内容已规范化 |
| 交付形态 | `dsh-radeon-cloud-patcher`：配置本体 + 薄壳插件（分发 / 版本闸门 / 写入 / 看护） |
| 评估对象 | 让 DSH 正确使用 AMD Radeon Cloud，特别是**模型思考功能** |
| 评估依据 | DSH 官方文档 + 本机已安装 DSH SDK 源码（`dsh 0.2.0-rc.2`）+ AMD Radeon Cloud 官方文档 |

> **证据等级**：`[已确证]` 本机源码逐行核对 ｜ `[文档明确]` AMD 官方文档写明 ｜ `[文档推断]` 由事实推导 ｜ `[待验证]` 文档缺失或自相矛盾，**不可作为编码依据**

> **📌 本文主体（§1–§7）写于「纯配置」阶段，是当时的决策依据。**
> 该形态已于 2026-10-04 升级为 `dsh-radeon-cloud-patcher`：配置本体不变，
> 外加一层薄壳补齐分发、版本闸门与启动校验。
> **升级过程中发现了一个当时未识别的阻断性问题——纯配置形态会破坏用户自行添加的
> provider**，详见新增的 [§11](#11-补记纯配置形态会破坏用户自有的-provider)。
> §8 的三级阶梯与 §10 的最终建议据此更新。

---

## 1. 结论摘要（v2.0 重大修订）

### 1.1 结论

**可行，且大概率无需写任何代码。**

v1.0 曾建议「实现一个完整的 `LlmAdapter`」（约 5 人日）。**该结论已被推翻**：本机 SDK 深查发现，DSH 已内置 `dsh-llm-pi-ai` —— 一个**通用的 OpenAI 兼容 provider**，其 `compat` 开关与 `reasoningEfforts` 声明**正是为「第三方网关有非标准思考词汇」这一场景设计的**。

更关键的是一条硬约束（下称 **G1**）：

> `dsh-client-ui-settings-models/lib/client.js:1492-1497`
> ```js
> function layoutOf(ns) {
>   if (ns === "llm-deepseek") return "deepseek";
>   if (ns === "llm-pi-ai")     return "pi-ai";
>   return "unknown";            // ← 提交按钮被永久禁用
> }
> ```
> 模型设置页的编辑器布局**只认这两个命名空间**。第三方命名空间会渲染出一行，但编辑器只显示提示文字，且 `submitDisabled: layout === "unknown"` —— 用户**无法输入 API 密钥、无法改 baseURL、无法编辑模型目录** `[已确证]`

**G1 使「复用 `llm-pi-ai` 命名空间」成为唯一可行的配置路径**，而不是仅仅是最优选择。

因此推荐路径：

```
【方案 0（推荐）】在 llm-pi-ai 命名空间下新增一个 provider profile
                  → 零代码，纯配置，完整 GUI 支持
                  → 预期 0.5 人日验证 + 0.5 人日联调

【方案 A（备选）】自研 LlmAdapter 插件
                  → 仅在方案 0 的残余缺口无法接受时才做
                  → 约 2–3 人日（远小于 v1.0 的 5 人日）
```

### 1.2 方案 0 的覆盖度

| Radeon 非标准点 | pi-ai 配置旋钮 | 状态 |
|---|---|---|
| 思考文本在 `message.reasoning`（非 `reasoning_content`） | 内建多字段读取 `["reasoning_content","reasoning","reasoning_text"]` | ✅ **自动覆盖** |
| 思考 token 在 `completion_tokens_details.reasoning_tokens` | 内建读取该路径 | ✅ 自动覆盖 |
| 逐模型思考档位（`none`/`minimal`/`xhigh`…） | `reasoningEfforts`（键=档位，值=线上拼写） | ✅ **配置即解决** |
| `reasoning_effort` 字段名 | `compat.thinkingFormat: openai` | ✅ 自动覆盖 |
| `developer` 角色被 4/7 模型拒绝 | `compat.supportsDeveloperRole: false` | ✅ **一行配置** |
| 不传档位也会思考的模型 | `reasoningEfforts.off` 映射 / `omitWhenOff` | ✅ 配置即解决 |
| `max_tokens` 字段名 | `compat.maxTokensField: max_tokens` | ✅ 配置即解决 |
| `stop` 被静默丢弃 | pi-ai 直接抛 `UNSUPPORTED_OPTION` | ✅ **响亮失败**，优于静默 |
| 429 `Retry-After: 60` | `retryPolicy.backoff.maxDelayMs` | ✅ 配置即解决 |
| 流式 10 分钟「分片间隔」语义 | `streamIdleTimeoutMs` | ✅ 配置即解决 |
| **思考挤占 `max_tokens` → 空回复** | **无旋钮**（三个 budget 字段 Radeon 全不接受） | ⚠️ **残余缺口 G2** |
| **平台层错误信封 `{"detail":…}`** | **未确认可解析** | ⚠️ **残余缺口 G3** |
| **模型目录动态性** | `models` 为静态声明 | ⚠️ **残余缺口 G4** |

**13 类偏差中 10 类零配置解决，3 类残余。**

### 1.3 工作量

| 方案 | 估计 | 说明 |
|---|---|---|
| **方案 0** | **约 1 人日** | 写 1 份 YAML 配置 + 联调 + README |
| 方案 A | 2–3 人日 | 仅在 G2/G3/G4 不可接受时 |

---

## 2. 关键约束 G1：为什么必须复用 `llm-pi-ai` 命名空间

DSH 的 LLM 运行时持有**三个互相独立的注册表** `[已确证]`：

```js
// dsh-llm/lib/index.js:1797-1799
adapters   = new Map();   // provider 路由 → adapter      ← registerAdapter()
directory  = new Map();   // provider 路由 → 可配置条目    ← registerConfigurableProviders()
discoveries= new Map();   // settingsNs → 发现函数         ← registerModelDiscovery()
```

**只调 `registerAdapter` 是不够的**：路由可被调用（出现在 `listProviders()`），但模型设置页看不到它（`directory` 无条目 → 无 `displayName`、无 `settingsNs`、无密钥输入框）。

而即使补上 `registerConfigurableProviders`，**G1 仍然成立**：第三方 `settingsNs` 会命中 `layoutOf() === "unknown"`，编辑器与提交按钮失效。

三条出路的取舍：

| 出路 | 评价 |
|---|---|
| **复用 `llm-pi-ai` 命名空间** | ✅ **推荐**。直接在其 `providers` 下新增一个路由，得到完整编辑器、密钥输入、模型目录、`compat` 开关。**零代码。** |
| 把 cordis.yml 行 id 命名成 `llm-deepseek` | ❌ 与内置 DeepSeek 行 id 冲突 |
| 自带 client UI 插件填充 `settings.models.provider-card` 槽位 | ⚠️ 可行但成本高，仅在需要完全定制 UI 时考虑 |

> **结论：G1 直接决定了「方案 0」是唯一无需写代码的正确路径。**

---

## 3. 方案 0 详述：Radeon Cloud 的 pi-ai profile

### 3.1 pi-ai provider profile 的可用字段（已核对 schema）`[已确证]`

`dsh-llm-pi-ai/lib/index.js:1017-1049`：

```ts
const profile = z.object({
  apiKeyEnv, displayName, api, baseURL,
  models, modelOverrides, compat,
  defaultContextWindow, defaultMaxTokens, defaultInput,
  headers, reasoning, thinkingBudgets, cacheRetention,
  transport, timeoutMs, streamIdleTimeoutMs,
  maxRequestImageBytes, requestImagePixelBudget, requestImageMaxBytes,
  retryPolicy: RetryPolicySchema
});
const Config = z.object({ providers: z.dict(profile).default({}).volatile() });
```

模型条目字段（`:1003-1010`）：`{ name, contextWindow, maxTokens, input, reasoningEfforts, compat }`

### 3.2 思考档位 → 线上拼写（Q2 的正解）`[已确证]`

`dsh-llm-pi-ai/lib/index.js:553, 568-588`：

> 「A declared dict translates to pi-ai's `thinkingLevelMap`…」
> `reasoningEfforts.${level}` 需要线上拼写；**只有 `off` 可以留空**

```yaml
reasoningEfforts:
  off: none        # 发送 reasoning_effort: "none"
  medium: medium   # 发送 reasoning_effort: "medium"
```

这**精确覆盖了 AMD 逐模型不同的档位表**，且 `off → none` 的映射正是 Q3（不传也会思考）的正解。`off:` 留空则表示「省略该字段」。

### 3.3 建议的 Radeon profile（草案，待联调校正）

```yaml
- name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      radeon-cloud:
        displayName: Radeon Cloud
        apiKeyEnv: RADEON_API_KEY
        api: openai-completions
        baseURL: https://developer.amd.com.cn/radeon/api/v1
        reasoning: medium                    # 默认档位（官方推荐的全模型合法值）
        defaultMaxTokens: 8192               # 见 G2：需留足思考余量
        streamIdleTimeoutMs: 600000          # 文档：流式为分片间隔 10 分钟
        retryPolicy:
          mode: normal
          maxRetries: 5
          backoff: { initialDelayMs: 1000, maxDelayMs: 120000, jitterRatio: 0.2 }
        compat:
          supportsDeveloperRole: false       # ★ 关键：4/7 模型拒绝 developer
          supportsReasoningEffort: true
          supportsThinkingTokenBudget: false # ★ 关键：Radeon 三个 budget 字段全不接受
          maxTokensField: max_tokens
          thinkingFormat: openai
        models:
          - id: DeepSeek-V4.1-Flash
            contextWindow: 1048576
            input: [text, image]
            reasoningEfforts:
              off: none
              low: low
              medium: medium
              high: high
              xhigh: xhigh
          - id: Qwen3.8-27B
            contextWindow: 131072
            input: [text, image]
            reasoningEfforts:                 # 不声明 off：该模型不接受 none
              low: low
              medium: medium
              xhigh: xhigh
```

> ⚠️ **档位表来自 AMD 文档的模型参考页，而非 API**。`GET /v1/models` **不返回**逐模型档位 —— 这是 G4 的根源，也是 `[待验证]` 项最多的地方，**必须逐模型实测校正**。

### 3.4 三条关键旋钮的代码依据

| 旋钮 | 代码位置 | 作用 |
|---|---|---|
| `supportsDeveloperRole` | `openai-completions.js:896, 1261, 1313` | `const instructionRole = model.reasoning && compat.supportsDeveloperRole ? "developer" : "system"` —— 自动检测对普通 OpenAI 兼容端点返回 `true`，**必须显式关掉** |
| `thinkingFormat: openai` | `openai-completions.js:712-719` | 走 `params.reasoning_effort = thinkingLevelMap[level] ?? level`，即 Radeon 要的字段名 |
| `reasoningEfforts` → `thinkingLevelMap` | `dsh-llm-pi-ai:553,588` | 档位重命名/裁剪；`off` 留空即省略 |

---

## 4. 残余缺口（方案 0 无法覆盖的部分）

> 📌 **本节已于 2026-10-04 经真机实测更新**，完整记录见 [`live-verification.md`](./live-verification.md)。
> 下表的「实测结论」列是测量结果，优先于文档推断。

| ID | 缺口 | 严重度 | 实测结论 | 现状 |
| --- | --- | --- | --- | --- |
| **G2** | **思考挤占 `max_tokens` → 空回复** | 🔴 高 | **确认存在且严重**：`effort=low` 时 `max_tokens` 为 16/40/120/400 **全部返回空 content**；`effort=none` 则正常 | ✅ 已缓解：`defaultMaxTokens` 提至 **32768** |
| **G3** | **平台层错误信封 `{"detail":…}`** | 🟡 中 | 只观测到 OpenAI 形状的 `upstream_error`（HTTP 500 包装上游 504），可正常解析；FastAPI `detail` 形态未触发 | 🟡 部分验证 |
| **G4** | **模型目录动态性 + 档位表不在 API** | 🟡 中 | **实测确认**：`GET /v1/models` 的 `supported_parameters` **对所有模型都不含** `reasoning_effort`（风险 K8 实证）；档位表只能实测 | ✅ 已用 `scripts/probe-efforts.mjs` 实测固化 |
| ~~G5~~ | ~~`usage.reasoning_tokens` 顶层回退~~ | — | **不成立**：顶层与 `completion_tokens_details` **两处都存在且数值一致**，AMD 文档的自相矛盾在实测中不成立 | ✅ **已消解** |
| ~~G6~~ | ~~助手历史回放是否需回传思考内容~~ | — | **不成立**：pi-ai 按「读取时用的字段名」回放，我方场景写 `assistant.reasoning`，实测 **HTTP 200 且回答正确** | ✅ **已消解** |

### 4.1 实测新发现：流式思考的静默失效陷阱

流式中思考文本在 **`delta.reasoning`**，但同一流首个分片带 **`delta.reasoning_content: null` 占位**——
两个字段名并存。只读 `reasoning_content` 的实现会拿到 `null`，**思考功能静默失效且无任何报错**。

DSH 所用 pi-ai 的字段选择逻辑（`typeof value === "string" && value.length > 0`）会正确跳过 `null`，
**DSH 侧无需任何改动**。已固化为回归测试 `test/verify-reasoning.mjs`（7/7 通过）。

**结论：原风险 K1（流式思考字段名未知）已消解，G5/G6 两个缺口亦消解。
剩余高危项只有 G2，且已用预算调整缓解。**

---

## 5. 方案 A 备选：自研 `LlmAdapter`（仅在需要覆盖 G2/G3/G4/G6 时）

### 5.1 何时才值得

| 触发条件 | 建议 |
|---|---|
| T0 联调通过，G2/G3/G6 均可接受 | **停在 T0**，不写代码 |
| 只是想要一个专属界面 | **上 T0+**（纯客户端插件，参考件约 318 行可改造） |
| G2 空回复在真实使用中频繁出现且无法靠调大 `defaultMaxTokens` 缓解 | 上 T-A |
| G3 错误信息确实不可读 | 优先考虑更轻的包装，而非整个 adapter |
| 需要独占端点（Dedicated）支持 | 上 T-A（基础 URL 每次重启都变，配置模型无法表达） |

> ✅ **G1 已有成熟解法**：`settings.models.provider-card` 槽位，可在其内部用 `display:none` 藏掉官方空壳编辑器、原地插入自有卡片。参考 `@mars-sea/dsh-commandcode-provider` 的 `client-src/card.tsx`（318 行）。详见 [`reference-commandcode-provider.md`](./reference-commandcode-provider.md) §4。

### 5.2 若走方案 A，必备要求（v1.0 遗漏项已修正）`[已确证]`

| # | 要求 | 缺失后果 |
| --- | --- | --- |
| 1 | `export const inject = ['llm']` | `ctx.llm` 未定义 |
| 2 | `export const Config` 为 Schemastery schema（非普通对象） | 行配置不校验 |
| 3 | **所有用户可见字段必须 `.volatile()`** | 命名空间根本不出现在设置页；`settings.update` 抛 `Config field "x" is not volatile` |
| 4 | 三注册表齐全（§2） | 模型设置页看不到 / 密钥读不到 |
| 5 | `settingsNs` **必须等于 cordis.yml 行的 `id`**（`ctx.fiber.entry?.options.id`），而非包名 | 行渲染但配置无法寻址 |
| 6 | profile 在 `settingsPath` 处有**字面名为 `apiKeyEnv`** 的字符串字段 | 密钥状态检测失败 |
| 7 | `adapter.listModels()` 返回**非空** | **模型选择器整组被丢弃**（`filter(g => g.models.length > 0)`），且不在 `routableProviders` |
| 8 | `adapter.resolveModel()` 返回 `reasoning` | 选择器**不显示思考档位控件** |
| 9 | 每次 provider 请求带 `attributionHeaders()` | 违反 DSH 契约 |
| 10 | 命名空间必须是 `llm-pi-ai`/`llm-deepseek`，否则需自研 client UI | **G1：提交按钮永久禁用** |
| **11** | **必须实现 `stream()`** —— 它是**抽象方法且基类无默认实现** | 基类 `prepareCall` 调用 `this.stream()` → 运行时崩溃 |
| **12** | **必须实现 `listModels`/`resolveModel`/`prepareCall` 之一或全部**；只依赖基类默认实现会导致 `listModels` 返回空数组 | 同上第 7 条 |

> ⚠️ 第 7、8 条尤其反直觉：**模型选择器用的是 `listModels()`，不是 `discoverModels()`**；而思考档位只经由 `resolveModel()` 进入目录。两者任一缺失，GUI 都会「看起来没坏，但不能用」。

### 5.3 `LlmAdapter` 的权威抽象声明 `[已确证]`

`dsh-llm/lib/typert.host.js`（`LlmAdapter`）：

```ts
export abstract class LlmAdapter {
    providerInfo(provider: string): LlmProviderInfo;
    providerRetryPolicy(_provider: string): ResolvedRetryPolicy | undefined;
    imageRequestPricing(_provider: string, _model: string): LlmImageRequestPricing | undefined;
    listModels(_provider: string): Promise<readonly LlmModelInfo[]>;
    resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
    prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall>;
    abstract stream(options: GenerateOptions): AsyncIterable<StreamChunk>;   // ← 无默认实现
}
```

> 第 11 条即源于此：`stream()` **必须自己实现**，或整体覆盖 `prepareCall()`（`dsh-llm-deepseek` 两者都实现，以便把配置「世代」钉在单次调用上）。

### 5.4 产出流的硬性不变式 `[已确证]`

`dsh-llm/lib/invariant.js` 的独立校验器给出完整语法，实施方案 A 时应把它挂进测试：

| 规则 | 违反后果 |
| --- | --- |
| `finish` 恰好出现一次，且是终止块 | 流被视为无效 |
| `usage` 至多出现一次 | 重复用量 |
| `index` 为非负安全整数；delta 必须有**类型匹配的打开块** | 装配错乱 |
| `block-end.block.type` 必须等于 `block-start.blockType` | 类型不一致 |
| 仅 `error`/`aborted` 结束时允许留有未关闭块 | 正常结束却留开口块 |

其余要点：
- **抛 `LlmError` 而非原生 `Error`** —— 只有 `HarnessError` 子类的 `code` 才会进入 `finish.reason.failure.code`；非 `HarnessError` 一律降级为 `UNKNOWN` `[已确证]`
- **流中途失败靠 `throw` 表达，不要自己造 `error` chunk** —— 运行时 `adapterFailureChunk()` 会统一转换（`aborted` / `error` 二分）`[已确证]`
- `ReasoningBlock` 就是 `{type:'reasoning', text}`，**思考签名不进块**，走 `MessageSource.replayState` `[已确证]`
- 传输层建议 `redirect: 'error'`，防止凭据被重定向泄露到其他源 `[已确证]`

### 5.5 G3 的实现模板（若走到方案 A）

`dsh-llm-deepseek` 的 `providerError()` 是可直接套用的 **HTTP 状态 → provider 中立错误码** 映射范式 `[已确证]`：

```
401|403|authentication_error|permission_error → AUTH
402 或额度措辞                                      → QUOTA
429|rate_limit_error                               → RATE_LIMIT
上下文溢出措辞                                     → CONTEXT_WINDOW_EXCEEDED
400|413|invalid_request_error                      → INVALID_REQUEST
>=500|api_error|overloaded_error                   → SERVER
其余                                               → HTTP_<status>（流内错误无状态时 → SERVER）
```
并读取 `Retry-After` 写入 `providerRetryAfterMs`（DSH 原生字段，`dsh-llm-retry` 会据此退避）。复用 `dsh-llm` 导出的 `isContextWindowExceededError()` / `isQuotaExceededError()` 即可覆盖 Radeon 的固定措辞。

---

## 6. Radeon Cloud 线格式差异矩阵（保留，作为方案 A 的实现依据）

### 6.1 请求方向

| # | 维度 | Radeon 行为 | 证据 | pi-ai 处理 |
| --- | --- | --- | --- | --- |
| Q1 | 思考控制字段 | `reasoning_effort` 或 `reasoning.effort`，**互斥** | `[文档明确]` | `thinkingFormat: openai` → 只发前者 |
| Q2 | 档位取值 | 逐模型不同；`high` 在 Qwen3.8-27B 上 **400**，`xhigh` 在 GLM 上 **422** | `[文档明确]` | `reasoningEfforts` 逐模型声明 |
| Q3 | 省略档位是否思考 | 逐模型不同（Qwen×2、GLM 不传也思考） | `[文档明确]` | `off` 映射 / 留空省略 |
| Q4 | `max_tokens` 语义 | **思考与答案共用预算** | `[文档明确]` | ⚠️ **无旋钮（G2）** |
| Q5 | `developer` 角色 | **7 个模型中仅 3 个接受** | `[文档明确]` | `supportsDeveloperRole: false` |
| Q6 | `system` 位置 | Qwen 两模型要求唯一且最前 | `[文档明确]` | 默认剥离 developer 消息；需实测 |
| Q7 | `temperature` | messages 路径 0..1 | `[文档明确]` | 主路径不涉及 |
| Q8 | `max_tokens` 必填 | messages 路径必填 | `[文档明确]` | `maxTokensField: max_tokens` |
| Q9 | 模型目录形状 | **无 `object`/`created`/`owned_by`** | `[文档明确]` | 手工声明 `models` 规避 |
| Q10 | 未知模型 | **400**（非 404） | `[文档明确]` | 观察 |
| Q11 | 端点可用性 | 共享端点仅 4 个，其余 `404` | `[文档明确]` | `api: openai-completions` 只用 2 个 |
| Q12 | 认证 | `Authorization: Bearer` 优先于 `x-api-key` | `[文档明确]` | `apiKeyEnv` |
| Q13 | 密钥格式 | `rc-` + 48 hex = 51 字符 | `[文档明确]` | `assertUsableApiKey` |

### 6.2 响应方向

| # | 维度 | Radeon 行为 | pi-ai 处理 |
| --- | --- | --- | --- |
| R1 | **思考文本（非流式）** | `choices[0].message.reasoning` | ✅ 多字段读取（`openai-completions.js:399`） |
| R2 | **思考文本（流式）** | 文档未写 delta 字段名 `[待验证]` | ✅ 同上多字段读取，**风险 K1 消解** |
| R3 | 思考 token | `completion_tokens_details.reasoning_tokens`（Qwen3.8-27B 缺失） | ✅ 已读该路径；顶层回退待验证（G5） |
| R4 | 结束原因 | chat 路径标准 | ✅ |
| R5 | 错误信封 | **三种并存** | ⚠️ G3 |
| R6 | 限流 | `Retry-After: 60`（每分钟）/ `1`（并发），6 种细分 code | ✅ `retryPolicy.backoff` |
| R7 | 上下文溢出 | 固定措辞 | ✅ |
| R8 | 用量明细 | `image_tokens` / `multimodal_tokens.image` | ✅ 可选 |
| R9 | 超时 | 流式=分片间隔 10 分钟 | ✅ `streamIdleTimeoutMs` |

---

## 7. 风险登记册（v2.0）

| ID | 风险 | 等级 | 状态/缓解 |
| --- | --- | --- | --- |
| ~~K1~~ | 流式思考 delta 字段名未知 | — | ✅ **已消解**：pi-ai 内建读取 `reasoning` / `reasoning_content` / `reasoning_text` |
| ~~K2~~ | 思考 token 位置文档矛盾 | — | 🟡 大部分消解；顶层回退为 G5 |
| K3 | `Retry-After: 60` vs 默认退避 | — | ✅ `retryPolicy` 配置 |
| K4 | `stop` 静默丢弃 | — | ✅ pi-ai 抛 `UNSUPPORTED_OPTION`，响亮失败 |
| **K5** | **思考挤占 max_tokens → 空回复** | 🔴 | ⚠️ **G2，唯一高危残余** |
| K6 | 并发超 8 | 🟢 | ✅ 单用户场景不触发 |
| K7 | 模型上下架 | 🟡 | ⚠️ G4 |
| K8 | `supported_parameters` 不可信 | 🟡 | ✅ 方案 0 不依赖它 |
| K9 | `developer` 角色 | — | ✅ 一行配置 |
| K10 | 流式超时语义 | — | ✅ `streamIdleTimeoutMs` |
| K11 | **缺 API 密钥 → 无法验收** | 🟠 | 🔴 **阻塞项**，见 §9 |
| K12 | DSH 契约变更 | 🟢 | ✅ 方案 0 只依赖公开配置 schema |

---

## 8. 决策请求

> 📖 **参考实现**：本机已安装的 `@mars-sea/dsh-commandcode-provider`（22,700 行完整第三方 provider 插件）已验证「自研插件」路线，并给出了 **G1 的成熟解法**（`settings.models.provider-card` 槽位，约 318 行）。详见 [`reference-commandcode-provider.md`](./reference-commandcode-provider.md)。

### 8.1 三级方案阶梯

| 级别 | 内容 | 工作量 | 界面 | 何时选 |
| --- | --- | --- | --- | --- |
| **T0** | 纯 `llm-pi-ai` provider 配置 | **0.5 天** | DSH 原生 pi-ai 编辑器 | **默认起点**：先把功能跑通 |
| **T0+** | T0 + **纯客户端**小插件（只注册 `provider-card`），给 Radeon 一个专属卡片 | **+0.5–1 天** | 自有品牌卡片 | 想要专属界面；`card.tsx` 可直接改造 |
| **T-A** | 完整自研 adapter + 卡片 + 独立设置页 | **2–3 天** | 完全自定义 | 仅当 **G2 实测不可接受** |

**实际执行结果**：T0 已交付并通过实机验收，**未**触发 T0+ 与 T-A（CP-1 判定思考功能完整可用）。
随后为公开发布补做了薄壳，见 [§11](#11-补记纯配置形态会破坏用户自有的-provider) 与
[§12](#12-补记实际交付形态)。

### 8.2 待决事项

| # | 问题 | 建议 |
| --- | --- | --- |
| ~~D1~~ | ~~是否有可用的 `rc-` API 密钥？~~ | ✅ **已确认有** —— P1 真机验收解除阻塞 |
| **D2** | 起步级别？ | **T0**。想要专属界面就一并上 T0+（但 `provider-card` 的分发键需在 P0 实测确认） |
| D3 | 是否只做共享端点？ | **是**。独占端点基础 URL 每次重启都变，配置模型无法表达 |
| D4 | 默认思考档位？ | **`medium`** —— 官方「一份通用客户端」推荐，全模型合法 |
| D5 | 交付形态？ | T0 纯配置；T0+/T-A 为标准 DSH 插件包（可由插件管理器按本地目录安装） |
| D6 | 模型列表怎么维护？ | 先手工声明 `models`；接受 G4 维护成本，或后续写生成脚本 |

---

## 9. 验收标准（按方案 0 调整）

| # | 标准 | 验证方式 |
| --- | --- | --- |
| A1 | 模型设置页出现 Radeon Cloud 行，**编辑器可用**（非 unknown 布局） | GUI |
| A2 | 可输入并保存 API 密钥 | GUI |
| A3 | 模型选择器显示 Radeon 模型 | GUI |
| A4 | **思考档位控件按模型显示**（验证 `resolveModel`/`reasoningEfforts` 生效） | GUI |
| A5 | **思考过程在 UI 中流式可见** | 真机 |
| A6 | 思考 token 进入用量统计 | 真机 |
| A7 | 多轮工具调用正常 | 真机 |
| A8 | Qwen2 类模型不因 system/developer 报 400 | 真机 |
| A9 | 大 `max_tokens` 下无空回复（G2） | 真机 |
| A10 | 429/401 错误可读 | 真机 |

---

## 10. 最终建议

**方案 0 已实施并通过实机验收。** 但其「零代码、纯配置」的形态**不能直接公开发布**——
它会破坏用户自行添加的 provider，见 §11。公开形态见 §12。

理由：
1. 13 类线格式偏差中 10 类被 pi-ai 内建机制或配置旋钮直接覆盖；
2. 唯一高危残余 G2 有明确的低风险缓解（调大 `defaultMaxTokens`）；
3. G1 使自研适配器必须自建 client UI 才能获得完整 GUI，成本远高于方案 0；
4. 方案 0 保留了「随时升级到方案 A」的路径，G2 若真实发生再启动。

**唯一阻塞项是 D1（API 密钥）**：不影响配置编写，只影响真机验收。

---

## 附录 A：证据来源

### DSH（本机 `node_modules/@deepseek-ai/`，`dsh 0.2.0-rc.2`）
- `dsh-llm/lib/index.js:1797-1799`（三注册表）、`1833-1852`（`registerAdapter`）、`1910-1953`（`registerConfigurableProviders`）、`1974-2014`（`registerModelDiscovery`/`discoverModels`）、`2283-2355`（`adapterStream` 投影）、`2390`（导出表）
- `dsh-llm/lib/typert.host.js` — `StreamChunk`/`ContentBlock`/`FinishReason`/`TokenUsage`/`LlmResolvedModelInfo`/`LlmFailure`/`GenerateOptions` 权威声明
- `dsh-llm/lib/types/index.js:643-714`（reasoning 校验）、`170-180`（`listModels` 契约）
- `dsh-llm-pi-ai/lib/index.js:963-990`（`compatProfile`）、`1003-1051`（profile/model schema）、`553,568-588`（`reasoningEfforts`→`thinkingLevelMap`）、`1848`（`stop` 抛错）、`2568`（凭据解析）
- `dsh-llm-deepseek-api-key/lib/index.js`（完整 `apply()` 参考实现）
- `dsh-client-ui-settings-models/lib/client.js:1492-1497`（**G1**）
- `dsh-api-session-controller/lib/types/catalog.js:10-59`（`buildModelCatalog`、空模型组被过滤）
- `@earendil-works/pi-ai/dist/api/openai-completions.js:399`（思考字段多读）、`712-719`（effort 发送）、`896`（system 角色）、`1183`（思考 token）、`1259-1289,1313-1323`（compat 自动检测与覆盖）
- `dsh-base/cordis.patch.yml:127-128`（`llm-pi-ai` 默认加载）

### AMD Radeon Cloud
[API 概览](https://amd-aim.github.io/radeon-cloud-docs/zh-cn/api/overview/) ｜ [聊天补全](https://amd-aim.github.io/radeon-cloud-docs/zh-cn/api/chat-completions/) ｜ [Messages](https://amd-aim.github.io/radeon-cloud-docs/zh-cn/api/messages/) ｜ [模型](https://amd-aim.github.io/radeon-cloud-docs/zh-cn/api/models/) ｜ [错误](https://amd-aim.github.io/radeon-cloud-docs/zh-cn/api/errors/) ｜ [限流](https://amd-aim.github.io/radeon-cloud-docs/zh-cn/api/rate-limits/) ｜ [认证](https://amd-aim.github.io/radeon-cloud-docs/zh-cn/api/authentication/) ｜ [独占端点](https://amd-aim.github.io/radeon-cloud-docs/zh-cn/api/dedicated-endpoints/) ｜ [**Model reference（思考行为与档位表）**](https://amd-aim.github.io/radeon-cloud-docs/models/overview/) ｜ [DeepSeek-V4.1-Flash](https://amd-aim.github.io/radeon-cloud-docs/models/deepseek-v4-1-flash/)

---

## 11. 补记：纯配置形态会破坏用户自有的 provider

> 本节记录的是写完 §1–§10 之后、在为公开发布补做薄壳时才发现的问题。
> 它**推翻了「纯配置形态可以直接公开发布」的结论**。

### 11.1 问题

原先的接入方式是往 DSH profile 的 `cordis.patch.yml` 写一段**非 insert 补丁**，
把 `llm-pi-ai` 的 config 整块替换掉。问题出在两处机制叠加：

**其一，DSH 的非 insert 补丁是整体替换，不是合并** `[已确证]`：

```js
// cordis-plugin-include/lib/index.js:56-105
for (const [key, value] of Object.entries(overrides)) { if (key === 'id') continue; target[key] = value }
```

**其二，用户通过设置界面添加的 provider，最终也落在同一个文件里** `[已确证]`。
旧的 `settings.yaml` 已被废弃，其内容「迁入 profile」：

```js
// dsh-settings/lib/index.js:343-351
/** Move the sections of the removed `settings.yaml` into the active profile … */
const path = join(profile.home, "settings.yaml")
```

两者叠加的后果：**用户自己在 `llm-pi-ai` 下添加的 provider，正好在被整体替换的那一块里，
会被直接抹掉。** 这对个人使用无感（通常只有一个 provider），但对公开发布是不可接受的——
安装一次就可能破坏用户已有的环境。

### 11.2 修复

写入粒度从「整块替换」降到「单个键」：只新增或替换 `providers.radeon-cloud`，
其余同级键原样保留。

同时必须改用**文本级编辑**：若把整份 YAML 解析后再序列化，注释、缩进风格与键序
都会被重排，等于用工具把用户自己维护的文件重写了一遍。

写入前断言「除本项目外的同级 provider 键集合一致」且「`llm-pi-ai` 之外的顶层条目
逐字符未变」，任一不成立即中止且不落盘，并自动备份。

### 11.3 修复过程中抓到的两个缺陷

| 缺陷 | 表现 | 根因 |
| --- | --- | --- |
| 更新分支丢掉键行 | 合并后 `providers` 下直接是字段，首行的 `radeon-cloud:` 消失 | 新增分支拼了键行、更新分支没拼；真实 profile 因块内带注释走更新分支，干净夹具走新增分支，因此只在部分场景复现 |
| 测试数据生成器有同样的边界错误 | 一度误判合并逻辑有问题 | 临时脚本复制了同一个错误；改用手写夹具后才定位清楚 |

两者都说明：**这类改动必须靠测试固定住**，因为「干净输入」与「真实输入」会走不同分支。

### 11.4 验证

32 项回归测试（合并语义 15 + 文本级合并 17）全部通过，覆盖：用户 provider 逐字保留、
用户注释保留、条目顺序不变、幂等（重复执行不产生写入）、缺失目标条目不崩溃。
另在含两个自有 provider 与两处注释的夹具上实测通过。

---

## 12. 补记：实际交付形态

```
provider/radeon-cloud.yml     配置本体（唯一真源，与 §3 的内容一致）
src/                          薄壳：分发、版本闸门、按键写入、启动校验
scripts/                      安装、校验、档位实测、API 调用
test/                         32 项合并与思考字段回归测试
```

与 §8 阶梯的对应关系：

| 原阶梯级别 | 是否采纳 | 说明 |
| --- | --- | --- |
| T0（纯配置） | ✅ 已实施 | 即 `provider/radeon-cloud.yml` |
| T0+（纯客户端专属卡片） | ❌ 未采纳 | CP-1 实测思考功能完整可用，界面为原生 pi-ai 编辑器，无需自定义 |
| T-A（完整自研适配器） | ❌ 未采纳 | 未复现 G2 空回复；薄壳的启动校验已足以覆盖失效风险 |

薄壳不接管任何 provider 逻辑——传输、思考字段解析、多轮回传、用量计量仍全部由
`llm-pi-ai` 承担。

### 12.1 一项诚实的能力边界

薄壳在启动时做的是**结构校验**，它能发现「配置写错了」，但发现不了
「上游把某个字段改了名」。原因是 DSH 的包在 profile 的 `node_modules` 里不可解析，
插件运行时拿不到 `llm-pi-ai` 的真实 schema。

那道校验由 `npm run validate` 承担（按应用包绝对路径加载真实 schema），
建议接入 CI，或在升级 DSH 之后手工运行一次。