# 使用方式差异评估

| 项目 | 内容 |
| --- | --- |
| 文档类型 | 架构决策（Architecture Decision） |
| 版本 | v1.1（补记结论的落实情况） |
| 日期 | 2026-10-04 |
| 结论状态 | 已落实：三项要求全部补齐，见文末第 9 节 |

> 对比本项目与其他「提供模型 API」的插件之间的使用方式差异，并判断差异的利弊。
> 评估对象为本机已实际安装、可读源码的组件，结论均以源码行为为准。

> **📌 本文写作于薄壳插件建成之前，是决策依据而非当前状态。**
> 文中「本项目当前形态」一律指当时的**纯 YAML 配置**形态。该形态已被
> `@zhz8888/dsh-radeon-cloud-patcher` 取代：分发、版本闸门与启动校验三项已补齐，
> 「会破坏用户既有配置」一项已通过按键合并修复（合并粒度降到
> `providers.radeon-cloud` 这一个键，并改用文本级编辑以保留用户注释与格式）。
> 当前形态与遗留差距见本文末尾的「结论的落实情况」。

---

## 1. 本机并存的四种 provider 来源

| 形态 | 本机实例 | 交付物 | 由谁分发 |
| --- | --- | --- | --- |
| A 第一方专用适配器 | `llm-deepseek-api-key` → 路由 `deepseek-official` | 随 DSH 发布 | DeepSeek |
| B 第一方通用路由 | `llm-pi-ai`，本项目的 `radeon-cloud` 挂在它之下 | 随 DSH 发布 | DeepSeek |
| C 第三方完整插件 | `@mars-sea/dsh-commandcode-provider` → 路由 `commandcode` | npm 包 | 第三方 |
| D **纯配置（本项目当前形态）** | 只是 B 之下的一条路由 | YAML 片段 | 本项目 |

严格地说，**本项目当前并不是插件**，而是对 B 的一次配置。这一区别是后续所有差异的根源。

---

## 2. 使用方式逐项对比

| 维度 | 本项目（D 纯配置） | Command Code（C 完整插件） |
| --- | --- | --- |
| 安装方式 | 手工把 YAML 合并进 profile，重启 DSH | 插件市场一键安装 / `dsh plugin add` |
| 界面入口 | 「设置 → 模型」中的一行，带「自定义」标记 | 侧栏独立设置页 + 用量面板 + 配额面板 |
| 配置写入位置 | profile 的 `cordis.patch.yml` | 自身的 `Config` 命名空间 |
| 版本约束 | **无** | `peerDependencies` 里的 `@deepseek-ai/dsh-*` 范围声明支持 DSH `0.2.x`，不匹配**直接拒装** |
| 失效表现 | **静默** | 加载失败并报不兼容 |
| 代码规模 | 147 行 YAML | 22,700 行 TypeScript（宿主 34 文件 + 客户端 36 文件） |
| 依赖 | 无 npm 依赖 | 12 个 peerDependencies |
| 审核成本 | 读完即懂全部行为 | 需逐层阅读 |
| 用户可发现性 | 需阅读 README 才会用 | 市场内可直接看到 |

---

## 3. 差异带来的好处

**维护成本接近于零。** 没有代码需要跟随 DSH 版本迭代发布，也不存在第三方弃用或停止维护的可能。

**可审计。** 147 行 YAML，没有隐藏行为。审查者读完就知道接入的全部行为，不需要信任一个第三方包。

**无供应链风险。** 不引入任何 npm 依赖，不引入可执行代码。

**自动跟随 DSH 升级。** 只要 `llm-pi-ai` 的配置字段不变，用户升级 DSH 后即自动获得新版本能力，无需我们发版。

**复用已验证的传输层。** 思考字段的多路读取、usage 计量、工具调用回放、多轮思考回传，全部由 pi-ai 承担，这些都经过实机验证。

---

## 4. 差异带来的代价

### 4.1 最严重：没有版本闸门，失效是静默的

实测验证：`llm-pi-ai` 的配置 schema 对**未知字段不报错**，只校验必填项。

```
当前配置校验: 通过
若 compat 字段被改名:  ★ 仍「通过」—— 旧字段被静默忽略，功能失效无告警
若档位字段被改名:      ★ 仍「通过」—— 思考档位静默失效
```

后果：若 DSH 将来把 `supportsDeveloperRole` 或 `reasoningEfforts` 改名，这份配置**仍然校验通过、模型仍显示在选择器里**，但思考功能已经坏了。用户只会看到「档位不见了」，拿不到任何错误信息。

对比之下，Command Code 走 `evaluatePluginCompatibility()`，版本不匹配会被判为 `incompatible-version` 而**拒绝安装**——它响亮失败，本项目静默失效。

这一点尤其要命：本项目最核心的卖点是思考功能，而项目自身踩过的第一个坑（`reasoning_content: null` 静默吞掉思考）就是同一类问题。

### 4.2 会破坏用户手动添加的配置项

这是公开发布前必须解决的阻断性问题。

DSH 的设置文档 `settings.yaml` 已被废弃，其内容「迁入 profile」（`dsh-settings/lib/index.js:343-351`），即设置写入最终落到 profile 的 `cordis.patch.yml`。而本项目当前用的是**非 insert 补丁**，语义是**整体替换**目标行的 `config`：

```js
// cordis-plugin-include/lib/index.js:56-105
for (const [key, value] of Object.entries(overrides)) { if (key === "id") continue; target[key] = value }
```

因此如果用户自己在 `llm-pi-ai` 下添加过 provider B、本项目 A，本项目的补丁会**直接抹掉 B**。

### 4.3 分发渠道缺失

