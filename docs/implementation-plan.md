# Radeon Cloud 接入 — 实施计划（含检查点）

| 项目 | 内容 |
| --- | --- |
| 文档类型 | 实施计划（Implementation Plan with Checkpoints） |
| 版本 | **v2.2**（补记薄壳阶段：P4 冲突修复与 P5 公开形态） |
| 日期 | 2026-10-04 |
| 状态 | **✅ 全部阶段完成** — T0 通过实机验收；CP-1 判定不进入 P1.5 / P2；后续为公开发布补做 P4 / P5 |
| 前置文档 | [`feasibility-assessment.md`](./feasibility-assessment.md) v2.2 |
| 总工作量 | **约 1 人日**（方案 0）；条件性 +2–3 人日（方案 A）——**实际未触发** |

| 阶段 | 内容 | 结论 |
| --- | --- | --- |
| P0 | 配置骨架与离线校验 | ✅ 经 DSH 真实 schema 校验，补丁合成零警告 |
| P1 | 真机联调 | ✅ 思考链路、档位、多轮回放、空回复均已实测 |
| P4 | 冲突修复（按键合并） | ✅ 32 项回归测试覆盖，实测不影响用户自有 provider |
| P5 | 公开形态（薄壳） | ✅ 分发、版本闸门、启动校验就位 |
| P1.5 / P2 | 专属卡片 / 完整适配器 | ❌ CP-1 判定不需要，未启动 |

### 检查点结论

| 检查点 | 结论 |
| --- | --- |
| CP-0 配置被接受 | ✅ 通过。配置经 DSH 真实 schema 校验，补丁合成零警告 |
| CP-1 决策门禁 | ✅ 通过。思考功能完整可用，未复现 G2 空回复，**不需要专属卡片或完整适配器** |
| CP-4 冲突修复 | ✅ 通过。用户自有的 provider 与注释在夹具与真实 profile 上均完好 |
| CP-5 公开形态 | ✅ 通过。四处标识（包名 / 插件名 / 补丁行 id / 补丁 name）一致 |

---

## 0. 阶段总览

```
P0 配置骨架 ──CP-0──▶ P1 真机联调 ──CP-1──┬─▶ [功能全通] ──▶ P4 冲突修复 ──CP-4──▶ P5 公开形态 ──CP-5──▶ 完成
  （T0，0.5 天）    （0.5 天）             │                 ▲                                      ▲
                                          │                 └────────── 未执行的两条分支 ────────┘
                                          ├─ P1.5（T0+）专属界面卡片   ❌ 未采纳
                                          └─ P2（T-A）完整适配器      ❌ 未采纳
```

> **CP-1 是决策门禁**，不是进度检查。实测结论：思考功能完整可用、界面为原生
> pi-ai 编辑器、G2 未复现，因此 **P1.5 与 P2 均未启动**。
>
> 随后为公开发布补做两阶段，动机见 [`plugin-parity-assessment.md`](./plugin-parity-assessment.md)：
> - **P4** 修复「纯配置形态会破坏用户自有 provider」这一阻断性问题
> - **P5** 补齐分发、版本闸门、启动校验，形成公开形态

> 📖 参考实现分析见 [`reference-commandcode-provider.md`](./reference-commandcode-provider.md)（本机已安装的完整第三方 provider 插件，22,700 行）。

**检查点规则**：到达 `CP-n` 立即停止，不开始下一阶段；给出变更清单、验证命令与预期输出；不通过则在本阶段修复后重提，不跳过；每阶段均有独立回滚动作。

---

## 1. 阶段 P0 — 配置骨架与离线校验（**无需密钥**）

### 1.1 目标
写出完整的 pi-ai provider profile，并通过 DSH 的 schema 校验与目录构建。

### 1.2 交付物

```
dsh-radeon-cloud-patcher/
├── README.md                  # 用法、已知限制、故障排查
└── cordis.patch.yml           # 唯一的功能载体（纯配置）
```

### 1.3 `cordis.patch.yml` 内容

