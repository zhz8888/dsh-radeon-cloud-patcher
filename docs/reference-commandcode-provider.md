# 参考实现分析 — `@mars-sea/dsh-commandcode-provider`

| 项目 | 内容 |
| --- | --- |
| 文档类型 | 参考实现分析（Reference Analysis） |
| 版本 | **v1.1**（补记：本文结论在后续实现中的验证情况） |
| 日期 | 2026-10-04 |
| 目的 | 评估其设计思路与界面设计对 Radeon Cloud 接入的可迁移性 |
| 样本 | `@mars-sea/dsh-commandcode-provider@0.12.3`（本机已安装，锁定 `dsh 0.2.0-rc.2`） |
| 位置 | `~/.dsh/profiles/desktop/node_modules/@mars-sea/dsh-commandcode-provider` |

> **分析方法**：该包发布的是 tsdown 产物，但 `.js.map` 带 `sourcesContent`，**34 个宿主源文件 + 36 个客户端源文件的原始 TypeScript 全部可完整还原**（本文所有代码引用均来自还原后的 `src/*.ts`）。界面判断基于其自带的三张截图 + `client-src` 源码。**未实际运行该插件。**

---

## 1. 它是什么

> package.json 原文：
> "Unofficial DeepSeek Harness LLM provider plugin for Command Code, ported from pi-commandcode-provider (MIT). **Registers the 'commandcode' provider route with a Models-page card and live model catalog.**"

即：**一个完整的第三方 LLM provider 插件**——正好是我们要做的事的成品形态。

| 规模 | 行数 | 文件数 |
| --- | --- | --- |
| 宿主半 `src/` | 12,604 | 34 |
| 浏览器半 `client-src/` | 10,094 | 36 |
| **合计** | **约 22,700** | **70** |

> 对照：我们的需求（无账号体系、无 OAuth、无配额面板、无计费）大约只需其 **8–12%**。

---

## 2. 打包与加载（可直接照抄）

```jsonc
// package.json 关键字段
{
  "type": "module",
  "main": "./lib/index.js",
  "exports": {
    ".":          { "default": "./lib/index.js" },
    "./client":   { "default": "./lib/client.js" },   // ← 浏览器半
    "./locale/*.json": "./locale/*.json"              // ← i18n 资源
  },
  "icon": "./icon.svg",
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "compatibility": { "dsh": "0.2.0-rc.2" },       // ← 版本闸门
    "client": {                                        // ← 客户端半的注入门
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-settings",
        "@deepseek-ai/dsh-api-remotes"
      ]
    }
  },
  "engines": { "node": ">=22", "dsh": "0.2.0-rc.2" }
}
```

其 `cordis.patch.yml` 全文只有 13 行有效配置：

```yaml
- insert:
    - id: llm-commandcode          # ← 这个 id 同时是 settingsNs 和卡片 key
      name: "@mars-sea/dsh-commandcode-provider"
      config:
        apiKeyEnv: COMMANDCODE_API_KEY
```

文件里还留了一条**踩坑警告**（值得抄进我们的文档）：

> `name` 必须是 profile `node_modules` 里的**完整包标识符**：pnpm 按真实（scoped）名链接，裸写 `dsh-commandcode-provider` 会 `ERR_MODULE_NOT_FOUND` **并在启动时崩溃**。并且**必须加引号**——YAML 中以 `@` 开头的标量会被当作指令/指示符，解析失败。

这与我此前记录的「`settingsNs` 必须等于 cordis.yml 行 id」完全吻合。

---

## 3. 架构：宿主半 + 浏览器半

```
┌─ 宿主（Node）─────────────────────────────────────────┐
│ src/index.ts                                          │
│   name = 'llm-commandcode'    inject = ['llm']        │
│   Config = z.object(markVolatileFields({...}))         │
│                                                       │
│   ① ctx.llm.registerAdapter(['commandcode'], adapter)  │
│   ② ctx.llm.registerConfigurableProviders([{           │
│        provider, displayName,                          │
│        settingsNs: NS, settingsPath: [] }])            │
│   ③ applyUsageRemote(...)   ← 自定义端点经 Typert RPC │
│                                                       │
│   src/adapter.ts (3,278 行)                            │
│     listModels / resolveModel / prepareCall / stream   │
└───────────────────────────────────────────────────────┘
                          ↕ Typert Remote
┌─ 浏览器（Web）────────────────────────────────────────┐
│ client-src/index.ts                                    │
│   inject = ['slots', 'locale', 'remote']               │
│   ctx.slots.inject('settings.section', …)              │ ← 侧栏设置页
│   ctx.slots.inject('settings.models.provider-card', …) │ ← ★ G1 解法
│   ctx.slots.inject('main', …)                          │ ← 配额面板
│   ctx.slots.inject('sidebar.footer.action', …)         │
│   ctx.slots.inject('conversation.composer.dock', …)    │ ← 会话成本
└───────────────────────────────────────────────────────┘
```

