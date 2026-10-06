# AGENTS.md

本文件为在本仓库工作的智能体与协作者提供指引。

## 这是什么

`@zhz8888/dsh-radeon-cloud-patcher` —— 一个把 AMD Radeon Cloud 接入 DeepSeek Harness 的 DSH 插件。

**核心认知：本插件不实现任何 provider 逻辑。** 传输、思考字段解析、多轮回传、用量计量全部由 DSH 自带的 `dsh-llm-pi-ai` 承担。本插件只做四件事：分发、**补丁层声明 provider 定义**、版本闸门、启动校验与 id 归属判定。

任何"顺手给 provider 加个功能"的想法都违背本项目的设计前提。

**第二条认知：插件不写用户的 profile。** 定义只活在插件自带的 `cordis.plugin.patch.yml` 里，profile 是用户的文件，本插件对它只读。这不是洁癖，而是三个需求的技术前提——设置页不出现「删除」按钮、卸载插件即删除供应商、删除供应商只能靠卸载插件（机制见下方「定义为什么必须落在补丁层」）。

## 架构约束

### 零运行时依赖

`package.json` 没有 `dependencies`。源码只 import Node 内置模块：

```
node:child_process  node:fs  node:module  node:path  node:url  node:util
```

`@deepseek-ai/*` 全部声明为 `peerDependencies`，由 DSH 宿主提供。**引入任何 npm 依赖前先问：这是否破坏了「零依赖、可审计、无供应链风险」这三个卖点？** 参考 `docs/plugin-parity-assessment.md` 的对照表。

### 所有定位都走 import.meta.url

`src/index.js`、`src/yaml.js` 与 `scripts/` 下的脚本一律用

```js
const HERE = path.dirname(fileURLToPath(import.meta.url))
```

推导自身位置，**没有任何按包名自我解析的代码**。这正是本插件能安全改包名与加作用域的原因；改动时不要引入 `require('本插件包名')` 之类的自引用。

### 定义为什么必须落在补丁层

DSH 的非 `insert` 补丁是**整体替换**：同一 id 的 config 会整份盖掉它之前所有层给的 config（bundle 层按 `dsh.profile.bundles` 顺序，然后是 profile 的 `cordis.patch.yml`，最后是 home 与命令行 overlay）。

设置页的「删除」按钮判据是 `dsh-client-ui-settings-models` 里的：

```js
removable = settingsPath.length > 0 && hasPath(namespace.user, path) && !hasPath(namespace.base, path)
```

也就是说：**该 provider 路径只要出现在 base 层，按钮就永不渲染**。定义写在 profile（用户层）就必然带按钮，写在插件的 bundle 层则永远没有——而卸载插件就等于删除供应商，因为 profile 里没有副本。这就是 `cordis.plugin.patch.yml` 里那段生成区块存在的全部理由。

代价与配套：

- 定义在补丁文件里只能是文本副本，真源仍是 `provider/radeon-cloud.yml`，靠 `scripts/sync-bundle-patch.mjs` 渲染、`test/patch-sync.test.mjs` 断言一致——**改完真源必须跑 `pnpm sync:patch`**；
- profile 里一旦出现 `llm-pi-ai` 的 config（用户自己加过 provider），插件层会被整份盖掉。`src/index.js` 启动时静态读 profile / home / overlay 三层判定，`src/ownership.js` 给出四种结局：`plugin-layer`（正常）、`materialized`（同 id 且与本插件一致，视为设置页物化的副本，放行）、`shadowed`（被盖掉 → 启动失败 + 合并命令）、`conflict`（同 id 但不一致 → 启动失败 + 第一处差异）；
- 判定之所以是「一致即放行」而不是「有声明就失败」：设置页每保存一次都会把有效配置物化进用户层（录入 API Key 也会），严格判定会让插件在用户正常操作后无法启动；
- `scripts/apply-to-profile.mjs` 是补救路径（`shadowed` 时把定义按键合并进 profile），它同样拒绝覆盖不一致的同 id 定义，除非 `--force`。

`src/merge.js` 里写死两个常量，改动它们要极度谨慎：

```js
export const PROVIDER_KEY    = 'radeon-cloud'
export const TARGET_ENTRY_ID = 'llm-pi-ai'
```

`TARGET_ENTRY_ID` 是 DSH 自己的条目 id，与本插件无关。

### 客户端补丁用 DSH 的模块格式，不是 ESM

`client/client.js` 是设置页里隐藏「自定义」标签的那条 CSS，它**必须**是 DSH 客户端模块的包装格式：