```yaml
# 插入到已存在的 llm-pi-ai 行。
# 注意：dsh-base/cordis.patch.yml 已默认加载 '@deepseek-ai/dsh-llm-pi-ai'，
# 本文件只是向其 providers 字典追加一个路由，不新增插件。
- insert:
    - id: llm-pi-ai
      name: '@deepseek-ai/dsh-llm-pi-ai'
      config:
        providers:
          radeon-cloud:
            displayName: Radeon Cloud
            apiKeyEnv: RADEON_API_KEY
            api: openai-completions
            baseURL: https://developer.amd.com.cn/radeon/api/v1
            reasoning: medium
            defaultMaxTokens: 8192
            streamIdleTimeoutMs: 600000
            retryPolicy:
              mode: normal
              maxRetries: 5
              backoff:
                initialDelayMs: 1000
                maxDelayMs: 120000
                jitterRatio: 0.2
            compat:
              supportsDeveloperRole: false
              supportsReasoningEffort: true
              supportsThinkingTokenBudget: false
              maxTokensField: max_tokens
              thinkingFormat: openai
            models:
              - id: DeepSeek-V4.1-Flash
                name: DeepSeek-V4.1-Flash
                contextWindow: 1048576
                input: [text, image]
                reasoningEfforts:
                  off: none
                  low: low
                  medium: medium
                  high: high
                  xhigh: xhigh
              - id: Qwen3.8-27B
                name: Qwen3.8-27B
                contextWindow: 131072
                input: [text, image]
                reasoningEfforts:
                  low: low
                  medium: medium
                  xhigh: xhigh
              - id: GLM-5.3-Flash
                name: GLM-5.3-Flash
                contextWindow: 262144
                input: [text]
                reasoningEfforts:
                  low: low
                  medium: medium
                  high: high
```

> ⚠️ **模型列表与档位表是草案。** `GET /v1/models` **不返回逐模型档位**，本表来自 AMD 文档的模型参考页，必须在 P1 逐项实测校正（K7）。

### 1.4 任务清单
- [ ] T0.1 用 `GET /v1/models` 拉取当前目录，校正 `models` 列表与 `contextWindow` / `input`
- [ ] T0.2 写入 `cordis.patch.yml`
- [ ] T0.3 启动 DSH，确认无 schema 校验错误
- [ ] T0.4 确认模型设置页出现 Radeon Cloud 行且**编辑器布局为 pi-ai**（G1 验证）
- [ ] T0.5 模型选择器确认模型分组非空（`listModels` 非空，否则整组被丢弃）

### 1.5 验证命令
```bash
# 离线确认目录形状与上下文窗口（可选，无密钥则跳过）
curl -s https://developer.amd.com.cn/radeon/api/v1/models \
  -H "Authorization: Bearer $RADEON_API_KEY" | jq '.data[] | {id, context_length, input: .architecture.input_modalities, reasoning: .providers[0].reasoning}'

# 启动并观察
pnpm dsh web --patch ./cordis.plugin.patch.yml
```

### 1.6 🛑 检查点 CP-0 — 配置被接受

| 项 | 内容 |
| --- | --- |
| **通过标准** | ① 启动无 schema 报错；② 模型设置页出现 Radeon Cloud 行，编辑器**可用**（非 unknown 布局，G1）；③ 模型选择器出现 Radeon 分组且**非空**；④ 每个思考模型都出现**档位控件** |
| **用户需确认** | 模型清单与档位表是否符合预期；`defaultMaxTokens: 8192` 是否合适 |
| **回滚** | 删除 `cordis.patch.yml`，重启 |
| **无需密钥** | 本阶段可完整验证（G1/档位控件均不依赖真实请求） |

---

## 2. 阶段 P1 — 真机联调（**需 API 密钥**）

### 2.1 前置
必须有可用的 `rc-` 密钥（决策 **D1**）。若无 → 本阶段延后，P0 交付并标注「离线完成」。

### 2.2 用例矩阵

| # | 用例 | 验证目标 | 覆盖 |
| --- | --- | --- | --- |
| T1 | DeepSeek-V4.1-Flash，`reasoningEffort: medium` | **思考流式可见**；思考 token 入统计 | A5/A6、R1/R3 |
| T2 | 选 `off` | 确认发出 `reasoning_effort: "none"`，模型不思考 | Q3 |
| T3 | 逐模型逐档位 | 合法档位全接受；非法档位不 400/422 | Q2 |
| T4 | Qwen3.8-27B + GLM-5.3-Flash（拒绝 `developer` 的模型） | 不报 `unknown role: developer` | **A8**、Q5 |
| T5 | 多轮对话（≥3 轮）含工具调用 | 回放不因 reasoning 字段报错 | **G6** |
| T6 | `maxTokens` = 256（小预算）触发长思考 | 是否出现空回复 | **G2** |
| T7 | 并发 10 个请求 | 是否触发 429 | K6 |
| T8 | 故意用错误密钥 | 401 错误是否可读 | A10/G3 |
| T9 | 平台层错误（如未验证账户触发 403） | `{"detail":…}` 信封是否可读 | **G3** |
| T10 | 视觉模型发 1 张图 | `image_url` 正常 | R8 |