**注册三件套与我在 v2.0 中的结论完全一致**，没有新东西。

---

## 4. ★ 最有价值：它解决了 G1

我在可行性评估里把 G1 列为**硬约束**——第三方 `settingsNs` 会让模型设置页的编辑器变成「只有提示文字 + 永久禁用的提交按钮」。我当时给出的三条出路之一是「自带 client UI 插件填充 `settings.models.provider-card` 槽位」。

**这个插件正是这么做的**，而且做法比我设想的更精巧。

### 4.1 槽位声明（`client-src/card.tsx:39-46`）

```tsx
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'settings.models.provider-card': { kind: 'keyed'; scope: 'root'; owner: ProviderCardExtrasOwnerProps }
    'settings.models.footer':       { kind: 'list';  scope: 'root'; owner: ModelsFooterOwnerProps }
  }
}
```

### 4.2 注册（`client-src/index.ts:415-430`）

```ts
ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
  name: 'settings.models.provider-card',
  key: 'llm-commandcode',     // ← 即 settingsNs / cordis.yml 行 id
  locale: 'settings.commandcode',
  inject: () => ({ /* 编辑态、密钥、登录、存/弃 */ }),
}, CommandCodeProviderCard))
```

### 4.3 关键手法——**把坏掉的官方编辑器藏起来**（`card.tsx:1-24, 104-115`）

> 原文注释：
> "The official Models page opens one editor per provider row through its own 编辑 button, and for a namespace it curates no layout for (`llm-commandcode`) that editor is **a bare shell: a config hint over a permanently disabled apply**. This panel **takes its place** — it watches the slot outlet's siblings and, **while the official editor is open, hides the useless shell** and shows the real controls in its slot. Closed, it renders nothing and the row looks exactly like any other provider row."

实现方式（`card.tsx:86-115`）：

```ts
export const CARD_SLOT_KEY = 'settings.models.provider-card'

export function adjacentEditorCard(wrapper) {
  for (const sibling of [wrapper.previousElementSibling, wrapper.nextElementSibling]) {
    if (sibling !== null && typeof sibling.className === 'string'
        && sibling.className.includes('editor')) return sibling
  }
  return null
}
const HIDDEN_STYLE = { display: 'none' } as const
```

**即**：槽位出口本身留在 DOM 里当「锚点」，用 `display:none` 藏掉官方的空壳编辑器，再把自己的真实控件画在原位。查找官方编辑器时**只匹配 CSS module 类名里的 `editor` 这个词干**（`_editor`），不需要知道哈希值——这是很干净的解耦。

> **这是本次评估最重要的发现**：G1 不是死路，已有经过验证的解法，成本约 **318 行**（`card.tsx`）。

### 4.4 优雅降级（`client-src/index.ts:412-414`）

> "On a build without this slot the declaration never exists and `slots.inject` never fires — the registration silently does not happen. **Do not 'harden' that into an error.**"

槽位是**声明式**的：不存在的槽位不会让插件崩溃，也不会报错。这是应该照抄的工程态度。

---

## 5. 界面设计

### 5.1 侧栏设置页（`settings.section`，见截图）

注册（`client-src/index.ts:392-399`）：

```ts
ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section',
  id: 'commandcode',
  order: 12,                                   // 排序
  label: () => ctx.locale.bind('settings.commandcode')('nav'),
  locale: 'settings.commandcode',               // i18n 命名空间
  inject: injected,
}, CommandCodeSettingsPage))
```

从截图观察到的设计要点：

| 元素 | 做法 |
|---|---|
| 分组卡片 | 用卡片把「用量统计」「API 密钥」「API 地址」「工作目录」分区 |
| 状态徽章 | 「已配置」「已覆盖」「重置」——右侧轻量文字按钮，不抢视觉焦点 |
| 密钥输入 | 空值占位文案明确说明**留空保存不会覆盖已存密钥**（避免误清空） |
| 空值默认值 | 「默认 `https://api.commandcode.ai`，一般无需修改」——不强迫用户改 |
| 进度条 | 5 小时/每周窗口用横向进度条 + 「重置于 <时间>」 |
| 页头说明 | 一句话讲清「密钥仅保存在本机凭据服务，不会回显」 |

### 5.2 模型选择器（见截图）

用的是 DSH 原生选择器，分组名 `commandcode`，每行展示：**模型名 · 折扣/徽章 · 上下文窗口**；底部右侧是**原生思考档位选择器**（截图里显示 `high` + 箭头）。

> 这个档位控件**完全由 `resolveModel()` 返回的 `reasoning.efforts` 驱动**，不是自定义 UI —— 这印证了我此前的判断：**只要 `resolveModel()` 正确上报档位，思考功能的选择器就自动有了。**

