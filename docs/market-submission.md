# 发布到 awesome-dsh-plugin 列表

本文说明如何把一个 DSH 插件提交到 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin)
列表，以及本项目在准备过程中查明的、容易踩坑的 DSH 插件规则。

规则细节以[上游贡献指南](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)为准。
本文只补充「指南没写、但实际会卡住你」的部分。

---

## 投稿形态：一个 YAML 文件

两个 README 由上游脚本生成，**不要手工编辑**。投稿的全部内容是新增一个文件：

```
data/plugins/<owner>__<repo>.yml
```

```yaml
url: https://github.com/<owner>/<repo>      # 必须与仓库地址完全一致
name: <owner>/<repo>                        # 列表中显示的链接文字
category: <分类>                            # 见下方分类列表
description:
  en: One-line description ending with a period.
  zh: 一句话描述，以句号结尾。                 # 可选，维护者会补
```

- 只有 `description.en` 必填。缺中文翻译不是打回理由。
- 描述里含 `: `（冒号加空格）**必须加引号**，否则 YAML 解析成嵌套键。
- 一个 PR 最多加 3 条。
- monorepo 子包：`url` 指向子目录，`name` 用 `owner/repo#subname`，
  文件名变成 `owner__repo--packages-my-plugin.yml`。

可用 `category`：
`agi` `ui` `usage` `theme` `model` `identity` `session` `memory` `tools`
`wsl` `browser` `vision` `voice` `docs` `skill` `workflow` `git`
`notify` `dev` `security` `remote` `market` `fun`

这组取值不固定。分类选得不够准不会被打回，维护者会直接改。

---

## 收录要求

| 要求 | 说明 |
| --- | --- |
| `dsh.bundle` manifest | `package.json` 里必须有，这是能用 `dsh plugin add` 安装的前提 |
| 仓库根有 patch 文件 | 指南示例用 `cordis.patch.yml`，见下方「补丁文件名」 |
| 真实可用代码 | 占位仓库、抢注名、纯 README 仓库不收 |
| 仓库创建满 1 天 | CI 自动检查，只过滤「PR 前几分钟才建好」的仓库，没有提交数门槛 |
| 项目活跃维护 | 仓库消失、归档或长期停更的条目会被定期清理 |
| `dsh-plugin` topic | 在 GitHub 仓库设置里手动添加 |
| 描述属实 | 描述会与源码逐条核对，夸大是打回的首要原因 |
| 官方包用 `peerDependencies` | 不要用 `dependencies` |

CI 依次检查：条目数 ≤ 3 → `dsh.bundle` → 仓库年龄 → `awesome-lint` 与站点构建。

CI 通过是**前置条件，不是结论**。合并前维护者会实际读你的源码。

### 补丁文件名

指南示例写的是 `cordis.patch.yml`，但 `dsh.bundle.patch` 是**显式路径声明**，
launcher 按这个路径读取，因此补丁文件叫什么名字都能装。

文件名与指南示例不一致不会被 CI 拦。改名的唯一代价是仓库里所有引用它的地方
（README、文档、发布产物清单）都要同步改，属于纯形式变更，通常不值得。

### 描述怎么写

指南反复强调：**描述会当作对插件的声明，并与代码核对**。写「46 个工具、六大领域」
就应该真有 46 个工具；提到某个命令或 API，它就应该存在。

所以描述只写可验证的事实，不写营销词。下面两条能过关：

- ✅ 「接入 AMD Radeon Cloud 模型 provider，支持逐模型思考档位。」—— 与 `provider/radeon-cloud.yml` 对得上
- ❌ 「强大的推理加速方案，全面赋能你的 AI 编程体验。」—— 无法核对，且含营销词

自己不承担的功能不要写进去。本项目的推理解析由 DSH 自带的 `dsh-llm-pi-ai` 完成，
描述里就不该声称自己实现了推理。

---

## 两个容易踩的 DSH 规则

这两条不在贡献指南里，但直接决定插件能不能装。**判定机制的代码依据写在
[`AGENTS.md`](../AGENTS.md) 的「版本闸门」一节**，这里只留投稿侧要照做的结论。

### 一、版本闸门只读 `peerDependencies`，不读 `engines.dsh`

- `@deepseek-ai/*` 官方包必须写进 `peerDependencies`——装不装得上由它判定。
  `engines.dsh` 与 `dsh.compatibility` 只是给人看的声明，但三处要保持一致
  （本仓库由 `pnpm test:manifest` 断言）。