### 2.3 关键观测记录（必须回写文档）

| 待验证项 | 结论来源 |
| --- | --- |
| **流式思考 delta 字段名**（R2） | 实测确认 pi-ai 读到的是 `reasoning` 还是 `reasoning_content` |
| **思考 token 位置**（R3/G5） | 是否走 `completion_tokens_details`，是否需要顶层回退 |
| **G2 是否真实发生** | T6 结果 —— **决定是否进入方案 A** |
| **G3 是否真实发生** | T8/T9 结果 |
| **G6 是否真实发生** | T5 结果 |

### 2.4 🛑 检查点 CP-1 — 决策门禁

| 项 | 内容 |
| --- | --- |
| **通过标准** | T1–T10 执行完毕；§2.3 全部四项有明确结论并回写文档；A1–A8 达标 |
| **用户需决策** | ⓐ G2 是否可接受 → 决定**停在方案 0** 还是进入 P2<br>ⓑ G3/G6 是否可接受<br>ⓒ 是否补齐剩余模型的档位表 |
| **回滚** | 删除配置，回到无 Radeon 状态 |

---

## 3. 阶段 P2 — 薄插件（**条件性，仅当 CP-1 判定需要**）

> 仅在 CP-1 判定 G2（空回复）确实不可接受时启动。其余缺口（G3/G4/G6）优先尝试配置或文档化的规避手段。

### 3.1 目标
写一个**最小** `LlmAdapter`，只解决空回复恢复，不重写整个 provider。

### 3.2 范围（严格限定）

| 做 | 不做 |
| --- | --- |
| 继承/包装 pi-ai 适配器 | ❌ 重写 SSE 解析 |
| 检测「有 reasoning、无 content、`finish=max-tokens`」 | ❌ 重写模型目录发现 |
| 抛出 `EMPTY_RESPONSE_CODE`（DSH 原生语义，默认即可重试） | ❌ 重写能力上报 |
| 在重试时放大 `max_tokens` | ❌ 实现独占端点 |

### 3.3 必备接线（v2.0 已修正的硬性要求）

```ts
export const inject = ['llm']
export const Config = z.object({ /* 全部字段必须 .volatile() */ }).volatile()

export function apply(ctx, config) {
  // G1：必须复用 llm-pi-ai 命名空间，否则模型设置页提交按钮永久禁用
  const settingsNs = 'llm-pi-ai'
  ctx.llm.registerConfigurableProviders([{
    provider: 'radeon-cloud',
    displayName: 'Radeon Cloud',
    settingsNs,                       // ← 必须等于 cordis.yml 行 id
    settingsPath: ['providers', 'radeon-cloud'],
  }])
  ctx.llm.registerAdapter(['radeon-cloud'], adapter)   // listModels 必须非空
}
```

> ⚠️ 若改用独立命名空间，**必须同时提供 client UI 插件**填充 `settings.models.provider-card` 槽位，否则用户在设置页无法保存任何配置。

### 3.3.1 流协议的硬性不变式（测试必须覆盖）`[已确证]`

`LlmAdapter.stream()` 是**抽象方法且基类无默认实现**，必须自己实现（或整体覆盖 `prepareCall()`）。

| 不变式 | 来源 |
| --- | --- |
| `finish` 恰好一次且终止；仅 `error`/`aborted` 可留未关闭块 | `dsh-llm/lib/invariant.js` |
| `usage` 至多一次 | 同上 |
| delta 必须落在**类型匹配的打开块**上；`block-end.block.type` == `block-start.blockType` | 同上 |
| `index` 非负安全整数 | 同上 |
| 抛 `LlmError`（非原生 `Error`），否则 `code` 降级为 `UNKNOWN` | `adapter-failure.js` |
| 传输层 `redirect: 'error'`，防凭据随重定向泄露 | `dsh-llm-deepseek` 参考实现 |

> **实施建议**：直接把 `@deepseek-ai/dsh-llm/invariant` 的校验器挂进单元测试，它就是官方对该语法的可执行定义。

### 3.3.2 G3 的实现模板

直接套用 `dsh-llm-deepseek` 的 `providerError()`：HTTP 状态 → `AUTH` / `QUOTA` / `RATE_LIMIT` / `CONTEXT_WINDOW_EXCEEDED` / `INVALID_REQUEST` / `SERVER` / `HTTP_<status>`，并把 `Retry-After` 写入 `providerRetryAfterMs`（`dsh-llm-retry` 会据此退避）。Radeon 的上下文溢出措辞可由 `dsh-llm` 导出的 `isContextWindowExceededError()` 直接识别。

