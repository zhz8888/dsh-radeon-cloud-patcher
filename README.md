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

## 目录

- [功能](#功能)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
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
| DSH | `0.2.x`（含预发布） | 由 `peerDependencies` 声明范围，版本不匹配会被安装器拒绝 |
| Node.js | `>=22` | 与 `package.json` 的 `engines.node` 一致；仅运行 `scripts/` 与 `test/` 下的脚本时需要 |
| bash | 任意 | 仅 `scripts/radeon-api.sh` 需要 |
| 操作系统 | macOS | `scripts/validate-config.mjs` 按 DSH 桌面版应用包的绝对路径加载校验用的 schema，路径为 `/Applications/DSH Desktop.app/Contents/Resources/app/node_modules`。其余脚本与系统无关 |

> 配置文件本身（`provider/radeon-cloud.yml`）是纯 YAML，不依赖上述任何运行时。

---

## 快速开始

### 1. 安装插件

推荐用 DSH 的插件管理器安装（插件 → 添加插件，输入包名或本地目录路径）：

```bash
dsh plugin --profile <profile> add @zhz8888/dsh-radeon-cloud-patcher
```

也可以直接编辑 profile 的 `package.json`，在 `dsh.profile.bundles` 中加入本包名，
再执行 `dsh plugin --profile <profile> install`。

> 本包通过 `peerDependencies` 里的 `@deepseek-ai/dsh-*` 范围声明支持 DSH `0.2.x`
> （含 `0.2.0-rc.1` 及之后的全部预发布与正式版）。DSH 安装器会把每个
> `@deepseek-ai/dsh-*` peer 与当前运行时版本比对，**不匹配则直接拒绝安装**，
> 不会出现「装上了但思考功能失效」的情况。
>
> 范围写成 `>=0.2.0-rc.1 <0.2.1-0 || >=0.2.1-0 <0.3.0-0` 的显式双分支，
> 是为了同时满足 DSH 的闸门判定与 npm/pnpm 的 peer 解析：node-semver 只有当范围里
> 某个比较符与该版本的 `major.minor.patch` 元组完全一致、且自身也带预发布标签时，
> 才会放行预发布版本。单写 `>=0.2.0-rc.1 <0.3.0-0` 会把 `0.2.1-alpha.1` 这类
> **不同元组**的预发布静默排除。

### 2. provider 定义随插件生效

定义由插件的补丁层声明，装完插件重启 DSH，即可在「设置 → 模型」看到 Radeon Cloud 行——
**不需要任何额外步骤**。

启动时插件会判定这个 id 现在由谁说了算，四种结局各有明确处置：

| 情况 | 结果 |
| --- | --- |
| `llm-pi-ai` 的 config 没被别人碰过 | 插件层的定义生效，正常启动 |
| profile 里有一份**与本插件一致**的同 id 声明 | 放行，并提示它会在卸载后残留（常见于你在设置页保存过一次、被物化出的副本） |
| profile 里有一份**与之不一致**的同 id 声明 | **启动失败**，报「provider id 冲突」并指名第一处差异 |
| profile 给 `llm-pi-ai` 写了 config 却没有本 provider | **启动失败**，报「定义未生效」并给出下面的合并命令 |

原因：DSH 的非 insert 补丁是**整体替换**。`llm-pi-ai` 的 config 只要在 profile 里出现过，
它就会整份盖掉插件层的定义。想与你自己添加的 provider 共存，就用按键合并把定义落进 profile：

```bash
# 先演练：会打印本次改动，以及被保留的其它 provider
pnpm install:profile:dry

# 确认无误后写入（自动备份，断言其余条目与同级键逐字未变）
pnpm install:profile
```

输出示例：

```
【写入】 ~/.dsh/profiles/desktop/cordis.patch.yml
  新增 providers.radeon-cloud（8 个模型）
  保留的其它 provider：my-corp-proxy, another-one
  顶层条目 12 个，增减 0 个
```

> **合并粒度是键**：只新增或替换 `providers.radeon-cloud` 这一个键。
> 你在 `llm-pi-ai` 下自行添加的 provider、你在补丁文件里写的注释、缩进风格与
> 键序，都原样保留。合并采用文本级编辑，不会重新序列化你的文件。
>
> 已经存在同 id 定义且与本插件不一致时，这条命令**拒绝覆盖**并打印第一处差异，
> 确认要覆盖再加 `--force`——id 冲突要响亮，不要悄悄接管。
>
> 详见[归属与删除](#归属与删除)。

### 3. 配置 API 密钥

密钥有两种提供方式，任选其一。

**方式一：在 DSH 的模型设置页录入（推荐给日常使用）**

重启 DSH，在「设置 → 模型」找到 Radeon Cloud 行，填入密钥。DSH 会把它写进本机凭据存储
`~/.dsh/.credentials.yaml` 的 `RADEON_CLOUD_API_KEY` 条目，明文不落配置、不回显。
此后 `scripts/` 下的脚本会自动读取该条目，无需再做任何设置。

**方式二：环境变量（适合未安装 DSH 或不想在本机留存凭据文件的使用者）**

```bash
export RADEON_API_KEY=rc-你的密钥
```

单次调用也可以只对这一条命令生效：

```bash
RADEON_API_KEY=rc-你的密钥 ./scripts/radeon-api.sh GET /models
```

两种方式共存时，脚本按「环境变量优先、凭据文件次之」取用密钥；
两者都没有时直接报错并提示上述做法。

### 4. 相关环境变量

| 变量 | 作用 | 默认值 |
| --- | --- | --- |
| `RADEON_API_KEY` | API 密钥字面值，优先级高于凭据文件 | 无 |
| `RADEON_KEY_REF` | 从凭据文件读取时使用的条目名 | `RADEON_CLOUD_API_KEY` |
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
pnpm install:profile:dry   # 演练：打印改动与被保留的其它 provider
pnpm install:profile       # 写入（自动备份，断言其余条目与同级键逐字未变）
```

合并粒度是键：只新增或替换 `providers.radeon-cloud` 这一个键，你添加的其它 provider、
你写的注释、缩进风格与键序都原样保留（文本级编辑，不重新序列化你的文件）。
写入前会断言：除 `radeon-cloud` 外的同级 provider 键集合一致、`llm-pi-ai` 之外的顶层条目
逐字符未变，任一不成立即中止且不落盘；已存在不一致的同 id 定义时**拒绝覆盖**，
需要 `--force` 才覆盖。

另有一处要注意：**不要另写一条 `llm-pi-ai` 的非 insert 补丁**去改该行的其它字段——
那会整体替换这一行，把 `providers` 一并带走。要改就只改你需要的那一个键。

---

## 兼容性

- 目标 DSH 版本：`0.2.x`（范围由 `peerDependencies` 声明）
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