- 判定只看 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*`；`@deepseek-ai/cordis` 会被跳过，
  但它仍要写在 `peerDependencies` 里（插件运行时确实 import 它），范围同样只取下界
  `>=4.0.2`——写死上界会在 cordis 升大版本时把用户的安装卡住。
- 不匹配是**硬拒装**（`rejected(preflight, "nothing was installed")`），一个包都不装，
  所以别声明自己都满足不了的范围。

### 二、peer 范围的形态：只有下界

本包取 `>=0.2.0-rc.1` 这种**只有下界**的形态：不写上界，就不必在 DSH 每升一个大版本时
重发插件放宽范围。代价是一处 semver 细节——`>=0.2.0-rc.1` 只覆盖 `0.2.0` 这一元组的
预发布，新元组的预发布（`0.2.1-alpha.1`、`0.3.0-beta.1`…）在 npm/pnpm 的默认规则下
不被放行，而 DSH 自己的闸门（带 `includePrerelease`）会放行：**两者不一致时失败的是
pnpm**，用户看到的是 `ERESOLVE`。

真需要覆盖某个元组的预发布时，给该元组补一条分支即可
（例如到 `0.2.1`：「`>=0.2.0-rc.1 <0.2.1-0 || >=0.2.1-0`」；
上限写 `<0.2.1-0` 而非 `<0.2.1`，这样 `0.2.1` 本身仍在范围内），
或让用户端绕过：`dsh plugin --profile <profile> add <包名> --config.strict-peer-dependencies=false`
（`dsh plugin` 的参数原样转发给 pnpm）。

---

## 可选加分项

### 发布到 npm

不影响收录，只是让市场能显示下载量并排序。已发布包的 `repository` 字段必须指回
收录的那个仓库，否则两者不关联。映射由上游自动从 registry 采集，
**不要在条目里手写 `npm:` 键**，会被校验拒绝。

#### 手动发布步骤

**前提：本机 npm 的默认源是镜像**（`npm config get registry` 会打印
`https://registry.npmmirror.com`），而**镜像只读、不能发布**。所以下面每条命令都显式带官方源；
更省事的做法是只给这个 scope 固定官方源，其余包继续走镜像：

```bash
npm config set @zhz8888:registry https://registry.npmjs.org
```

**① 发布前自查**（仓库根目录）：

```bash
pnpm test && pnpm validate   # 112 项检查 + 用 llm-pi-ai 真实 schema 校验定义
pnpm test:manifest           # 三处 DSH 版本声明一致、files 白名单覆盖所有清单指向的文件
npm pack --dry-run --registry https://registry.npmjs.org   # 打印真会传上去的文件清单
```

`files` 白名单决定包里有什么：`src/ client/ provider/ scripts/ cordis.plugin.patch.yml
LICENSE README.md`——**不含** `test/` 与 `docs/`，这是有意的（用户只需要能跑的代码与说明）。
1.2.0 实测为 17 个文件。

> 若自查时报 `EPERM … /Users/zhz/.npm/_cacache/tmp/***` 并附一句「Your cache folder contains
> root-owned files」：**那是 npm 的误报**。本机 `~/.npm` 下没有任何 root 属主文件
> （`find ~/.npm ! -user "$(id -un)"` 为空），真实原因是运行环境不允许写 `~/.npm`
> ——例如在受限沙箱里执行。换一个可写的缓存目录即可，不要照 npm 的提示去 `sudo chown`：
>
> ```bash
> npm pack --dry-run --cache /tmp/npm-cache --registry https://registry.npmjs.org
> ```

**② 登录官方源**（本机当前未登录；只需一次）：

```bash
npm login --registry https://registry.npmjs.org     # 走浏览器授权
npm whoami --registry https://registry.npmjs.org    # 应打印你的 npm 用户名
```

**③ 发布**：

```bash
npm publish --registry https://registry.npmjs.org --access public

# 开了两步验证时追加一次性口令
npm publish --registry https://registry.npmjs.org --access public --otp=123456
```

**④ 发布后核对**：

```bash
npm view @zhz8888/dsh-radeon-cloud-patcher version dist.tarball --registry https://registry.npmjs.org
dsh plugin --profile <profile> add @zhz8888/dsh-radeon-cloud-patcher   # README 的方式一现在可用
```

#### 四个容易踩的点

- **scope 必须先归你**：`@zhz8888` 能发布的前提是 npm 用户名就是 `zhz8888`（与用户名同名的
  scope 自动归该账号）。若 `npm whoami` 打印的是别的名字，`publish` 会 403——先在 npm 上建
  同名组织，或改用自己用户名下的 scope（改包名要连带改补丁的 `name`、`export const name`、
  客户端模块的 `id` 与 README，清单见 `AGENTS.md`）。
