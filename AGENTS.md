# AGENTS.md

本文件为在本仓库工作的智能体与协作者提供指引。

## 这是什么

`@zhz8888/dsh-radeon-cloud-patcher` —— 一个把 AMD Radeon Cloud 接入 DeepSeek Harness 的 DSH 插件。

**核心认知：本插件不实现任何 provider 逻辑。** 传输、思考字段解析、多轮回传、用量计量全部由 DSH 自带的 `dsh-llm-pi-ai` 承担。本插件只做四件事：分发、版本闸门、按键写入 profile、启动校验。

任何"顺手给 provider 加个功能"的想法都违背本项目的设计前提。

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

### 合并粒度是键，不是文件

DSH 的非 `insert` 补丁是**整体替换**。直接用补丁改写 `llm-pi-ai` 的 config 会抹掉用户在该命名空间下自行添加的 provider。

因此 `cordis.plugin.patch.yml` 只插入本插件自己一行，不携带 `llm-pi-ai` 配置；provider 定义由 `scripts/apply-to-profile.mjs` 按键合并，只动 `providers.radeon-cloud`。

`src/merge.js` 里写死两个常量，改动它们要极度谨慎：

```js
export const PROVIDER_KEY    = 'radeon-cloud'
export const TARGET_ENTRY_ID = 'llm-pi-ai'
```

`TARGET_ENTRY_ID` 是 DSH 自己的条目 id，与本插件无关。

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
pnpm test                 # 15 项合并语义 + 17 项文本级合并 + 思考字段取回断言
pnpm test:merge           # 仅前两项，离线
pnpm test:reasoning       # 仅思考字段取回
pnpm validate             # 用 llm-pi-ai 真实 schema 校验 provider 定义
pnpm probe                # 实测各模型思考档位（需密钥，会打真实 API）
pnpm install:profile:dry  # 演练合并进 profile，只打印不写入
pnpm install:profile      # 实际写入（自动备份，断言其余条目逐字未变）
```

改完代码至少跑 `pnpm test && pnpm validate`。`pnpm validate` 是唯一能发现「上游把字段改了名」的手段，**升级 DSH 后务必跑一次**。

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
- `src/index.js` 的 `export const name`
- `src/yaml.js` 的错误信息前缀
- `README.md` 的包名说明与 `dsh plugin add` 命令
- `docs/` 下提到包名的地方（`patch` 的 `id` **不要**改）

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
- 不引入抽象层：这个项目一共 577 行源码，薄壳的价值在于可读完
- 错误信息要可操作——告诉用户下一步做什么，而不是描述失败原因
- 新增依赖、新增外部服务、新增平台特定逻辑，都需要先质疑其必要性

## 提交规范

Conventional Commits：type 与 scope 用英文，subject 与 body 用中文。**本仓库历史不使用 scope**（见 `git log`）。

一次提交一个逻辑改动。用户可见的错误修复（`fix`）与文档同步（`docs`）分开提交，便于日后区分真实缺陷与文档维护。

## 发版

发布前确认目标 registry：npm 可能被全局 `registry` 配置指向镜像源，
发布前显式指定官方源，避免误发到非预期源。

## 不要做的事

- ❌ 给 provider 加功能（越界，由 `dsh-llm-pi-ai` 负责）
- ❌ 用补丁整体替换 `llm-pi-ai` 的 config（会抹掉用户配置）
- ❌ 在插件启动时写用户 profile（有竞态风险，故设计为显式动作）
- ❌ 统一 `id` 与 `name`（它们故意不同）
- ❌ 放宽 `@deepseek-ai/cordis` 的版本范围（不影响闸门，只会制造 peer 噪音）
- ❌ 手工编辑 `node_modules` 或 profile 里的文件（改上游要从源码改）