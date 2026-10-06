# Radeon Cloud Patcher for DeepSeek Harness

把 [AMD Radeon Cloud](https://amd-aim.github.io/radeon-cloud-docs/) 接入 DeepSeek Harness 的模型选择器，**完整支持模型思考（reasoning）功能**。

包名 `@zhz8888/dsh-radeon-cloud-patcher`。provider 定义由插件**自带的补丁层**声明，
由 DSH 自带的 `dsh-llm-pi-ai`（通用 OpenAI 兼容 provider）承载——**不修改 DSH 本体，
不需要自研适配器，也不往你的 profile 里写任何东西**。

> 之所以叫 patcher，是因为它靠**补丁层**交付：定义写在插件自己的
> `cordis.plugin.patch.yml` 里。这样做的直接后果有三个，也正是这个设计的目的——
>
> | 现象 | 原因 |
> | --- | --- |
> | 设置页**没有**「删除」按钮 | DSH 只在「该 provider 路径存在于用户层、且不存在于 base 层」时渲染它；定义在插件的 bundle 层，base 层永远有它 |
> | 卸载插件 = 删除供应商 | 定义只活在插件里，profile 中不留副本 |
> | 想删供应商只能卸载插件 | 同上；设置页里也点不到删除 |

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![target: DSH](https://img.shields.io/badge/DSH-0.2.x-blue?label=target)
![Radeon Cloud](https://img.shields.io/badge/API-Radeon%20Cloud-orange)

---

## 快速上手

装好 DSH、手上有 Radeon Cloud 的 API 密钥（`rc-…`），三步就能用起来，
**不需要编辑任何配置文件**：

1. **装插件** —— 桌面版在左侧「插件」页里添加 `@zhz8888/dsh-radeon-cloud-patcher`；
   命令行执行
   `dsh plugin --profile <profile> add @zhz8888/dsh-radeon-cloud-patcher`。
   装不上（pnpm 报 404）就改用[安装](#安装)里的方式三，从源码装同一个包。
2. **重启 DSH** —— 定义写在补丁层的 config 行里，而插件市场的**热挂载只支持纯 insert 行**，
   因此安装后市场会提示「重启后生效」，这一步不能省。重启后 provider 就位，没有其它后置步骤。
3. **填密钥** —— 左下角「账号菜单 → 设置 → 模型」，找到 **Radeon Cloud** 一行，
   点「编辑」，在「API 密钥」里粘贴密钥，点「保存」。

装好之后：那一行右侧出现**绿点**（悬停显示「API 密钥已配置」）；回到对话，点输入框下方的
模型选择器，Radeon 的 8 个模型会出现在列表里；选中模型后再选「推理等级」就是思考档位。

**怎么确认真的装好了** —— 三个现象同时成立，说明插件与它的补丁层都到位：

| 现象 | 在哪看 |
| --- | --- |
| 模型选择器里出现 Radeon Cloud 的模型 | 输入框下方的模型选择器 |
| 那一行**没有**「删除」按钮 | 设置 → 模型 → Radeon Cloud 行 |
| 那一行**不带**「自定义」标签 | 同上 |

**没生效怎么办** —— 插件不会静默消失：定义失效时它**直接让启动失败并写明原因**
（profile 里已有同 id 定义、profile 的 `llm-pi-ai` 配置把插件层整份盖掉……），
逐条处置见[归属与删除](#归属与删除)。想手工核验真正生效的配置，用
`dsh --profile <profile> --dump-config`（`desktop` profile 例外，它由桌面应用独占管理）。

> 更细的安装方式（npm 源、镜像、GitHub、本地 tarball、手工清单）见[安装](#安装)；
> 密钥、模型、档位、图片输入与升级卸载见[使用](#使用)。

---

## 目录

- [快速上手](#快速上手)
- [功能](#功能)
- [环境要求](#环境要求)
- [安装](#安装)
- [使用](#使用)
- [归属与删除](#归属与删除)
- [项目结构](#项目结构)
- [常用命令](#常用命令)
- [可用模型](#可用模型)
- [已知限制](#已知限制)
- [兼容性](#兼容性)
- [许可证](#许可证)

---

## 功能

### 规范化模型返回文本的结构

Radeon 的响应体与流式分片都存在一个容易致错的形态：思考内容的字段名是 `reasoning`，
但同一份数据里还带一个 `reasoning_content` 占位，且占位值是 `null` 而不是空字符串。
按字段名直读会取到 `null`，思考内容静默丢失，**全程不产生任何报错**。

本配置接的是 DSH 既有的字段选择逻辑——取第一个「值为非空字符串」的思考字段。
`null` 的类型不是字符串，于是被自然跳过，正确落到 `reasoning`。经此规范化：

| 源字段 | 规范化后的结构 |
| --- | --- |
| `delta.content` / `message.content` | 回答 → `text` 内容块 |
| `delta.reasoning` / `message.reasoning` | 思考 → `reasoning` 内容块 |
| `delta.reasoning_content: null` | 跳过，不产生空块 |

思考与回答成为并列的两类内容块，在界面上分区呈现，而不是把思考混进正文。

### 桥接模型思考方式回传

思考不只是「取回来」，还必须能「送回去」——多轮对话中 DSH 会把上一轮的助手消息
连同思考内容一起回传，否则多轮上下文会断裂。

- **流式产出**：思考以 `reasoning-delta` 分片实时送达界面，不必等回答生成完毕；
- **对称回传**：回放时使用**读取时所用的同一个字段名**（助手消息上的 `reasoning`），
  而非另换一个字段名，避免读取与回传不对称导致多轮请求被拒；
- **强度可选**：思考强度按模型逐个声明，而非全局统一。接受 `none` 的模型可关闭思考，
  不接受的模型则不提供该档位，而非提供一个会报错的选项；
- **用量归集**：思考 token 计入 `reasoning_tokens`，与回答 token 一并进入用量统计。

实测确认：Radeon 的 `usage` 在顶层与 `completion_tokens_details` 两处都回报
`reasoning_tokens` 且数值一致，DSH 读取后者即可正常计量。

### 其他

- 8 个对话模型全部可选，思考档位按模型独立声明
- 视觉模型支持图片输入
- 限流退避遵循服务端 `Retry-After`
- 附带离线校验、回归测试与档位实测工具

---

## 环境要求

| 项 | 要求 | 说明 |
| --- | --- | --- |
| DSH | `>=0.2.0-rc.1`（含预发布，无上界） | 由 `peerDependencies` 声明范围，低于下界会被安装器拒绝；上界不写，DSH 升大版本不需要插件跟着重发（见[版本闸门](#版本闸门)） |
| Node.js | `>=22` | 与 `package.json` 的 `engines.node` 一致；仅运行 `scripts/` 与 `test/` 下的脚本时需要 |
| bash | 任意 | 仅 `scripts/radeon-api.sh` 需要 |
| 操作系统 | macOS | `scripts/validate-config.mjs` 按 DSH 桌面版应用包的绝对路径加载校验用的 schema，路径为 `/Applications/DSH Desktop.app/Contents/Resources/app/node_modules`。其余脚本与系统无关 |

> 配置文件本身（`provider/radeon-cloud.yml`）是纯 YAML，不依赖上述任何运行时。

---

## 安装

四种方式，任选其一。**装完都要重启 DSH**（原因见[快速上手](#快速上手)第 2 步）：
定义由插件自带的补丁层声明，不写入你的 profile，重启后即生效，没有其它后置步骤。

### 方式一：DSH 插件管理器（推荐）

桌面版：应用左侧「插件」页 → 「添加插件」→ 输入包名或本地目录路径。

命令行：`dsh plugin --profile <profile> …` 会把参数**原样转发**给 profile 目录里的 pnpm，
因此 pnpm 支持的写法它都支持：

```bash
dsh plugin --profile <profile> add @zhz8888/dsh-radeon-cloud-patcher
dsh plugin --profile <profile> remove @zhz8888/dsh-radeon-cloud-patcher   # 卸载
```

装完 `dsh.profile.bundles` 会自动多出本包名——插件管理器按各包的 `dsh.bundle` 声明维护它，
不必手改 profile 清单。

> **桌面版的 `desktop` profile 由应用独占管理**：在普通终端里执行
> `dsh plugin --profile desktop …` 会被拒绝（`profile "desktop" is managed exclusively by
> the Electron application`）。两条正路：用应用内的插件页安装，或在应用右上角
> 「打开 DSH 终端」里执行同样的命令。`web` / `tui` / `headless` 等 profile 不受此限。
>
> 若你的源上还没有这个包（pnpm 报 404），用方式三装同一个包。

### 方式二：从 npm 源安装

方式一走的就是 npm registry；换源只需给 pnpm 传参，或写进 profile 自己的 `.npmrc`：

```bash
# 单次指定镜像源
dsh plugin --profile <profile> add @zhz8888/dsh-radeon-cloud-patcher \
  --registry https://registry.npmmirror.com

# 或给这个 profile 固定源（.npmrc 是 pnpm 自己的配置文件）
printf 'registry=https://registry.npmmirror.com\n' >> ~/.dsh/profiles/<profile>/.npmrc

# 指定版本或范围（pnpm 语法）
dsh plugin --profile <profile> add @zhz8888/dsh-radeon-cloud-patcher@<版本>
```

> 本包的 tarball 里只有 JSON / YAML / JS，**没有安装期构建脚本**，
> 因此换源、离线镜像、内网私服都不会碰到 pnpm 的 `allowBuilds` 授权那一步。

### 方式三：从源码 / GitHub 安装

三种源码形态都直接可用，原因同上：本项目零运行时依赖、没有构建步骤。

```bash
git clone https://github.com/zhz8888/dsh-radeon-cloud-patcher.git

# ① 本地目录：pnpm 做 link，仓库里改了代码重启 DSH 即生效（开发本插件时最省事）
dsh plugin --profile <profile> add /绝对路径/dsh-radeon-cloud-patcher

# ② git 依赖：直接装公开仓库
dsh plugin --profile <profile> add github:zhz8888/dsh-radeon-cloud-patcher

# ③ 本地 tarball：适合内网分发（npm pack 在仓库目录里执行）
npm pack
dsh plugin --profile <profile> add ./zhz8888-dsh-radeon-cloud-patcher-<版本>.tgz
```

> DSH 对「装 git 依赖」有一句提醒：带 `prepare` 脚本的插件会在安装期构建，
> 而 pnpm 默认拦住构建脚本，需要先在 profile 的 `pnpm-workspace.yaml` 里追加
> `allowBuilds` 才能装上。**本插件不属于这种情况**——它没有任何安装期脚本。

### 方式四：手工改 profile 清单

不用插件管理器时：

1. 在 profile 的 `package.json` 里把本包加进 `dependencies`；
2. 把包名追加进 `dsh.profile.bundles`（顺序即补丁层顺序，放在 `@deepseek-ai/dsh-base`
   与 `@deepseek-ai/dsh-web-app` 之后即可）；
3. 执行 `dsh plugin --profile <profile> install` 安装依赖。

### 版本闸门

本包的 DSH 兼容范围是 **`>=0.2.0-rc.1`——只有下界，没有上界**，
三处声明逐字一致（`peerDependencies`、`engines.dsh`、`dsh.compatibility.dsh`，
由 `pnpm test:manifest` 断言）：

- DSH 安装器读的是 `peerDependencies`：运行时版本低于下界 → **直接拒绝安装**，
  不会出现「装上了但思考功能失效」；
- **上界故意不写**：写死上界意味着 DSH 每升一个大版本都要重发一版插件去放宽范围，
  代价大于收益。换来的代价是失去「未来版本被挡住」这层保护——改由插件自己的
  响亮失败兜底（定义校验、id 归属判定、启动收尾核验路由是否注册，
  见[归属与删除](#归属与删除)）。

> **预发布的一个细节**：node-semver 规定，带预发布标签的版本只有在范围里存在
> 「元组相同、且自身也带预发布标签」的比较符时才被放行。
> `>=0.2.0-rc.1` 因此只覆盖 `0.2.0` 这一元组的预发布（`0.2.0-rc.2` ✓）；
> `0.2.1-alpha.1`、`0.3.0-beta.1` 这类**新元组的预发布**在 npm/pnpm 的默认规则下
> 不被放行（DSH 自己的闸门带 `includePrerelease`，会放行——两者判定不一致时，
> 失败的是 pnpm 那一步）。真遇到时二选一：
>
> ```bash
> # ① 给该元组补一条分支，写回范围（例如到 0.2.1 的预发布）
> #    ">=0.2.0-rc.1 <0.2.1-0 || >=0.2.1-0"
>
> # ② 或让 pnpm 放宽 peer 校验（参数照样原样转发）
> dsh plugin --profile <profile> add @zhz8888/dsh-radeon-cloud-patcher \
>   --config.strict-peer-dependencies=false
> ```
>
> 稳定版（`0.2.0`、`0.2.1`、`0.3.0`、`1.0.0`…）不受这个细节影响，一律放行。

---

## 使用

### 1. 配置 API 密钥

密钥从 [AMD Radeon Cloud 文档](https://amd-aim.github.io/radeon-cloud-docs/) 里的入口申请
（本项目只覆盖 Public Free Model APIs 的共享端点）。拿到 `rc-…` 之后二选一：

**方式一：设置页（推荐给日常使用）**

左下角「账号菜单 → 设置 → 模型」→ Radeon Cloud 行 →「编辑」→ 在「API 密钥」里粘贴
`rc-…` →「保存」。保存成功后该行右侧出现**绿点**（悬停显示「API 密钥已配置」；
没配密钥时是红点，提示「API 密钥缺失」）。

密钥写进本机凭据存储 `~/.dsh/.credentials.yaml` 的 `RADEON_CLOUD_API_KEY` 条目，
明文不落配置文件、界面不回显；要换密钥就再次「编辑」并输入新值
（输入框会提示「已配置——输入新值可替换」）。`scripts/` 下的脚本读的是同一个条目，
因此在设置页填过一次，脚本也就不用再配了。

**方式二：环境变量（不落盘，适合临时试用与 CI）**

```bash
export RADEON_CLOUD_API_KEY=rc-你的密钥
```

凭据服务按「**继承的进程环境** → 插件写入的凭据存储 → 当前目录 `.env` → `$DSH_HOME/.env`」
依次查找，环境变量优先级最高，一次性的写法也有效：

```bash
RADEON_CLOUD_API_KEY=rc-你的密钥 dsh --profile <profile>
```

> 注意名字：**插件运行时**读的是 `RADEON_CLOUD_API_KEY`（即 provider 定义里的
> `apiKeyEnv`），而**仓库脚本**用的是 `RADEON_API_KEY`。两者互不影响，
> 脚本那一套见下面的表格。

### 2. 选模型与思考档位

对话输入框下方点模型选择器 → 选 Radeon Cloud 的模型 → 再选「推理等级」，
那就是思考档位。档位按模型逐个声明（见[可用模型](#可用模型)）：
GLM 与 Qwen 系不接受 `none`，因此没有关闭档位；`MiniCPM5-2B` 不是推理模型，
不会出现档位下拉。选了服务端不接受的档位是**硬失败**（400 / 422），不会静默降级。

### 3. 图片输入

支持图片：DeepSeek-V4.1-Flash、DeepSeek-V4-Flash-Vision-Exp、MiMo-V2.6-Flash、
Qwen3.8-27B、Qwen3.8-Flash-Next。只收文本：DeepSeek-V4-Flash、GLM-5.3-Flash、MiniCPM5-2B。

### 4. 升级与卸载

```bash
dsh plugin --profile <profile> add @zhz8888/dsh-radeon-cloud-patcher@latest  # 升级
dsh plugin --profile <profile> remove @zhz8888/dsh-radeon-cloud-patcher      # 卸载
```

升级不需要额外动作：定义由插件层声明，装上新版本重启即生效
（在市场里升级同样会提示「重启后生效」，原因与安装一致）。
**卸载即删除供应商**——插件层消失，provider 与设置页那一行一起消失。

> 例外：如果你曾用 `pnpm install:profile` 把定义合并进 profile（见[归属与删除](#归属与删除)），
> profile 里那份副本会**盖住**插件层的新定义——升级后要么重跑一次
> `pnpm install:profile`，要么删掉那份副本，让插件独占管理。

### 5. 仓库脚本用的环境变量

下面这些只影响仓库里的 `scripts/`（`radeon-api.sh`、`probe-efforts.mjs`），
与插件运行时无关：

| 变量 | 作用 | 默认值 |
| --- | --- | --- |
| `RADEON_API_KEY` | 脚本用的密钥字面值，优先级高于凭据文件 | 无 |
| `RADEON_KEY_REF` | 脚本从凭据文件读取时用的条目名 | `RADEON_CLOUD_API_KEY` |
| `RADEON_BASE` | 端点基础 URL，可指向独占端点 | `https://developer.amd.com.cn/radeon/api/v1` |
| `DSH_HOME` | DSH 数据目录，凭据文件据此定位 | `~/.dsh` |

> 密钥在脚本中只存在于进程变量与 curl 请求头，不写盘、不打印、不出现在输出里。
> 但 shell 历史记录仍会留下 `export RADEON_API_KEY=...` 这一行，请自行注意。

---

## 归属与删除

本插件要求 `radeon-cloud` 这个 id **由它独占**，因此：

- 设置页那一行**不会出现「删除」按钮**。DSH 的判据是「该 provider 路径存在于用户层、
  且不存在于 base 层」——定义写在插件的 bundle 层，base 层永远有它，按钮因此永不渲染；
- **删除供应商 = 卸载插件**。卸载后插件层消失，provider 随之消失。
  若你曾用 `pnpm install:profile` 把定义合并进 profile，profile 里会留下一份副本
  （那份副本的所有权归你，卸载后设置页里也会重新出现删除按钮，可自行清理）；
- **「自定义」标签**：DSH 对**任何不在内置模型目录里的 provider** 硬编码了这个标记
  （`dsh-llm-pi-ai` 的 `declared: !catalog.has(provider)`），配置层面无从去掉。
  本插件随包带了一个极小的客户端补丁（`client/client.js`），用一条 CSS 规则把
  **本 provider 那一行**的标签隐藏掉：

  ```css
  li:has(button[aria-label*="(radeon-cloud)"]) span[class*="rowTag"] { display: none }
  ```

  代价说清楚：它依赖 DSH 的 DOM 结构与类名片段，DSH 改版后可能静默失效——
  标签重新出现，功能不受影响。

### 定义归谁管：启动时的判定

DSH 的非 insert 补丁是**整体替换**：`llm-pi-ai` 的 config 只要在 profile 里出现过，
就会整份盖掉插件层的定义。插件启动时静态读 profile / home / 命令行 overlay 三层，
判定这个 id 现在由谁说了算：

| 情况 | 结果 |
| --- | --- |
| 没人碰过 `llm-pi-ai` 的 config | 插件层的定义生效，正常启动 |
| profile 里有一份**与本插件一致**的同 id 声明 | 放行，并提示它会在卸载后残留（通常是你在设置页保存过一次、被物化出的副本） |
| profile 里有一份**与之不一致**的同 id 声明 | **启动失败**：报「provider id 冲突」，并指名第一处差异字段 |
| profile 给 `llm-pi-ai` 写了 config 却没有本 provider | **启动失败**：报「定义未生效」，并打印可直接执行的合并命令 |

后两种是**失败 + 原因**，而不是静默接管或静默消失——这是本项目的取舍：id 冲突要响亮。
处置方式（按键合并、`--force`、输出示例）见[已知限制](#6-与用户自有-provider-共存)。

> 想彻底消除标签、不留 DOM 依赖，只能让插件自己注册 provider 路由，也就意味着自己实现
> 传输、思考解析与用量计量。本项目定位是「薄壳 + 由 DSH 自带的 pi-ai 承载」，
> 因此选择了 CSS 隐藏这条路。

---

## 项目结构

```
dsh-radeon-cloud-patcher/
├── README.md                                  本文件
├── AGENTS.md                                  智能体与协作者指引
├── LICENSE                                    MIT 许可证
├── package.json                               插件包清单（版本闸门、导出、客户端声明、脚本）
├── cordis.plugin.patch.yml                    bundle 补丁：provider 定义 + 本插件行
├── pnpm-workspace.yaml                        本仓库的安装期构建授权（不影响用户安装）
├── pnpm-lock.yaml                             依赖锁文件
├── .gitignore
│
├── provider/                                  配置本体
│   └── radeon-cloud.yml                       provider 定义的唯一真源
│
├── client/                                    客户端补丁
│   └── client.js                              隐藏本行的「自定义」标签（DSH 客户端模块格式，非 ESM）
│
├── src/                                       插件实现（薄壳，不含 provider 逻辑）
│   ├── index.js                               插件入口：启动校验、所有权判定、收尾核验
│   ├── ownership.js                           所有权判定的纯函数（四种结局与差异定位）
│   ├── merge.js                               键级合并的纯函数（补救路径使用）
│   ├── patch-text.js                          文本级合并，保留用户注释与格式
│   ├── validate.js                            定义的结构校验
│   └── yaml.js                                定位 YAML 解析器
│
├── scripts/                                   运维与校验工具
│   ├── sync-bundle-patch.mjs                  把定义真源渲染进补丁的生成区块
│   ├── apply-to-profile.mjs                   补救路径：按键合并进 profile（冲突时拒绝覆盖）
│   ├── validate-config.mjs                    用 llm-pi-ai 真实 schema 校验定义
│   ├── probe-efforts.mjs                      实测逐模型 reasoning_effort 档位表
│   └── radeon-api.sh                          API 调用助手（密钥取自环境变量或凭据存储）
│
├── test/                                      离线测试
│   ├── merge.test.mjs                         合并语义与幂等性
│   ├── patch-text.test.mjs                    不破坏用户 provider 与注释
│   ├── ownership.test.mjs                     四种所有权结局与差异定位
│   ├── apply-guard.test.mjs                   启动看护：放行、或失败并说明原因
│   ├── patch-sync.test.mjs                    补丁与定义真源一致、结构符合「无删除按钮」
│   ├── client-patch.test.mjs                  客户端补丁注入的规则
│   ├── verify-reasoning.mjs                   思考文本取回的回归测试
│   └── fixtures/
│       └── stream-reasoning.sse               实测抓取的真实流
│
└── docs/                                      技术文档
    ├── plugin-parity-assessment.md            与其他 provider 插件的使用方式差异评估
    ├── feasibility-assessment.md              可行性评估与线格式差异矩阵
    ├── implementation-plan.md                 实施计划与检查点结论
    ├── live-verification.md                   真机联调实测记录
    ├── reference-commandcode-provider.md      第三方 provider 插件参考实现分析
    └── market-submission.md                   插件市场投稿说明
```

> 插件壳只做四件事：**分发**（npm 包，可被插件市场安装）、**声明**（provider 定义写在
> 自带的补丁层里，profile 只读不改）、**版本闸门**（版本不匹配直接拒装）、
> **看护**（启动时校验定义、判定 id 归属，不该继续就让插件启动失败并说明原因）。
> 实际的传输、思考字段解析、多轮回传、用量计量仍全部由 DSH 自带的 `llm-pi-ai` 承担。

---

## 常用命令

```bash
# 全量测试（合并语义、所有权判定、启动看护、补丁一致性、思考字段取回）
pnpm test

# 只跑启动看护（四种所有权结局）与补丁一致性
pnpm test:guard
pnpm test:patch

# 校验 provider 定义：结构校验 + llm-pi-ai 真实 schema 校验
# 这是判断「字段在当前 DSH 版本里是否仍然有效」的那道校验，建议升级 DSH 后跑一次
pnpm validate

# 改完 provider/radeon-cloud.yml 后，把定义同步进补丁的生成区块
pnpm sync:patch

# 补救路径：把定义按键合并进 profile（冲突时拒绝覆盖，--force 才覆盖）
pnpm install:profile:dry

# 重新实测某个模型支持的思考档位
pnpm probe --only Qwen3.8-27B

# 拉取实时模型目录
./scripts/radeon-api.sh GET /models
```

---

## 可用模型

> 采集日期：**2026-10-04**

| 模型 | 上下文 | 图片 | 思考档位 |
| --- | --- | --- | --- |
| DeepSeek-V4.1-Flash | 1,048,576 | ✅ | off/minimal/low/medium/high/xhigh/max |
| DeepSeek-V4-Flash | 1,048,576 | ❌ | off/minimal/low/medium/high/xhigh/max |
| DeepSeek-V4-Flash-Vision-Exp | 1,048,576 | ✅ | off/minimal/low/medium/high/xhigh/max |
| MiMo-V2.6-Flash | 1,048,576 | ✅ | off/minimal/low/medium/high/xhigh/max |
| Qwen3.8-27B | 262,144 | ✅ | off/low/medium/xhigh |
| Qwen3.8-Flash-Next | 262,144 | ✅ | off/low/medium/xhigh |
| GLM-5.3-Flash | 262,144 | ❌ | low/medium/high |
| MiniCPM5-2B | 131,072 | ❌ | （不返回分离思考，故不提供档位） |

`off` 表示发送 `reasoning_effort: "none"` 关闭思考。
**GLM-5.3-Flash 与 Qwen3.8-27B 不支持 `none`**，因此没有关闭档位；其中 Qwen 系在「不传档位」时也会思考（AMD 服务端行为）。

> **档位表不在 API 里**（`GET /v1/models` 不返回该信息），只能实测。模型上下架会导致此表过期，
> 请用 `pnpm probe` 复测后再更新 `provider/radeon-cloud.yml`。
>
> `MinerU2.5-Pro` 未收录——它走独立的 `/v1/ocr` 端点，不是对话模型。

---

## 已知限制

### 1. 思考与答案共用同一个 token 预算（最重要）

Radeon 的 `max_tokens` 同时约束思考和最终回答。预算不足时**回答会变成空字符串**：

| 配置 | finish_reason | content | reasoning |
| --- | --- | --- | --- |
| `effort=low`, `max_tokens=16` | `length` | **空** | 84 字符 |
| `effort=low`, `max_tokens=120` | `length` | **空** | 584 字符 |
| `effort=low`, `max_tokens=400` | `length` | **空** | 1717 字符 |
| `effort=none`, `max_tokens=64` | `length` | 330 字符 ✅ | 0 |

**应对**：配置里 `defaultMaxTokens` 已设为 `32768`（pi-ai 默认值），给思考留足余量。
`max_tokens` 是上限而非计费项，实际按产出计费，调高不增加成本。

若仍偶发空回答，把该会话的思考档位调低，或临时改用 `off`。

### 2. `stop`（停止序列）不可用

Radeon 网关按白名单重建请求体，`stop` 不在白名单内，会被**静默丢弃**。
DSH 的 `dsh-llm-pi-ai` 会对此抛 `UNSUPPORTED_OPTION`，属于响亮失败，比静默失效好。

### 3. 部分模型不接受 `developer` 角色

DSH 默认对 OpenAI 兼容端点使用 `developer` 承载系统提示词，8 个模型中有 5 个会直接报
`unknown role: developer`。已通过 `compat.supportsDeveloperRole: false` 关闭。

### 4. 档位被拒是硬失败

非法档位返回 `400`（Qwen 系）或 `422`（GLM 系），不会自动降级。
配置里的档位表来自实测，如新增模型请先复测。

### 5. 上游偶发故障

实测中出现过 `504 Gateway Timeout`，被包装为 HTTP `500` + `code: upstream_error`。
DSH 将其归为可重试的 `SERVER`。偶发，重试即可。

### 6. 与用户自有 provider 共存

provider 定义由插件的 bundle 层声明，插件**只读 profile、不写 profile**。
DSH 的非 insert 补丁是整体替换，因此你自己写的 `llm-pi-ai` config 会整份盖掉插件层的定义：
插件启动时会判定这件事，响亮失败并给出处置，而不是让 provider 无声消失
（判据见[归属与删除](#归属与删除)）。

想与自有 provider 共存，就用补救命令做按键合并：

```bash
# 在插件仓库里
pnpm install:profile:dry   # 演练：打印改动与被保留的其它 provider
pnpm install:profile       # 写入（自动备份，断言其余条目与同级键逐字未变）

# 只装了插件、没有克隆仓库时，脚本在包里；启动失败信息会直接打印完整命令
node ~/.dsh/profiles/<profile>/node_modules/@zhz8888/dsh-radeon-cloud-patcher/scripts/apply-to-profile.mjs \
  ~/.dsh/profiles/<profile>/cordis.patch.yml
```

输出示例：

```
【写入】 ~/.dsh/profiles/desktop/cordis.patch.yml
  新增 providers.radeon-cloud（8 个模型）
  保留的其它 provider：my-corp-proxy, another-one
  顶层条目 12 个，增减 0 个
```

合并粒度是键：只新增或替换 `providers.radeon-cloud` 这一个键，你添加的其它 provider、
你写的注释、缩进风格与键序都原样保留（文本级编辑，不重新序列化你的文件）。
写入前会断言：除 `radeon-cloud` 外的同级 provider 键集合一致、`llm-pi-ai` 之外的顶层条目
逐字符未变，任一不成立即中止且不落盘；已存在不一致的同 id 定义时**拒绝覆盖**并打印第一处
差异，确认要覆盖再加 `--force`。

另有一处要注意：**不要另写一条 `llm-pi-ai` 的非 insert 补丁**去改该行的其它字段——
那会整体替换这一行，把 `providers` 一并带走。要改就只改你需要的那一个键。

---

## 兼容性

- 目标 DSH 版本：`>=0.2.0-rc.1`，**无上界**（三处声明一致，见[版本闸门](#版本闸门)）
- 模型目录与档位表采集日期：**2026-10-04**
- 收录的模型当前均为 `stability: experimental`
- 仅覆盖 Public Free Model APIs（共享端点）；独占端点的基础 URL 每次实例重启都会变化，不在本项目范围内
- 客户端补丁依赖 DSH 模型设置页的 DOM 结构（`aria-label` 中的 provider 路由名 + `rowTag` 类名片段）。
  DSH 改版后它会静默失效——「自定义」标签重新出现，功能不受影响

---

## 许可证

本项目以 [MIT 许可证](LICENSE) 开源。

MIT 许可证允许你自由使用、复制、修改、合并、发布、分发、再许可及销售本项目的副本，
唯一义务是在所有副本或实质性部分中保留版权声明与许可声明。

本软件按「原样」提供，不附带任何形式的担保，包括但不限于对适销性、特定用途适用性
及不侵权的担保；作者或版权持有人不对使用本软件产生的任何损害承担责任。