- **scoped 包默认私有**：漏掉 `--access public` 会以失败告终；也可以在 `package.json` 里加
  `"publishConfig": { "access": "public" }` 一劳永逸。
- **版本号不可重发**：同一版本发布过即永久占用。发布前确认 `package.json` 的 `version` 与
  git tag 对齐（发完可用 `git rev-parse <tag>^{commit}` 与 `npm view <包名>@<版本> gitHead` 核对）。
- **发错号就发下一个版本，别删掉重发**：`unpublish` 后再 `publish` 复用同一个版本号是 npm
  明令禁止的；删掉某个版本只会让 `latest` 被重算成剩余版本里最大的那个，那个号也再回不来。
- **CI 里发布**用粒度访问令牌，不要用账号口令：

  ```bash
  NODE_AUTH_TOKEN=npm_xxx npm publish --registry https://registry.npmjs.org --access public
  # 或写进 ~/.npmrc：//registry.npmjs.org/:_authToken=npm_xxx
  ```

#### 用 gitHead 核对「npm 版本 ↔ git tag」

npm 会把它发布时 HEAD 的提交 SHA 记在版本的 `gitHead` 里，这正是把 npm 版本与 git tag 对齐的
凭据：

```bash
npm view @zhz8888/dsh-radeon-cloud-patcher@1.2.0 gitHead --registry https://registry.npmjs.org
git rev-parse v1.2.0^{commit}        # 两者应完全一致
```

### GitHub Release tarball

不发 npm 的话，把预构建 tarball 挂到 Release，条目里加 `tarball:` 字段，
市场会优先展示它而不是源码构建命令。

```yaml
tarball: https://github.com/<owner>/<repo>/releases/latest/download/<plugin>.tgz
```

必须是 GitHub 托管的 https `.tgz`。**资产名不要带版本号**——
`latest/download/` 只在请求时解析 `latest`，文件名是照字面取的，
带版本号的话提交当天有效，下次发版就 404，而且不会有人察觉（包括你自己）。
要么让资产名不带版本，要么钉住 release tag。

### 截图

在仓库里放 `screenshots.json`（与 `package.json` 同级），列出 1-8 张图片路径：

```json
["assets/screenshot-1.png", "assets/screenshot-2.png"]
```

也接受 `{"screenshots": [...]}` 形式。路径相对于该文件；
相对路径不能以 `/` 开头或含 `..`。绝对 URL 只接受 GitHub 托管的 https 链接。

放在自己仓库里的好处：改截图直接 push，不用提 PR 等维护者，
下一次构建自动生效；而且仓库里改了文件名会立刻发现，写死在上游的绝对 URL 只会悄无声息地烂掉。

不声明也能收录——市场会从 README 自动抽取图片，声明只是让你能控制顺序和选图。

---

## 投稿前自查

- [ ] 仓库在 GitHub 公开可访问，`url` 与地址完全一致
- [ ] 仓库创建满 1 天
- [ ] `package.json` 有 `dsh.bundle`，且 patch 文件真实存在
- [ ] 若声明了客户端半边（`dsh.client` + `exports["./client"]`），文件按 DSH 的客户端模块格式（`window.__ModuleLoader__.load`）提供，且注册 `id` 等于包名
- [ ] `@deepseek-ai/*` 官方包都声明在 `peerDependencies`
- [ ] peer 范围的形态想清楚了（本包：只有下界、无上界），并在 DSH 闸门与 npm 解析两条路径上都验过预发布行为
- [ ] 描述里的每个数字、每个命令名都能在代码里找到对应
- [ ] 分类贴合插件实际做的事
- [ ] 已添加 `dsh-plugin` topic
- [ ] `repository` / `homepage` / `bugs` 指向同一个仓库
- [ ] 一个 PR 不超过 3 条，且只动了自己那一条

最后一条特别提醒：更新自己的条目时，只改自己的 `data/plugins/<owner>__<repo>.yml`，
**不要手工编辑生成的 README**。行号会随列表增长而移位，改动很容易落到邻居身上。

---

## 评审会看什么

CI 管形式，评审管内容。合并前维护者会实际读源码，重点看：

1. 代码是否与条目声明一致（含描述里的数字与 API 名称）
2. 分类是否合理
3. 是否是真实可用的代码，而非空壳
4. 是否已被现有条目覆盖
5. 源码里有没有可疑之处——混淆代码、凭据外传、异常安装期行为
6. PR 是否动了不该动的条目
7. 是不是纯聚合包（只装别人插件、自己不带行为的）
8. 依赖是否指向原作者，而不是别人的副本

收录不等于通过安全审查，只是常识性检查。

被要求修改描述**不是对插件的否定**，改好那一行就能进。