---

## 6. 思考功能处理（与 Radeon 最相关的部分）

### 6.1 档位声明：模型表 + 有则声明，无则省略

`adapter.ts:2457, 2480-2491`：

```ts
const efforts = KNOWN_EFFORTS[model]
return {
  …
  // Omit `reasoning` entirely for models without known effort support:
  // the harness then treats the model as having no selectable efforts.
  ...(efforts ? {
    reasoning: { efforts: efforts.map((effort) => ({ id: ReasoningEffortId(effort), name: effort })) },
  } : {}),
}
```

`KNOWN_EFFORTS` 是**按模型 id 的静态表**（不是从 API 发现）。这正好印证 Radeon's 处境：**逐模型档位表不在 `GET /v1/models` 里**，只能来自文档或静态表。

### 6.2 ★ `off` 的双语义问题——直接命中 Radeon 的 Q3

`adapter.ts:3012-3025` 原文注释：

> "`off` carries **two meanings**, and only the snapshot tells them apart. The host passes it as **"no reasoning strength requested"** — the Messages transport's `output_config.effort` has **no `none`**, so it must send **no `output_config` at all**. But since command-code@1.73.3 the DeepSeek V4 line **publishes `off` as a real level**, and the official CLI sends it **verbatim as `reasoning_effort:"off"`** instead of dropping the field. So **a model that LISTS `off` gets it on the wire; every other model keeps dropping it**, which is what the unsupported-effort path relies on."

```ts
const declared = effort !== undefined && supported?.includes(effort) ? effort : undefined
const reasoningEffort = effort === 'off' && declared === undefined ? undefined : declared
```

**这与我们 Q3 的处境高度同构**：

| | Command Code | Radeon Cloud |
| --- | --- | --- |
| 不支持 `none` 的传输 | Messages `output_config.effort` 无 `none` | 部分模型不接受 `none`（Qwen3.8-27B / GLM） |
| 省略 ≠ 关闭 | — | **Qwen×2 / GLM 不传档位也会思考** |
| 解法 | 逐模型 `KNOWN_EFFORTS` 决定 `off` 发不发 | 逐模型 `reasoningEfforts` 决定 `off` 映射成 `none` 还是省略 |

**解法完全一致**：由「逐模型声明」决定，**不靠猜**。这验证了我方案 0 里的 `reasoningEfforts.off` 设计是对的。

### 6.3 能力上报的两个细节（值得抄）

```ts
inputModalities: vision ? (['text','image'] as const) : (['text'] as const),
toolUpdate: 'addition-only' as const,
defaultMaxTokens: Math.min(entry.maxTokens, DEFAULT_GENERATE_MAX_TOKENS),
```

- `toolUpdate: 'addition-only'` —— 让 DSH 在会话中途新增工具时仍保持单一对话序列
- `defaultMaxTokens` 取**目录值与本地上限的较小者** —— 对 G2（max_tokens 预留）有参考价值

---

## 7. 可迁移性评估

### 7.1 直接可抄（约 1,500 行）

| 参考件 | 用途 |
|---|---|
| `cordis.patch.yml` + `package.json` 的 `dsh.client` 段 | 打包骨架 |
| `src/index.ts` 的注册三件套 | 宿主接线 |
| `src/config-volatile.ts`（90 行） | 「所有用户字段必须 `.volatile()`」的实现 |
| `client-src/card.tsx`（318 行） | **G1 解法**——藏掉官方空壳，插入自有卡片 |
| `client-src/index.ts` 的槽位注册 + CSS 注入 | 客户端接线 |
| `adapter.ts` 的 `resolveModel` | 档位/模态/上下文的正确上报姿势 |
| `adapter.ts:3012-3025` | `off` 双语义处理（Radeon Q3 同构） |

### 7.2 不需要（约 21,000 行，全部跳过）

| 参考件 | 为什么不需要 |
|---|---|
| `accounts.ts`(727) / `enrollment*.ts` / `login*.ts`(804) | Radeon 用静态 `rc-` 密钥，无账号体系与 OAuth |
| `usage-*.ts` / `cost-*.ts` / `model-prices.ts`(392) | 无订阅配额与计费面板（**Radeon 的 `pricing` 字段可留作二期**） |
| `tui-settings.ts`(520) / `web-search.ts`(337) | 无 TUI、无内置搜索绑定 |
| `stream-trace.ts` / `command-locales.ts` / `panel-*.ts` | 配额面板与侧栏 footer 卡片 |
| `image-*.ts`(267) / `request-timing.ts` | 图片与时序插桩（Radeon 有 4 个视觉模型，**二期可复用**） |

### 7.3 它没有解决、我们仍需自己面对的

