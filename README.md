# Radeon Cloud Patcher for DeepSeek Harness

把 [AMD Radeon Cloud](https://amd-aim.github.io/radeon-cloud-docs/) 接入 DeepSeek Harness 的模型选择器，完整支持模型思考（reasoning）。

包名 `@zhz8888/dsh-radeon-cloud-patcher`。provider 定义由插件**自带的补丁层**声明，传输、思考字段解析、多轮回传与用量计量全部由 DSH 自带的 `dsh-llm-pi-ai` 承担——**不改 DSH 本体，不写你的 profile**。

由此带来三个直接后果：

- 设置页那一行**没有**「删除」按钮；
- **卸载插件 = 删除供应商**，profile 中不留副本；
- 想删供应商只能卸载插件。

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![target: DSH](https://img.shields.io/badge/DSH-0.2.x-blue?label=target)

## 快速上手

装好 DSH、手上有 Radeon Cloud 的 API 密钥（`rc-…`），三步即可，不需要编辑任何配置文件。

1. **装插件** —— 桌面版在左侧「插件」页添加 `@zhz8888/dsh-radeon-cloud-patcher`；命令行执行
   `dsh plugin --profile <profile> add @zhz8888/dsh-radeon-cloud-patcher`。
   插件列表里显示的条目名是 **Radeon Cloud**（中文界面「Radeon Cloud 提供方」），不是那串包名。
2. **重启 DSH** —— 定义在补丁层的 config 行里，运行中不生效；重启后即就位，没有其它后置步骤。
3. **填密钥** —— 左下角「账号菜单 → 设置 → 模型」→ **Radeon Cloud** 行 →「编辑」→ 粘贴密钥 →「保存」。

装好的三个现象同时成立：模型选择器里出现 Radeon 的模型；那一行右侧是**绿点**（悬停「API 密钥已配置」）；那一行**没有**「删除」按钮、也不带「自定义」标签。

**没生效怎么办** —— 插件不会静默消失：定义失效时它直接让启动失败并写明原因，逐条处置见[归属与删除](#归属与删除)。想核验真正生效的配置，用 `dsh --profile <profile> --dump-config`（`desktop` profile 例外，由桌面应用独占管理）。

## 安装

用 DSH 插件命令从 npm 安装本包：

```bash
dsh plugin --profile <profile> add @zhz8888/dsh-radeon-cloud-patcher
dsh plugin --profile <profile> remove @zhz8888/dsh-radeon-cloud-patcher   # 卸载
```

命令行参数会**原样转发**给 profile 目录里的 pnpm，因此换源、指定版本按 pnpm 语法写即可：

```bash
dsh plugin --profile <profile> add @zhz8888/dsh-radeon-cloud-patcher --registry https://registry.npmmirror.com
dsh plugin --profile <profile> add @zhz8888/dsh-radeon-cloud-patcher@<版本>
```

> 桌面版的 `desktop` profile 由应用独占管理，终端里执行 `dsh plugin --profile desktop …` 会被拒绝；改用应用内的插件页，或在应用右上角「打开 DSH 终端」里执行。
>
> 本包的 tarball 只有插件源码、定义与脚本，**没有安装期构建脚本**，不会碰到 pnpm 的 `allowBuilds` 授权那一步。

### 版本闸门

DSH 兼容范围 **`>=0.2.0-rc.1`，只有下界、没有上界**，三处声明逐字一致（`peerDependencies`、`engines.dsh`、`dsh.compatibility.dsh`）。DSH 安装器读的是 `peerDependencies`：运行时版本低于下界会被**直接拒绝安装**，不会出现「装上了但功能失效」。上界不写，意味着 DSH 升大版本不必重发插件，代价是失去「未来版本被挡住」这层保护——由插件启动时的响亮失败兜底。

> 预发布细节：`>=0.2.0-rc.1` 只覆盖 `0.2.0` 这一元组的预发布，`0.2.1-alpha.1` 这类新元组的预发布会卡在 pnpm 那一步（DSH 闸门带 `includePrerelease`，会放行）。真遇到时给该元组补一条范围分支，或加 `--config.strict-peer-dependencies=false`。

## 使用

### 1. 配置 API 密钥

密钥从 [AMD Radeon Cloud 文档](https://amd-aim.github.io/radeon-cloud-docs/) 的入口申请（本项目只覆盖 Public Free Model APIs 共享端点）。

- **设置页（推荐）**：「设置 → 模型」→ Radeon Cloud →「编辑」→ 粘贴 `rc-…` →「保存」。密钥写进本机凭据存储 `~/.dsh/.credentials.yaml` 的 `RADEON_CLOUD_API_KEY` 条目，明文不落配置文件、界面不回显。仓库脚本读的是同一个条目。
- **环境变量**（不落盘，适合临时试用与 CI）：`RADEON_CLOUD_API_KEY=rc-你的密钥 dsh --profile <profile>`。凭据服务按「进程环境 → 凭据存储 → `.env` → `$DSH_HOME/.env`」依次查找，环境变量优先级最高。

> **插件运行时**读的是 `RADEON_CLOUD_API_KEY`（定义里的 `apiKeyEnv`），**仓库脚本**用的是 `RADEON_API_KEY`，两者互不影响。

### 2. 选模型与思考档位

输入框下方的模型选择器里选 Radeon 的模型，再选「推理等级」就是思考档位（按模型逐个声明，见[可用模型](#可用模型)）。GLM-5.3-Flash 与 MiniCPM-V-4.7-1B 不接受 `none`，没有关闭档位；`MiniCPM5-2B` 非推理模型，不出现档位下拉。选了服务端不接受的档位是**硬失败**（400/422），不会静默降级。

### 3. 图片输入

支持图片：DeepSeek-V4.1-Flash、DeepSeek-V4-Flash-Vision-Exp、MiMo-V2.6-Flash、MiniCPM-V-4.7-1B、MiniCPM-V-4.7-35B-A3B、Qwen3.8-27B、Qwen3.8-Flash-Next。只收文本：DeepSeek-V4-Flash、GLM-5.3-Flash、MiniCPM5-2B。

### 4. 升级与卸载

```bash
dsh plugin --profile <profile> add @zhz8888/dsh-radeon-cloud-patcher@latest  # 升级
dsh plugin --profile <profile> remove @zhz8888/dsh-radeon-cloud-patcher      # 卸载 = 删除供应商
```

升级后重启即生效，不需要额外动作。例外：若你曾用 `pnpm install:profile` 把定义合并进 profile（见[归属与删除](#归属与删除)），那份副本会盖住插件层的新定义，升级后要么重跑一次，要么删掉副本让插件独占管理。

### 5. 仓库脚本的环境变量

只影响 `scripts/`（`radeon-api.sh`、`probe-efforts.mjs`），与插件运行时无关：

| 变量 | 作用 | 默认值 |
| --- | --- | --- |
| `RADEON_API_KEY` | 脚本用的密钥字面值，优先级高于凭据文件 | 无 |
| `RADEON_KEY_REF` | 从凭据文件读取时用的条目名 | `RADEON_CLOUD_API_KEY` |
| `RADEON_BASE` | 端点基础 URL，可指向独占端点 | `https://developer.amd.com.cn/radeon/api/v1` |
| `DSH_HOME` | DSH 数据目录，凭据文件据此定位 | `~/.dsh` |

> 密钥只存在于进程变量与 curl 请求头，不写盘、不打印；但 shell 历史仍会留下 `export RADEON_API_KEY=...`，请自行注意。

## 可用模型

> 采集日期：**2026-10-16**

| 模型 | 上下文 | 图片 | 思考档位 |
| --- | --- | --- | --- |
| DeepSeek-V4.1-Flash | 1,048,576 | ✅ | off/minimal/low/medium/high/xhigh/max |
| DeepSeek-V4-Flash | 1,048,576 | ❌ | off/minimal/low/medium/high/xhigh/max |
| DeepSeek-V4-Flash-Vision-Exp | 1,048,576 | ✅ | off/minimal/low/medium/high/xhigh/max |
| MiMo-V2.6-Flash | 1,048,576 | ✅ | off/minimal/low/medium/high/xhigh/max |
| MiniCPM-V-4.7-35B-A3B | 262,144 | ✅ | off/minimal/low/medium/high/xhigh/max |
| Qwen3.8-27B | 262,144 | ✅ | off/low/medium/xhigh |
| Qwen3.8-Flash-Next | 262,144 | ✅ | off/low/medium/xhigh |
| GLM-5.3-Flash | 262,144 | ❌ | low/medium/high |
| MiniCPM-V-4.7-1B | 262,144 | ✅ | low/medium/high |
| MiniCPM5-2B | 131,072 | ❌ | （不返回分离思考，故不提供档位） |

`off` 表示发送 `reasoning_effort: "none"` 关闭思考；Qwen 系靠 `none` 关闭，**不传档位时仍会思考**（AMD 服务端行为）。`MiniCPM-V-4.7-35B-A3B` 与 `MiniCPM-V-4.7-1B` 同属 MiniCPM 系但档位表不同——**不要按模型名的相近程度推断档位**。

> 档位表不在 API 里（`GET /v1/models` 不返回该信息），只能实测；模型上下架会让此表过期，用 `pnpm probe` 复测后再更新 `provider/radeon-cloud.yml`。`MinerU2.5-Pro` 未收录——它走独立的 `/v1/ocr` 端点，不是对话模型。

## 已知限制

1. **思考与回答共用同一个 token 预算**：Radeon 的 `max_tokens` 同时约束思考和回答，预算不足时**回答会变成空字符串**（实测 `effort=low`、`max_tokens` ≤ 400 时 `finish_reason=length` 而 content 全空）。配置里 `defaultMaxTokens` 已设为 `32768` 留足余量；`max_tokens` 是上限而非计费项，调高不增加成本。仍偶发空回答就调低该会话档位或临时改用 `off`。
2. **`stop` 不可用**：网关按白名单重建请求体，`stop` 被静默丢弃，`dsh-llm-pi-ai` 会抛 `UNSUPPORTED_OPTION`（响亮失败，比静默失效好）。
3. **部分模型不接受 `developer` 角色**：10 个模型中有 6 个拒绝（GLM-5.3-Flash、MiniCPM5-2B、MiniCPM-V-4.7-1B 报 422；Qwen 系两个与 MiniCPM-V-4.7-35B-A3B 报 400），已用 `compat.supportsDeveloperRole: false` 改走 `system`。
4. **非法档位是硬失败**（400/422），不会自动降级；档位表来自实测，新增模型请先复测。
5. **上游偶发故障**：出现过 `504` 被包装成 HTTP `500` + `code: upstream_error`，DSH 归为可重试的 `SERVER`，重试即可。

## 归属与删除

本插件要求 `radeon-cloud` 这个 id 由它独占：

- 设置页那一行**不会出现「删除」按钮**——DSH 只在「该 provider 存在于用户层、且不存在于 base 层」时渲染它，而定义写在插件的 bundle 层。
- **删除供应商 = 卸载插件**。若你曾用 `pnpm install:profile` 合并进 profile，那里会留下一份归你所有的副本（卸载后删除按钮会重新出现，可自行清理）。
- **「自定义」标签**：DSH 对任何不在内置模型目录里的 provider 硬编码了这个标记，配置层面无从去掉。随包带的极小客户端补丁（`client/client.js`）用一条 CSS 规则隐藏**本 provider 那一行**的标签；它依赖 DSH 的 DOM 结构与类名片段，DSH 改版后可能静默失效——标签重新出现，功能不受影响。

启动时插件会静态读 profile / home / 命令行 overlay 三层，判定这个 id 现在由谁说了算：

| 情况 | 结果 |
| --- | --- |
| 没人碰过 `llm-pi-ai` 的 config | 插件层定义生效，正常启动 |
| profile 里有一份**与本插件一致**的同 id 声明 | 放行，提示它会在卸载后残留（通常是设置页保存时物化出的副本） |
| profile 里有一份**不一致**的同 id 声明 | **启动失败**：报 id 冲突，并指名第一处差异字段 |
| profile 给 `llm-pi-ai` 写了 config 却没有本 provider | **启动失败**：报定义未生效，并打印可直接执行的合并命令 |
| config 是 `!!js` 表达式，或读不到 profile 目录 | 跳过判定并告警，以 `--dump-config` 为准 |

后两种是**失败 + 原因**，而不是静默接管或静默消失。要与自有 provider 共存，用补救命令按键合并：

```bash
pnpm install:profile:dry   # 演练：打印改动与被保留的其它 provider
pnpm install:profile       # 写入（自动备份，冲突时拒绝覆盖，--force 才覆盖）
```

只装了插件、没克隆仓库时，用包内脚本（启动失败信息会打印完整命令）：
`node ~/.dsh/profiles/<profile>/node_modules/@zhz8888/dsh-radeon-cloud-patcher/scripts/apply-to-profile.mjs ~/.dsh/profiles/<profile>/cordis.patch.yml`

合并粒度是键：只新增或替换 `providers.radeon-cloud`，你写的其它 provider、注释、缩进与键序原样保留（文本级编辑）。⚠️ **不要另写一条 `llm-pi-ai` 的非 insert 补丁**去改该行的其它字段——那会整体替换这一行，把 `providers` 一并带走。

## 兼容性

- 目标 DSH 版本：`>=0.2.0-rc.1`，无上界（三处声明一致）。
- 收录的模型当前均为 `stability: experimental`，上游接口行为可能变，档位失效时先复测。
- 仅覆盖 Public Free Model APIs（共享端点）；独占端点的基础 URL 每次实例重启都会变化，不在本项目范围内。
- 客户端补丁依赖 DSH 的 DOM 结构，改版后可能静默失效。

## 开发

零运行时依赖，源码只用 Node 内置模块；测试为自研 runner，无测试框架。运行 `scripts/` 与 `test/` 需要 Node `>=22`；`pnpm validate` 需本机有可用的 DSH 安装（macOS 下按桌面版应用包路径加载 schema，可用 `DSH_MODULES` 覆盖）。

```bash
pnpm test                 # 全量离线测试（清单不变式 / 插件元信息 / 合并语义 / 所有权判定 / 启动看护 / 补丁一致性 / 思考取回）
pnpm validate             # 用 llm-pi-ai 真实 schema 校验 provider 定义——升级 DSH 后必跑
pnpm sync:patch           # 改完 provider/radeon-cloud.yml 后同步进补丁，否则定义漂移
pnpm probe --only <模型>  # 重新实测思考档位
./scripts/radeon-api.sh GET /models   # 拉取实时模型目录
```

架构约束、补丁层设计理由与发版流程见 [`AGENTS.md`](AGENTS.md) 与 [`docs/market-submission.md`](docs/market-submission.md)。

## 许可证

本项目以 [MIT 许可证](https://github.com/zhz8888/dsh-radeon-cloud-patcher/blob/main/LICENSE) 开源。本软件按「原样」提供，不附带任何形式的担保。