本机装有 `dshmarket`（可视化插件市场，支持一键安装社区插件）。纯配置形态进不了这个生态，用户只能手动复制 YAML。

### 4.4 模型目录需手工维护

AMD 的档位表不在 API 里（实测 `GET /v1/models` 的 `supported_parameters` 对所有模型均不含 `reasoning_effort`），模型上下架后必须复测并手改 YAML。

### 4.5 缺少独立设置界面

用户修改配置需要手工编辑 YAML，模型选择页只显示一行、不能就地改。

---

## 5. 结论

| 使用场景 | 判断 |
| --- | --- |
| 个人或团队内部使用 | **当前形态合适**，成本最低、可审计、零维护 |
| **公开发布** | **当前形态不合格**，缺分发、缺版本保护、且会破坏用户既有配置 |

公开发布必须同时补齐三件事，且**不能推翻配置本体**——它是唯一真源，也是全部价值所在：

1. **不破坏用户配置**：合并而非替换
2. **版本闸门**：把静默失效变成响亮失败
3. **分发渠道**：可被插件市场安装

---

## 6. 薄壳方案

在配置本体之外加一层极薄的插件外壳，**不接管任何 provider 逻辑**，仍由 `llm-pi-ai` 承担实际传输。

```
npm 包（可被 dshmarket 分发）
  └─ apply()：
       ① 安装：把配置本体【逐键合并】进 llm-pi-ai 的 providers，
               只写 providers.radeon-cloud，其余同级键原样保留
       ② 校验：用 llm-pi-ai 的真实 schema 校验合并结果，
               不通过则启动即失败并给出可操作的诊断
       ③ 闸门：peerDependencies 里 @deepseek-ai/dsh-* 的版本范围
```

关键点：写入走 DSH 官方 API `ctx.settings.write(ns, change)`，而不是自行改文件。该 API 的 `change`
回调同时收到**原始值与继承值**，并强制校验目标路径是可写（volatile）的，因此合并是官方支持的语义。

合并逻辑幂等：若目标键已与配置本体完全一致，则不产生任何写入。

---

## 7. 与参考插件的差距（薄壳之后仍存在）

即便加了薄壳，以下差距仍然存在，属于**有意取舍**：

| 项 | 说明 | 是否值得补 |
| --- | --- | --- |
| 独立设置页 | 用户改配置仍需 YAML | 仅当使用量足够大时才值得 |
| 模型市场一键发现 | 无法在市场里被检索到 | 依赖生态收录，非技术问题 |
| 模型目录自动刷新 | 仍需手工复测 | 可后续加脚本，但不阻塞发布 |
| 用量/配额面板 | 本项目无此需求 | 不需要 |

---

## 8. 证据来源

| 结论 | 依据 |
| --- | --- |
| 非 insert 补丁整体替换 config | `cordis-plugin-include/lib/index.js:56-105` |
| 设置写入落到 profile | `dsh-settings/lib/index.js:343-351`（`settings.yaml` 迁入 profile） |
| 未知字段不报错 | 实测 `Config['~standard'].validate()`：改名后仍返回通过 |
| 插件版本闸门拒装 | `dsh-plugin-manager/lib/index.js:506,628,1490` → `evaluatePluginCompatibility` |
| 合并写入的官方 API | `dsh-settings/lib/index.js:501-529` `settings.write(ns, change, expected, paths)` |
| pi-ai 字段形状 | `dsh-llm-pi-ai/lib/index.js:963-1049` |
| Command Code 的注册与界面 | 其 `src/index.ts` 注册三件套、`client-src/index.ts` 四处插槽注册 |
| 档位表不在 API | 实测 `GET /v1/models`：9 个模型的 `supported_parameters` 均无 `reasoning_effort` |

---

## 9. 结论的落实情况

本文第 5 节判定「公开发布必须补齐三件事」，逐项落实如下：

| 要求 | 落实方式 | 状态 |
| --- | --- | --- |
| 不破坏用户配置 | 合并粒度降到 `providers.radeon-cloud` 这一个键；文本级编辑保留用户的注释、缩进风格与键序；写入前断言其余顶层条目与同级 provider 键逐字未变，失败即中止且自动备份 | ✅ 已落实，32 项回归测试覆盖 |
| 版本闸门 | `peerDependencies` 里的 `@deepseek-ai/dsh-*` 范围声明支持 DSH `0.2.x`，版本不匹配时插件管理器直接拒绝安装（`engines.dsh` 与 `dsh.compatibility` 是同样的声明，但闸门判定只读 peer） | ✅ 已落实 |
| 分发渠道 | 独立 npm 包，`dsh.bundle.patch` 只插入本插件行、不携带任何 `llm-pi-ai` 配置，可由插件市场或 `dsh plugin add` 安装 | ✅ 已具备发布形态 |
| 让静默失效变成响亮失败 | 插件启动时校验 provider 定义，不通过则让插件启动失败并给出补救指引 | ✅ 已落实（结构层面） |
| 同上，对「上游字段改名」这一类 | 需要 `llm-pi-ai` 的真实 schema，而 DSH 的包在 profile 的 `node_modules` 里不可解析，插件运行时取不到 | ⚠️ 由 `pnpm validate` 承担，建议接入 CI 或升级 DSH 后运行 |

## 10. 与参考插件的剩余差距

| 项 | 说明 | 是否值得补 |
| --- | --- | --- |
| 独立设置页 | 用户改配置仍需 YAML | 仅当使用量足够大时才值得 |
| 模型目录自动刷新 | AMD 的档位表不在 API 里，模型上下架后需复测并更新定义 | 可后续加脚本，不阻塞发布 |
| 用量与配额面板 | 本项目无此需求 | 不需要 |
| 市场内可检索 | 依赖生态收录 | 非技术问题 |