```js
window.__ModuleLoader__.load({ id: '@zhz8888/dsh-radeon-cloud-patcher', factory: (require) => { … } })
```

- `id` 必须等于 `package.json` 的 `name`——DSH 按包名给客户端模块建表，写错会「加载了却没注册」而失败；
- 该文件**不是 ESM**，不要 `import` 进任何 Node 代码（测试用 `node:vm` 在桩环境里跑它）；
- `package.json` 里 `exports["./client"]` 指向它，`dsh.client.platform` 声明为 `web`；
- 客户端补丁不做 DOM 写入，只注入一条样式规则，判据是 DSH 自己拼的 `aria-label`（含 provider 路由名，与语言无关）。它依赖 DSH 的 DOM 结构，改版后可能静默失效——这是已知代价，写进了 README 的「归属与删除」。

### 补丁文件的 id 与 name 故意不同

```yaml
- id: radeon-cloud-patcher                      # profile 内唯一键，不带作用域
  name: "@zhz8888/dsh-radeon-cloud-patcher"     # 安装解析用，必须完整且带引号
```

**这两个值不一样是对的，不要"顺手统一"：**

- `id` 按 DSH 现有惯例取无作用域短名（对照 `llm-pi-ai`、`llm-commandcode`）。它只作唯一键，不承担包名职责。改名会让已装用户无法平滑升级。
- `name` 必须等于 profile `node_modules` 里的完整包标识符。裸写包名会解析失败，**且必须加引号**——YAML 中以 `@` 开头的标量会被当作指令符。

## 版本闸门

**DSH 的安装闸门只读 `peerDependencies`，不读 `engines.dsh`。** 实测代码（`@deepseek-ai/dsh-app-boot`）：

```js
if (!Object.hasOwn(fields, "peerDependencies")) return void 0;
for (const [name, range] of Object.entries(dependencies)) {
  if (name !== "@deepseek-ai/dsh" && !name.startsWith("@deepseek-ai/dsh-")) continue;
  if (!semver.satisfies(runtimeVersion, requirement, { includePrerelease: true })) peers[name] = range;
}
// 不匹配 → dsh-plugin-manager: rejected(preflight, "nothing was installed")
```

三条推论：

1. 只有 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*` 参与判定。**`@deepseek-ai/cordis` 被 `continue` 跳过**——放宽它不影响闸门。判定基准是 DSH 运行时版本，不是各包自身版本。
2. `engines.dsh` 与 `dsh.compatibility` 是给人看的声明，**必须与 peer 保持同步**，但它们不决定能否安装。改兼容范围时改的是 peer。
3. 预检发生在 `pnpm install` **之前**，读的是我们自己写的 `peerDependencies`。

### peer 范围必须带显式预发布分支

node-semver 只有当范围里**某个比较符**与该版本的 `major.minor.patch` 元组一致、且自身带预发布标签时，才放行该预发布：

| 范围 | `0.2.0-rc.2` | `0.2.1-alpha.1` |
|---|---|---|
| `>=0.2.0-rc.1 <0.3.0-0` | ✅ | ❌ 静默排除 |
| `>=0.2.0-rc.1 <0.2.1-0 \|\| >=0.2.1-0 <0.3.0-0` | ✅ | ✅ |

漏掉的后果不是报错版本号，而是用户遇到 `ERESOLVE` 得手工绕过。**写完 peer 范围，两个路径都要验**：DSH 闸门（`includePrerelease: true`）与 npm/pnpm 默认解析。

## 常用命令

```bash
pnpm test                 # 全量：合并语义 / 文本级合并 / 所有权判定 / 启动看护 / 补丁一致性 / 思考取回
pnpm test:merge           # 合并语义 + 文本级合并 + 所有权判定（离线、不碰 DSH 运行时）
pnpm test:guard           # 启动看护的四种结局
pnpm test:patch           # 补丁与定义真源一致 + 客户端补丁注入的规则
pnpm test:reasoning       # 仅思考字段取回
pnpm sync:patch           # 把 provider/radeon-cloud.yml 同步进补丁的生成区块
pnpm validate             # 用 llm-pi-ai 真实 schema 校验 provider 定义
pnpm probe                # 实测各模型思考档位（需密钥，会打真实 API）
pnpm install:profile:dry  # 补救路径：演练合并进 profile，只打印不写入
pnpm install:profile      # 补救路径：实际写入（自动备份，冲突时拒绝覆盖）
```

改完代码至少跑 `pnpm test && pnpm validate`；**改了 `provider/radeon-cloud.yml` 还要跑 `pnpm sync:patch`**，否则补丁里的副本会漂。`pnpm validate` 是唯一能发现「上游把字段改了名」的手段，**升级 DSH 后务必跑一次**。

### 测试用自研 runner，不是 node:test

`test/` 下的文件全是手写的计数式 runner——逐项检查、累加失败数、结束时
`if (failed > 0) process.exit(1)`。**项目没有引入任何测试框架**：

```bash
grep -rn "node:test\|node:assert" test/   # 无匹配
```

新增测试请沿用现有写法，不要引入 `node:test` 或断言库，否则与既有风格割裂，
且 `pnpm test` 里的退出码约定会失效（CI 依赖非零退出表示失败）。

除 `verify-reasoning.mjs`（读 `test/fixtures/` 里的真实抓取流）之外，其余测试都不碰网络。
`patch-sync.test.mjs` 与 `client-patch.test.mjs` 里的「不漂」断言是刻意设计的：
前者要求生成器再跑一遍**逐字符**不产生改动，后者用 `node:vm` 在桩环境里真跑一遍客户端补丁。

## 代码地图

```
src/index.js       插件入口：启动校验、所有权判定、收尾核验路由是否注册
src/ownership.js   所有权判定的纯函数（四种结局、差异定位、子集比较）
src/merge.js       键级合并的纯函数（补救路径使用；PROVIDER_KEY / TARGET_ENTRY_ID 在此定义）
src/patch-text.js  文本级编辑：按行定位与替换，以保住用户注释、缩进与键序
src/validate.js    provider 定义的结构校验（不依赖 DSH）
src/yaml.js        定位 YAML 解析器，含回退路径
client/client.js   客户端补丁：隐藏本行的「自定义」标签（DSH 客户端模块格式，非 ESM）
provider/          radeon-cloud.yml —— 定义的唯一真源，副本由 sync-bundle-patch.mjs 生成
scripts/           sync-bundle-patch.mjs（生成副本）、apply-to-profile.mjs（补救合并）、
                   validate-config.mjs、probe-efforts.mjs、radeon-api.sh
