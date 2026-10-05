/**
 * dsh-radeon-cloud-patcher —— 把 AMD Radeon Cloud 的 provider 定义按**键**合并进
 * DSH profile，让它由 DSH 自带的 llm-pi-ai 承载；启动时校验该定义。
 *
 * 名字里的 patcher 指的就是这件事：DSH 的补丁语义是整体替换，直接用补丁改写
 * llm-pi-ai 的 config 会把用户在该命名空间下自行添加的 provider 一并抹掉。
 * 因此写入被降到键的粒度——只动 providers.radeon-cloud 这一个键。
 *
 * 职责边界：这个插件**不接管任何 provider 逻辑**。实际的传输、思考字段的
 * 解析、多轮回传、用量计量，全部仍由 llm-pi-ai 承担。本插件只做四件事：
 *
 *   1. 分发：作为可被插件市场安装的 npm 包而存在；
 *   2. 版本闸门：engines.dsh / dsh.compatibility 声明目标 DSH 版本，
 *      不匹配时 DSH 直接拒绝安装；
 *   3. 写入：把 provider 定义按键合并进 profile，写入前可演练、写入时断言
 *      其余条目与同级键逐字未变、失败自动备份；
 *   4. 看护：启动时校验 provider 定义，失效则让插件启动失败并给出
 *      可操作的诊断，而不是让思考功能悄无声息地坏掉。
 *
 * 写入为何不在启动时自动进行：provider 定义最终要落到 profile 的
 * cordis.patch.yml，而那正是用户自己维护的文件，插件在启动时写它存在与用户
 * 其它改动竞态的风险。因此写入是显式动作（pnpm install:profile），
 * 启动时只做只读校验。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadYaml } from './yaml.js'
import { PROVIDER_KEY, TARGET_ENTRY_ID } from './merge.js'
import { validateProfile, describeIssues } from './validate.js'

export { PROVIDER_KEY, TARGET_ENTRY_ID }

/** 插件注册名。 */
export const name = 'dsh-radeon-cloud-patcher'

/** 需要的上下文服务。llm 用于在插件停用时释放注册。 */
export const inject = ['llm']

/** 本插件文件所在目录。 */
const HERE = path.dirname(fileURLToPath(import.meta.url))
/** provider 定义文件的绝对路径。 */
export const PROFILE_FILE = path.join(HERE, '..', 'provider', 'radeon-cloud.yml')

/**
 * 读取并解析 provider 定义。
 *
 * @param {string} file 定义文件路径
 * @returns {Record<string, any>} 解析后的 provider 定义对象
 * @throws {Error} 文件缺失或 YAML 无法解析时抛出
 */
export function loadProfile(file = PROFILE_FILE) {
  const { parse } = loadYaml()
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    throw new Error(`dsh-radeon-cloud: 找不到 provider 定义文件 ${file}`)
  }
  let parsed
  try {
    parsed = parse(text)
  } catch (error) {
    throw new Error(`dsh-radeon-cloud: provider 定义不是合法 YAML（${file}）：${error.message}`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`dsh-radeon-cloud: provider 定义顶层必须是对象（${file}）`)
  }
  return parsed
}

/**
 * 生成一条可执行的补救指引。
 *
 * @param {string[]} problems 校验发现的问题
 * @returns {string} 多行指引文本
 */
function remediation(problems) {
  return [
    '排查步骤：',
    ...problems.map((p) => `  · ${p}`),
    '',
    '若上面是「未定义或已改名」一类的问题，说明本插件依赖的 llm-pi-ai 配置字段',
    '在当前 DSH 版本中已不存在或不叫这个名字。此时思考档位会静默失效，',
    '请核对目标 DSH 版本是否与 package.json 的 engines.dsh 一致。',
    '',
    `provider 定义缺失时，可执行：pnpm install:profile（写入前可先跑 pnpm install:profile:dry）`,
    `该命令会把定义按键合并进 profile 中 llm-pi-ai 的 providers.${PROVIDER_KEY}，`,
    '不会影响你在同一命名空间下自行添加的其它 provider。',
  ].join('\n')
}

/**
 * 插件入口。
 *
 * 校验失败时抛出异常终止插件激活——DSH 会把启动失败呈现给用户，
 * 这正是本插件存在的意义：让失效响亮，而不是让思考功能无声消失。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文
 */
export function apply(ctx) {
  let profile
  try {
    profile = loadProfile()
  } catch (error) {
    throw error
  }

  const problems = describeIssues(validateProfile(profile))
  if (problems.length > 0) {
    throw new Error(`dsh-radeon-cloud: provider 定义未通过校验，已中止加载以免失效被忽略。\n${remediation(problems)}`)
  }

  const models = Array.isArray(profile.models) ? profile.models.length : 0
  ctx.logger.info(
    `dsh-radeon-cloud: provider 定义校验通过（${models} 个模型，端点 ${profile.baseURL}），` +
    `将交由 ${TARGET_ENTRY_ID} 承载。若模型设置页未出现 Radeon Cloud 一行，` +
    '请执行 pnpm install:profile 把定义写入 profile。',
  )
}

export default { name, inject, apply }