### 3.4 验证
```bash
pnpm test   # T6 场景的回归测试
```

### 3.5 🛑 检查点 CP-2
空回复场景被自动识别并恢复；其余验收项不回退。

---

## 4. 阶段 P3 — 交付

- [ ] T3.1 `README.md`：安装、配置、**已知限制**（G2/G3/G4/G6）、故障排查
- [ ] T3.2 把 P1 实测结论回写可行性报告（消除全部 `[待验证]`）
- [ ] T3.3 确认 `cordis.patch.yml` 可独立交付（无绝对路径依赖）

### 🛑 检查点 CP-3 — 最终验收
对照可行性报告 §9 的 A1–A10 逐条签字。

---

## 4.5 阶段 P4 / P5 — 冲突修复与公开形态（2026-10-04 补做）

> 动机：为公开发布做准备时发现了两个纯配置形态无法回避的问题，
> 详见 [`feasibility-assessment.md`](./feasibility-assessment.md) §11 与
> [`plugin-parity-assessment.md`](./plugin-parity-assessment.md)。

### P4 冲突修复：写入降到键的粒度

**问题**：DSH 的非 insert 补丁是整体替换，而用户通过设置界面添加的 provider
也落在同一个文件里——安装本项目会抹掉用户已有的配置。

| 任务 | 内容 | 状态 |
| --- | --- | --- |
| 抽出唯一真源 | `provider/radeon-cloud.yml`，插件与安装脚本共用 | ✅ |
| 键级合并（结构层） | `src/merge.js`，纯函数，只动 `providers.radeon-cloud` | ✅ |
| 键级合并（文本层） | `src/patch-text.js`，保留用户的注释、缩进风格与键序 | ✅ |
| 启动时结构校验 | `src/validate.js`，10 类反例全部拦下 | ✅ |
| 安装脚本改造 | `scripts/apply-to-profile.mjs`，写入前断言、失败自动备份 | ✅ |
| 回归测试 | 合并语义 15 项 + 文本合并 17 项 | ✅ 全通过 |

**过程中修复的两个缺陷**

| 缺陷 | 根因 | 发现方式 |
| --- | --- | --- |
| 更新分支丢掉 `radeon-cloud:` 键行 | 新增分支拼了键行、更新分支没拼 | 真实 profile 因块内带注释走更新分支，干净夹具走新增分支，只在部分场景复现 |
| 测试数据生成器有同样的边界错误 | 临时脚本复制了同一错误 | 一度误判合并逻辑有问题，改用手写夹具后定位 |

> 教训：这类改动必须靠测试固定——**「干净输入」与「真实输入」会走不同分支**，
> 只用一种夹具测试会漏掉另一半。

### P5 公开形态：薄壳插件

| 能力 | 实现 | 状态 |
| --- | --- | --- |
| 分发 | 独立 npm 包，`dsh.bundle.patch` 只插入本插件行、不携带任何 `llm-pi-ai` 配置 | ✅ |
| 版本闸门 | `peerDependencies` 里的 `@deepseek-ai/dsh-*` 范围声明支持 DSH `0.2.x`，不匹配直接拒装（`engines.dsh` 与 `dsh.compatibility` 是同样的声明，但闸门判定只读 peer） | ✅ |
| 看护 | 插件启动时校验定义，失效则让插件启动失败并给出补救指引 | ✅ |
| 命名一致 | 包名 / 插件注册名 / 补丁行 `name` 三者一致；补丁行 `id` 按 DSH 惯例取无作用域短名，不承担包名职责 | ✅ 已校验 |

**明确不做的事**：插件不在启动时改写用户的 profile。provider 定义最终要落到
用户自己维护的 `cordis.patch.yml`，插件在启动时写它存在与用户其它改动竞态的风险，
而这一路径无法在本次开发中做集成验证。因此写入是显式动作
（`pnpm install:profile`），启动时只做只读校验。

**已知能力边界**：启动时的结构校验能发现「配置写错」，发现不了「上游把字段改了名」
——后者需要 `llm-pi-ai` 的真实 schema，而 DSH 的包在 profile 的 `node_modules`
里不可解析，插件运行时取不到。该校验由 `pnpm validate` 承担，
建议接入 CI 或升级 DSH 后运行。