```

`patch-text.js` 的存在理由值得单说：DSH 补丁是整体替换，走序列化再写回会丢掉
用户在该文件里的注释与格式。文本级编辑是补救路径"不破坏用户配置"这一卖点的实现基础，
改它等于改这个卖点。

### 改动 provider/radeon-cloud.yml 的正确流程

模型的 `reasoningEfforts` 档位表**无法从 API 推断**——模型目录接口只返回 id、
上下文与模态，不返回档位信息。档位只能逐模型实测：

```bash
pnpm probe --only Qwen3.8-27B   # 单模型实测
pnpm probe                        # 全量实测
./scripts/radeon-api.sh GET /models   # 只拉模型目录，不含档位
```

改完定义后跑 `pnpm validate` 确认 schema 合法，**再跑 `pnpm sync:patch` 把定义同步进
`cordis.plugin.patch.yml` 的生成区块**（忘了这一步，装上去的还是旧定义；
`pnpm test:patch` 会拦住这种漂移）。**不要凭模型名推测档位**——
GLM 与 Qwen 系不支持关闭档位、某些模型不返回分离思考，这些都是实测结论
（`MiniCPM5-2B` 的 `reasoningEfforts: false` 即表示非推理模型）。

非推理模型写 `reasoningEfforts: false`，不是空对象，也不是省略。

## 实现约束

### 校验依赖 DSH 的真实 schema

`pnpm validate` 与测试都依赖 DSH 的**真实** schema，而不是本项目的副本——这是它能发现「上游把字段改名」的唯一原因，也是无法用假 schema 替代的原因。

代价是这两个命令需要一份可用的 DSH 安装。DSH 桌面版的安装路径随平台与安装位置变化，脚本因此支持用 `DSH_MODULES` 覆盖该路径；该变量的默认值写在 `scripts/validate-config.mjs` 与 `src/yaml.js` 里，不在文档中重复——**以代码为准**。

若因环境原因跑不了，**不要改成跳过校验或内联 schema 快照**：那会让「升级 DSH 后跑一次 validate」这条唯一的失效防线失效。

### pnpm-workspace.yaml 的 allowBuilds

```yaml
allowBuilds:
  '@google/genai': false
  protobufjs: false
