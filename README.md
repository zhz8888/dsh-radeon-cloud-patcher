# Radeon Cloud Patcher for DeepSeek Harness

把 [AMD Radeon Cloud](https://amd-aim.github.io/radeon-cloud-docs/) 接入 DeepSeek Harness 的模型选择器，**完整支持模型思考（reasoning）功能**。

包名 `@zhz8888/dsh-radeon-cloud-patcher`。它把 provider 定义**按键合并**进你的 profile，由 DSH 自带的
`dsh-llm-pi-ai`（通用 OpenAI 兼容 provider）承载——**不修改 DSH 本体，不需要自研适配器**。

> 之所以叫 patcher 而不是 provider，是因为本项目**不承载任何 provider 逻辑**。
> DSH 的补丁语义是整体替换，直接用补丁改写 `llm-pi-ai` 的 config 会把你自己添加的
> provider 一并抹掉；因此写入被降到键的粒度，只动 `providers.radeon-cloud`。

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![target: DSH](https://img.shields.io/badge/DSH-0.2.x-blue?label=target)
![Radeon Cloud](https://img.shields.io/badge/API-Radeon%20Cloud-orange)

---

## 目录

- [功能](#功能)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
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
| DSH | `0.2.0-rc.2` | 桌面版内置的 `dsh-llm-pi-ai` 需为该版本 |
| Node.js | `^22.19.0` 或 `>=24.0.0` | 仅运行 `scripts/` 与 `test/` 下的脚本时需要 |
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

### 2. 写入 provider 定义

插件只负责分发与看护；provider 定义要落到 profile 的 `cordis.patch.yml` 里，
由 `llm-pi-ai` 承载。这一步是**按键合并**，不是整体替换：

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
> 详见[已知限制](#6-与用户自有-provider-共存)。

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

## 项目结构

```
dsh-radeon-cloud-patcher/
├── README.md                                  本文件
├── LICENSE                                    MIT 许可证
├── package.json                               插件包清单（版本闸门、导出、脚本）
├── cordis.plugin.patch.yml                    bundle 补丁：只插入本插件行
├── .gitignore
│
├── provider/                                  配置本体
│   └── radeon-cloud.yml                       provider 定义的唯一真源
│
├── src/                                       插件实现（薄壳，不含 provider 逻辑）
│   ├── index.js                               插件入口：启动时校验定义，失效则响亮失败
│   ├── merge.js                               键级合并的纯函数实现
│   ├── patch-text.js                          文本级合并，保留用户注释与格式
│   ├── validate.js                            定义的结构校验
│   └── yaml.js                                定位 YAML 解析器
│
├── scripts/                                   运维与校验工具
│   ├── apply-to-profile.mjs                   按键合并进 profile（带断言与自动备份）
│   ├── validate-config.mjs                    用 llm-pi-ai 真实 schema 校验定义
│   ├── probe-efforts.mjs                      实测逐模型 reasoning_effort 档位表
│   └── radeon-api.sh                          API 调用助手（密钥取自环境变量或凭据存储）
│
├── test/                                      离线测试
│   ├── merge.test.mjs                         合并语义与幂等性
│   ├── patch-text.test.mjs                    不破坏用户 provider 与注释
│   ├── verify-reasoning.mjs                   思考文本取回的回归测试
│   └── fixtures/
│       └── stream-reasoning.sse               实测抓取的真实流
│
└── docs/                                      技术文档
    ├── plugin-parity-assessment.md            与其他 provider 插件的使用方式差异评估
    ├── feasibility-assessment.md              可行性评估与线格式差异矩阵
    ├── implementation-plan.md                 实施计划与检查点结论
    ├── live-verification.md                   真机联调实测记录
    └── reference-commandcode-provider.md      第三方 provider 插件参考实现分析
```

> 插件壳只做四件事：**分发**（npm 包，可被插件市场安装）、**版本闸门**
> （版本不匹配直接拒装）、**写入**（按键合并进 profile，可演练、带断言、自动备份）、
> **看护**（启动时校验定义，失效则让插件启动失败）。
> 实际的传输、思考字段解析、多轮回传、用量计量仍全部由 DSH 自带的
> `llm-pi-ai` 承担。

---

## 常用命令

```bash
# 全量测试（合并语义、冲突防护、思考字段取回）
pnpm test

# 校验 provider 定义：结构校验 + llm-pi-ai 真实 schema 校验
# 这是判断「字段在当前 DSH 版本里是否仍然有效」的那道校验，建议升级 DSH 后跑一次
pnpm validate

# 演练合并进 profile，打印改动与被保留的其它 provider
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

provider 定义写入 profile 时采用**键级合并**：只新增或替换 `providers.radeon-cloud`
这一个键，同一命名空间下你自己添加的 provider 原样保留。

合并采用文本级编辑，不会重新序列化你的补丁文件，因此你写的注释、缩进风格与
键序也不会被改动。写入前会断言：除 `radeon-cloud` 外的同级 provider 键集合一致、
`llm-pi-ai` 之外的顶层条目逐字符未变，任一不成立即中止且不落盘。

需要注意的仍有一处：**不要另写一条 `llm-pi-ai` 的非 insert 补丁**去覆盖 config——
那会整体替换该行，绕过上面的按键合并。若要用补丁改 `llm-pi-ai` 的其它字段，
请只改你需要的那个字段，不要整块替换 `config`。

---

## 兼容性

- 目标 DSH 版本：`0.2.0-rc.2`
- 模型目录与档位表采集日期：**2026-10-04**
- 收录的模型当前均为 `stability: experimental`
- 仅覆盖 Public Free Model APIs（共享端点）；独占端点的基础 URL 每次实例重启都会变化，不在本项目范围内

---

## 许可证

本项目以 [MIT 许可证](LICENSE) 开源。

MIT 许可证允许你自由使用、复制、修改、合并、发布、分发、再许可及销售本项目的副本，
唯一义务是在所有副本或实质性部分中保留版权声明与许可声明。

本软件按「原样」提供，不附带任何形式的担保，包括但不限于对适销性、特定用途适用性
及不侵权的担保；作者或版权持有人不对使用本软件产生的任何损害承担责任。