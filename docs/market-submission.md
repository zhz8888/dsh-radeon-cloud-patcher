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

这两条不在贡献指南里，但直接决定插件能不能装。

### 一、版本闸门只读 `peerDependencies`，不读 `engines.dsh`

DSH 官方文档说 `engines.dsh` 是「作者声明的兼容版本」，并在「已知限制」里写明
**当前安装器和加载器不强制检查**它。

实际执行闸门判定的是这段代码（`@deepseek-ai/dsh-app-boot`）：

```js
// evaluatePluginCompatibility()
if (!Object.hasOwn(fields, "peerDependencies")) return void 0;
for (const [name, range] of Object.entries(dependencies)) {
  if (name !== "@deepseek-ai/dsh" && !name.startsWith("@deepseek-ai/dsh-")) continue;
  ...
  if (!semver.satisfies(runtimeVersion, requirement, { includePrerelease: true })) peers[name] = range;
}
```

推论有三条：

1. **只有 `@deepseek-ai/dsh` 和 `@deepseek-ai/dsh-*` 开头的 peer 参与判定。**
   `@deepseek-ai/cordis` 会被 `continue` 跳过——给它放宽版本不会影响闸门。
   但**它仍要写在 `peerDependencies` 里**（插件运行时确实 import 它），范围同样只有下界：
   `>=4.0.2`。它卡的不是闸门，而是 pnpm 的 peer 解析——写死上界会在 cordis 升大版本时
   把安装卡住，用户只能手动绕过。
2. **判定基准是 DSH 运行时版本**，不是各个包各自的版本。
   peer 里写 cordis 的版本号，对闸门毫无作用。
3. **不匹配是硬拒装**，不是警告：
   ```js
   if (preflight.length > 0) return rejected(preflight, "nothing was installed");
   ```
   安装器会中止，一个包都不装。

`engines.dsh` 与 `dsh.compatibility` 仍建议写——它们是给人看的声明——
但**放宽兼容范围时，要改的是 `peerDependencies`**。

### 二、peer 范围的形态：预发布与上界

本包取的是**只有下界**的形态：

```json
"@deepseek-ai/dsh-llm": ">=0.2.0-rc.1"
```

理由是不写上界就不必在 DSH 每升一个大版本时重发插件放宽范围。代价要清楚：
node-semver 规定，只有范围里存在「元组相同、且自身也带预发布标签」的比较符时，
该预发布才被放行——所以 `>=0.2.0-rc.1` 覆盖 `0.2.0` 元组的预发布，
却漏掉新元组的预发布，而且**两条路径的判定并不一致**：

| 运行时版本 | DSH 闸门（`includePrerelease: true`） | npm/pnpm 默认规则 |
| --- | --- | --- |
| `0.2.0-rc.2`、`0.2.0`、`0.2.1`、`0.3.0`、`1.0.0` | ✅ | ✅ |
| `0.2.1-alpha.1`、`0.3.0-beta.1` 等新元组的预发布 | ✅ | ❌ |

漏掉的后果不是报错的版本号，而是用户遇到 `ERESOLVE`，得自己手工绕过。
真需要覆盖某个元组的预发布时，给该元组补一条分支即可
（例如到 `0.2.1`：「`>=0.2.0-rc.1 <0.2.1-0 || >=0.2.1-0`」；
上限写 `<0.2.1-0` 而非 `<0.2.1`，这样 `0.2.1` 本身仍在范围内）。

也可以让用户端绕过：`dsh plugin --profile <profile> add <包名> --config.strict-peer-dependencies=false`
（`dsh plugin` 的参数原样转发给 pnpm）。

---

## 可选加分项

### 发布到 npm

不影响收录，只是让市场能显示下载量并排序。已发布包的 `repository` 字段必须指回
收录的那个仓库，否则两者不关联。映射由上游自动从 registry 采集，
**不要在条目里手写 `npm:` 键**，会被校验拒绝。

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