> **后续变更（发布前）**：上面两段已被取代，当前状态以 `README.md` 与 `AGENTS.md` 为准。
>
> - 交付方式改为「provider 定义写在插件自带的补丁层」：插件**仍然不写 profile**，
>   但 profile 里出现覆盖时会启动失败并给出合并命令（`pnpm install:profile` 降为补救路径）。
>   这样设置页不会渲染「删除」按钮，卸载插件即删除供应商；
> - 运行时其实取得到 `llm-pi-ai` 的真实 schema（`await import('@deepseek-ai/dsh-llm-pi-ai')`
>   由 DSH 的运行时解析供给），因此「上游字段改名」那道校验现在也在启动时做，
>   取不到 schema 时才降级为结构校验并告警。

---

## 5. 验收标准

| # | 标准 | 阶段 |
| --- | --- | --- |
| A1 | 模型设置页出现 Radeon Cloud 行，编辑器可用 | CP-0 |
| A2 | 可输入并保存 API 密钥 | CP-0 |
| A3 | 模型选择器显示 Radeon 模型 | CP-0 |
| A4 | 思考档位控件按模型显示 | CP-0 |
| A5 | 思考过程在 UI 中流式可见 | CP-1 |
| A6 | 思考 token 进入用量统计 | CP-1 |
| A7 | 多轮工具调用正常 | CP-1 |
| A8 | 拒绝 `developer` 的模型不报 400 | CP-1 |
| A9 | 大预算下无空回复（G2） | CP-1 |
| A10 | 429/401 错误可读 | CP-1 |

---

## 6. 回滚

| 阶段 | 回滚动作 |
| --- | --- |
| P0 | 删除 `cordis.patch.yml`，重启 |
| P1 | 同上；无持久化副作用 |
| P2 | 移除插件行；provider 路由消失，无残留（注册均为 effect 自动清理） |

---

## 7. 里程碑

| 阶段 | 级别 | 估计 | 依赖 |
| --- | --- | --- | --- |
| P0 配置骨架与离线校验 | T0 | 0.5 天 | — |
| P1 真机联调 | T0 | 0.5 天 | 密钥 ✅ |
| P1.5 专属卡片插件 | T0+ | 0.5–1 天 | CP-1 选择 |
| P2 完整适配器 | T-A | 2–3 天 | CP-1 判定 G2 |
| P3 交付 | — | 0.25 天 | 任一 |
| P4 冲突修复 | — | 0.5 天 | P1 |
| P5 公开形态（薄壳） | — | 0.5 天 | P4 |

**T0 合计：约 1 人日；T0+：约 1.5–2 人日；T-A：约 3–4 人日**

---

## 8. 决策请求

| # | 问题 | 建议 |
| --- | --- | --- |
| ~~D1~~ | ~~有无可用 `rc-` API 密钥？~~ | ✅ **已确认有** —— P1 阻塞解除 |
| **D2** | 起步走哪一级？ | **T0**。是否一并上 **T0+**（专属卡片）请一并指示 |
| D3 | 默认档位 | `medium` |
| D4 | 只做共享端点 | 建议**是** |
| D5 | 模型列表维护方式 | 先手工；接受 G4 维护成本 |
| D6 | 是否照 `@mars-sea/dsh-commandcode-provider` 的打包结构 | 建议**是**（`dsh.client.inject` + `./client` 导出 + locale 资源） |

---

## 附录：pi-ai profile 字段速查

| 字段 | 用途 | Radeon 取值 |
| --- | --- | --- |
| `api` | 协议 | `openai-completions`（Radeon 不在 pi-ai 内置目录） |
| `baseURL` | 端点 | `https://developer.amd.com.cn/radeon/api/v1` |
| `apiKeyEnv` | 凭据引用（**字面名不可改**，GUI 依赖它） | `RADEON_API_KEY` |
| `reasoning` | 默认思考档位 | `medium` |
| `defaultMaxTokens` | 未声明模型的输出上限 | `8192`（G2 余量） |
| `streamIdleTimeoutMs` | **分片间隔**超时 | `600000` |
| `retryPolicy.backoff.maxDelayMs` | 退避上限 | `120000`（≥ `Retry-After: 60`） |
| `compat.supportsDeveloperRole` | 系统提示词用哪个角色 | **`false`** ★ |
| `compat.thinkingFormat` | 思考档位怎么传 | `openai` |
| `compat.maxTokensField` | 输出上限字段名 | `max_tokens` |
| `compat.supportsThinkingTokenBudget` | 思考预算字段 | **`false`** ★（Radeon 三个字段全不接受） |
| `models[].reasoningEfforts` | 键=档位，值=线上拼写；**仅 `off` 可留空** | 逐模型声明 |
| `models[].input` | 模态 | `[text]` / `[text, image]` |