```

pnpm v10+ 默认拦截依赖的安装期构建脚本，命中时以 `ERR_PNPM_IGNORED_BUILDS` 让 `pnpm install` **非零退出**，会打断 CI。这两个包是 `@deepseek-ai/dsh-llm-pi-ai` 的传递依赖，且它们发布 tarball 里根本没带构建脚本（`scripts/prepare.js` 与 `scripts/postinstall` 均不存在），故显式设为 `false` 而非放行。

**引入真需要构建的依赖时（如 esbuild），在这里追加 `pkg: true`，不要关闭这项保护。**

注意：**本仓库的这个文件只影响仓库自身开发**。用户安装插件时的构建授权，由 DSH profile 自己的 `pnpm-workspace.yaml` 管理，是另一个文件——不要试图在本仓库配置用户端的授权。

### 改包名后要同步的位置

改 `package.json` 的 `name` 时，以下位置必须一起改，否则装上去解析失败或排查方向错误：

- `cordis.plugin.patch.yml` 的 `name`（带引号的完整 scoped 名）
- `client/client.js` 里 `__ModuleLoader__.load` 的 `id`（DSH 按包名给客户端模块建表）
- `src/index.js` 的 `export const name`
- `src/yaml.js` 的错误信息前缀
- `README.md` 的包名说明与 `dsh plugin add` 命令
- `docs/` 下提到包名的地方（`patch` 的 `id` **不要**改）

`test/patch-sync.test.mjs` 与 `test/client-patch.test.mjs` 会断言这两个 `name`/`id` 与
包名一致，改漏了会红灯。

## 文档现状

`docs/` 下 6 份文档分两类，**改之前先分清**：

**历史决策记录**（过程叙述保留原样，改了反而破坏其价值）：

- `feasibility-assessment.md` —— 开头声明「写于纯配置阶段，是当时的决策依据」，其中的版本号与数字描述的是当时的环境
- `implementation-plan.md` —— 实施过程与检查点结论，头部有状态表（阶段、日期、结论）
- `plugin-parity-assessment.md` —— 开头声明「写于薄壳插件建成之前，是决策依据而非当前状态」

这些文档里若出现"已落实""✅"这类结论行，那些行描述的是**当前状态**，需要跟代码同步；但叙述性的过程记录不要改。

**当前状态文档**（必须与代码一致）：

- `README.md` —— 用户第一入口
- `market-submission.md` —— 投稿流程与两条易踩的 DSH 规则

## 代码风格

- 注释用中文，说明「为什么」而非「做了什么」
- 不引入抽象层：`src/` 与 `client/` 合计约 950 行，薄壳的价值在于可读完
- 错误信息要可操作——告诉用户下一步做什么，而不是描述失败原因
- 新增依赖、新增外部服务、新增平台特定逻辑，都需要先质疑其必要性
- 客户端补丁只做「隐藏一个标签」这种量级的事；一旦需要在浏览器里做逻辑，
  先回头质疑需求本身，而不是把 `client/client.js` 养大

## 提交规范

Conventional Commits：type 与 scope 用英文，subject 与 body 用中文。**本仓库历史不使用 scope**（见 `git log`）。

一次提交一个逻辑改动。用户可见的错误修复（`fix`）与文档同步（`docs`）分开提交，便于日后区分真实缺陷与文档维护。

## 发版

发布前确认目标 registry：npm 可能被全局 `registry` 配置指向镜像源，
发布前显式指定官方源，避免误发到非预期源。

## 不要做的事

- ❌ 给 provider 加功能（越界，由 `dsh-llm-pi-ai` 负责）
- ❌ 往用户 profile 里写 provider 定义（定义归插件的补丁层；补救路径要用户显式执行）
- ❌ 用补丁整体替换 `llm-pi-ai` 的 config（会抹掉用户配置；插件层声明会被它盖掉，这正是启动看护要抓的情况）
- ❌ 改了 `provider/radeon-cloud.yml` 却忘了 `pnpm sync:patch`（补丁里的副本会与真源脱节）
- ❌ 在插件启动时写用户 profile（有竞态风险，故设计为只读判定 + 响亮失败）
- ❌ 让「一致即放行」的判定退化成「有声明就失败」（设置页每保存一次都会物化一份副本，那会让插件在正常操作后起不来）
- ❌ 统一 `id` 与 `name`（它们故意不同）
- ❌ 放宽 `@deepseek-ai/cordis` 的版本范围（不影响闸门，只会制造 peer 噪音）
- ❌ 手工编辑 `node_modules` 或 profile 里的文件（改上游要从源码改）