| 缺口 | 说明 |
|---|---|
| **G2 空回复** | Command Code 无此问题（其预算机制不同）。**我们最高危残余，仍需方案 0 的 `defaultMaxTokens` 调大 + CP-1 实测** |
| **G3 错误信封** | 其 `provider-errors.ts`(647) 可作范式，但需按 Radeon 的三种信封重写 |
| **G4 模型目录动态性** | 它有 `gatewayFacts` + `DEFAULT_MODELS_CACHE_PATH` 的缓存刷新机制，可借鉴；但**档位表仍是静态的**——我们同样是 |

---

## 8. 结论：三级方案阶梯

参考实现证明「自研插件」路线完全可行，但它有 **22,700 行**且解决了一堆我们没有的需求。据此给出三级阶梯：

| 级别 | 内容 | 工作量 | 界面 | 何时选 |
| --- | --- | --- | --- | --- |
| **T0** | 纯 `llm-pi-ai` provider 配置 | **0.5 天** | DSH 原生 pi-ai 编辑器 | **默认起点**：先把功能跑通 |
| **T0+** | T0 + 一个**纯客户端**小插件（只注册 `provider-card`），给 Radeon 行一个专属卡片 | **+0.5–1 天** | 自有品牌卡片 | 想要专属界面；card.tsx 可直接改造 |
| **T-A** | 完整自研 adapter + 卡片 + 独立设置页（照 Command Code 结构） | **2–3 天** | 完全自定义 | 仅当 **G2 实测不可接受**时 |

**推荐路径：T0 → CP-1 实测 → 需要界面则加 T0+ → G2 爆发才考虑 T-A。**

> T0+ 的一个待验证点：`settings.models.provider-card` 以 `settingsNs` 为 key 分发。若我们的 provider 挂在共享的 `llm-pi-ai` 命名空间下，卡片会对**所有** pi-ai 路由挂载，需要在组件内部按 `provider === 'radeon-cloud'` 过滤。从 `ProviderDirectoryRow` 的字段形状看应当可行，但**需在 P0 阶段实测确认**，不能先斩后奏。

---

## 附录：值得直接抄进我们文档的踩坑记录

1. **包名必须写完整 scoped 名，且加引号** —— 否则 `ERR_MODULE_NOT_FOUND` 且**启动即崩**。
2. **`settingsNs` = cordis.yml 行 `id`** —— 同时也是 provider-card 的 key。
3. **所有用户可见配置字段必须 `.volatile()`** —— 否则设置页整个命名空间不出现。
4. **`apiKeyEnv` 字段名不可改** —— GUI 按字面名查找凭据状态。
5. **不要「加固」槽位缺失为错误** —— 声明式槽位天然优雅降级。
6. **`listModels()` 必须非空** —— 否则模型选择器整组被丢弃。
7. **`resolveModel()` 必须返回 `reasoning`** —— 否则没有档位控件。

---

## 9. 本文结论在实现中的验证情况

本文写作于实现之前。后续实际情况与本文结论的对应关系：

| 本文结论 | 实现中的实际情况 |
| --- | --- |
| 「自研插件路线完全可行，但有 22,700 行，我们约需其 8–12%」 | ✅ 成立。最终实现 575 行（`src/` 5 个文件），未涉及账号体系、OAuth、配额面板与计费 |
| 「G1 有成熟解法：`settings.models.provider-card` 槽位，约 318 行」 | ⚠️ **未采用**。实测发现原生 pi-ai 编辑器已可用，CP-1 判定不需要专属卡片。该方案保留为备选 |
| 「可迁移约 1,500 行」 | ✅ 成立，但实际只迁移了打包骨架与 `compat`/`reasoningEfforts` 的配置思路；传输层直接复用 pi-ai，未重写 |
| 「`off` 双语义的解法是由逐模型声明决定」 | ✅ 成立。Radeon 侧 `GLM-5.3-Flash` 与 `Qwen3.8-27B` 不接受 `none`，故不声明 `off` 键；其余模型声明 `off: none` |
| 「版本闸门是插件形态的关键能力」 | ✅ 已采纳。见 [`plugin-parity-assessment.md`](./plugin-parity-assessment.md) §5 |

### 9.1 一处本文未预见的风险

本文第 7.2 节把「配置是整体替换而非合并」列为**已知限制**，
低估了它的严重性——它不是使用上的不便，而是**会破坏用户已有配置**的阻断性问题。
该问题在实现公开形态时才被发现并修复，修复前后的对比见
[`feasibility-assessment.md`](./feasibility-assessment.md) §11。

> 这条经验值得单独记住：把「已知限制」写进文档时，要区分**不方便**与**会损坏用户环境**。
> 后者应当在方案选型阶段就当作阻断性问题处理，而不是留到发布前。
