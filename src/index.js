/**
 * @zhz8888/dsh-radeon-cloud-patcher —— 把 AMD Radeon Cloud 的 provider 定义交给 DSH 自带的
 * llm-pi-ai 承载，并在启动时校验定义、判定这个 id 现在由谁说了算。
 *
 * 职责边界：这个插件**不接管任何 provider 逻辑**。传输、思考字段解析、多轮回传、
 * 用量计量全部仍由 llm-pi-ai 承担。本插件只做四件事：
 *
 *   1. 分发：作为可被插件市场安装的 npm 包而存在；
 *   2. 声明：provider 定义写在本插件自带的 bundle 层
 *      （cordis.plugin.patch.yml 的生成区块，真源是 provider/radeon-cloud.yml）。
 *      这样设置页永远不会渲染「删除」按钮——它的判据要求该 provider 路径只出现在
 *      用户层——而卸载插件就等于删除供应商，profile 里不留副本；
 *   3. 版本闸门：peerDependencies 里的 @deepseek-ai/dsh-* 范围声明目标 DSH 版本，
 *      DSH 安装器据此比对运行时版本，不匹配则直接拒绝安装
 *      （engines.dsh 与 dsh.compatibility 是同样的声明，但闸门判定只读 peer）；
 *   4. 看护：启动时校验定义（结构 + llm-pi-ai 的真实 schema），并判定之后各层
 *      有没有把插件层的定义盖掉、或者用户自己声明了一份同 id 的 provider。
 *      任一情况都让插件启动失败并给出可执行的处置，而不是让 provider 无声消失。
 *
 * 与旧写法的关键差别：插件**不再改写 profile**。定义只在插件层，profile 是用户的
 * 文件，本插件对它只读。用户自己的 llm-pi-ai 配置若把插件层整份盖掉，插件会响亮
 * 失败并提示用 scripts/apply-to-profile.mjs 做按键合并这条补救路径。
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadYaml } from './yaml.js'
import { PROVIDER_KEY, TARGET_ENTRY_ID } from './merge.js'
import { validateProfile, describeIssues } from './validate.js'
import { classifyOwnership, OWNERSHIP } from './ownership.js'

export { PROVIDER_KEY, TARGET_ENTRY_ID }

/** 插件注册名。 */
export const name = '@zhz8888/dsh-radeon-cloud-patcher'

/**
 * 需要的上下文服务。
 *
 * llm 用于收尾核验路由是否真的注册上了；profileContext 通过 ctx.get 可选获取，
 * 用于定位 profile / home 补丁（拿不到时只跳过所有权判定并告警，不影响加载）。
 */
export const inject = ['llm']

/** 本插件文件所在目录。 */
const HERE = path.dirname(fileURLToPath(import.meta.url))
/** provider 定义文件的绝对路径。 */
export const PROFILE_FILE = path.join(HERE, '..', 'provider', 'radeon-cloud.yml')
/** 补救脚本的绝对路径，用于错误信息里给出可直接执行的命令。 */
const REPAIR_SCRIPT = path.join(HERE, '..', 'scripts', 'apply-to-profile.mjs')
/** home 补丁的文件名（DSH 的约定，与 profile 补丁同名）。 */
const HOME_PATCH_NAME = 'cordis.patch.yml'

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
    '请核对目标 DSH 版本是否落在 package.json 的 peerDependencies 声明范围内',
    '（engines.dsh 是同样的声明，但 DSH 的安装闸门只读 peerDependencies）。',
    '',
    'provider 定义由本插件自带的补丁层提供，真源是 provider/radeon-cloud.yml。',
    '改完真源后请执行 pnpm sync:patch 把定义同步进 cordis.plugin.patch.yml。',
  ].join('\n')
}

/**
 * 读一份补丁文件里的补丁行。
 *
 * 读不动时返回 null 并告警：补丁文件由 DSH 自己维护，它坏了 DSH 会先失败，
 * 本插件不必再抛一次错、把真正的原因埋在第二条信息里。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文（用于告警）
 * @param {string} file 补丁文件绝对路径
 * @returns {ReadonlyArray<Record<string, any>>|null} 补丁行数组；文件不存在或读不动时返回 null
 */
function readPatchRows(ctx, file) {
  if (!existsSync(file)) return null
  const { parse } = loadYaml()
  try {
    const parsed = parse(readFileSync(file, 'utf8'))
    return Array.isArray(parsed) ? parsed : null
  } catch (error) {
    ctx.logger.warn(`dsh-radeon-cloud: 读不出补丁 ${file}（${error.message}），已跳过所有权判定。`)
    return null
  }
}

/**
 * 收集 llm-pi-ai 之后应用的全部补丁层，顺序即应用顺序。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文
 * @returns {Array<{ label: string, rows: ReadonlyArray<Record<string, any>> }>|null}
 *   补丁层列表；定位不到 profile 时返回 null（调用方据此跳过判定）
 */
function ownershipLayers(ctx) {
  const profileContext = ctx.get('profileContext')
  if (profileContext === undefined) return null
  const layers = []
  if (typeof profileContext.patchPath === 'string') {
    const rows = readPatchRows(ctx, profileContext.patchPath)
    if (rows !== null) layers.push({ label: `profile 补丁 ${profileContext.patchPath}`, rows })
  }
  if (typeof profileContext.home === 'string') {
    const homePatch = path.join(profileContext.home, HOME_PATCH_NAME)
    const rows = readPatchRows(ctx, homePatch)
    if (rows !== null) layers.push({ label: `home 补丁 ${homePatch}`, rows })
  }
  if (Array.isArray(profileContext.overlays) && profileContext.overlays.length > 0) {
    layers.push({ label: '命令行 --patch overlay', rows: profileContext.overlays })
  }
  return layers
}

/**
 * 判定 provider 定义现在由谁说了算，并在不该继续的时候抛错。
 *
 * 抛错即让插件启动失败：DSH 会把条目 id、包名与这段原因一起呈现出来。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文
 * @param {Record<string, any>} profile 本插件的 provider 定义
 * @param {string|null} patchPath profile 补丁路径，用于给出可执行的补救命令
 * @returns {string} 判定结果（OWNERSHIP 取值），供调用方决定日志措辞
 */
function assertOwnership(ctx, profile, patchPath) {
  const layers = ownershipLayers(ctx)
  if (layers === null) {
    ctx.logger.warn('dsh-radeon-cloud: 本次运行拿不到 profileContext，已跳过所有权判定（定义本身仍然生效）。')
    return OWNERSHIP.dynamic
  }
  const verdict = classifyOwnership({ ours: profile, layers })
  if (verdict.kind === OWNERSHIP.conflict) {
    throw new Error([
      `dsh-radeon-cloud: provider id 冲突（${PROVIDER_KEY}），已中止加载以免静默接管你的定义。`,
      `  ${verdict.layer} 里已经声明了 providers.${PROVIDER_KEY}，但它与本插件定义不一致。`,
      `  第一处差异：${verdict.difference ?? '(未知)'}`,
      '',
      '处置（任选其一）：',
      `  · 交给本插件管理：删掉那一层里 ${TARGET_ENTRY_ID} 下的 providers.${PROVIDER_KEY}，重启 DSH；`,
      '  · 自己维护：卸载本插件，插件层的定义与这段校验会一并消失。',
    ].join('\n'))
  }
  if (verdict.kind === OWNERSHIP.shadowed) {
    throw new Error([
      'dsh-radeon-cloud: provider 定义未生效，已中止加载。',
      `  ${verdict.layer} 给 ${TARGET_ENTRY_ID} 写了一份 config，而 DSH 的补丁语义是整份替换，`,
      `  插件层声明的 providers.${PROVIDER_KEY} 因此被整份盖掉。`,
      '',
      '处置：执行下面这条命令，把定义按键合并进 profile 里那份 config',
      '（保留你已添加的其它 provider 与注释），然后重启 DSH：',
      `  node "${REPAIR_SCRIPT}"${patchPath === null ? '' : ` "${patchPath}"`}`,
      '若你其实想自己维护这个 provider，卸载本插件即可。',
    ].join('\n'))
  }
  if (verdict.kind === OWNERSHIP.materialized) {
    ctx.logger.info(
      `dsh-radeon-cloud: profile 里存在一份与本插件一致的 providers.${PROVIDER_KEY} 声明（${verdict.layer}），` +
      '按设置页保存出的副本处理。提醒：它在卸载插件后仍会生效；要让插件独占管理，' +
      `删掉 profile 补丁里 ${TARGET_ENTRY_ID} 下的 providers.${PROVIDER_KEY} 即可。`,
    )
    return verdict.kind
  }
  if (verdict.kind === OWNERSHIP.dynamic) {
    ctx.logger.warn(`dsh-radeon-cloud: ${verdict.layer} 的 ${TARGET_ENTRY_ID} config 是 !!js 表达式，无法静态判定定义是否生效，已跳过所有权判定。`)
  }
  return verdict.kind
}

/**
 * 用 llm-pi-ai 的真实 schema 校验定义。
 *
 * 这是唯一能发现「上游把字段改了名」的运行时手段。拿不到 schema 时不阻断加载——
 * 那种环境下插件仍然工作，只是退化为结构校验，故只告警。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文
 * @param {Record<string, any>} profile provider 定义
 */
async function assertSchemaAccepts(ctx, profile) {
  let Config
  try {
    ;({ Config } = await import('@deepseek-ai/dsh-llm-pi-ai'))
  } catch (error) {
    ctx.logger.warn(
      'dsh-radeon-cloud: 拿不到 llm-pi-ai 的 Config schema，已跳过字段级校验（结构校验仍然通过）。' +
      `原因：${error.message}`,
    )
    return
  }
  const result = Config['~standard'].validate({ providers: { [PROVIDER_KEY]: profile } })
  if (result.issues === undefined) return
  const problems = result.issues.map((issue) => `${issue.path?.join('.') ?? '(根)'}：${issue.message}`)
  throw new Error(
    `dsh-radeon-cloud: provider 定义未通过 ${TARGET_ENTRY_ID} 的 schema 校验，已中止加载以免失效被忽略。\n${remediation(problems)}`,
  )
}

/**
 * 收尾核验：启动结束后路由是否真的注册上了。
 *
 * 上面的所有权判定只看得见 profile / home / 命令行 overlay 三层；万一还有别的层
 * 把定义盖掉，这里至少让日志里留下明确原因，而不是让模型选择器无声少一项。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文
 */
function watchRouteRegistration(ctx) {
  const loader = ctx.get('loader')
  if (typeof loader?.await !== 'function') return
  loader.await().then(() => {
    const routes = ctx.llm.listProviders().map((provider) => provider.id)
    if (routes.includes(PROVIDER_KEY)) return
    ctx.logger.error([
      `dsh-radeon-cloud: 启动完成，但 provider 路由 ${PROVIDER_KEY} 没有被注册，模型选择器里不会出现 Radeon Cloud。`,
      '  多半是某个我们读不到的层覆盖了 llm-pi-ai 的 config；',
      '  可用 dsh --profile <name> --dump-config 查看真正生效的那份配置。',
    ].join('\n'))
  }).catch(() => {
    // 关停过程中的等待失败与本插件无关，忽略。
  })
}

/**
 * 插件入口。
 *
 * 校验失败时抛出异常终止插件激活——DSH 会把失败条目、包名与原因一并呈现，
 * 这正是本插件存在的意义：让失效响亮，而不是让 provider 无声消失。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文
 */
export async function apply(ctx) {
  const profile = loadProfile()

  const problems = describeIssues(validateProfile(profile))
  if (problems.length > 0) {
    throw new Error(`dsh-radeon-cloud: provider 定义未通过校验，已中止加载以免失效被忽略。\n${remediation(problems)}`)
  }

  await assertSchemaAccepts(ctx, profile)

  const patchPath = ctx.get('profileContext')?.patchPath
  assertOwnership(ctx, profile, typeof patchPath === 'string' ? patchPath : null)

  const models = Array.isArray(profile.models) ? profile.models.length : 0
  ctx.logger.info(
    `dsh-radeon-cloud: provider 定义校验通过（${models} 个模型，端点 ${profile.baseURL}），` +
    `由本插件的补丁层声明，交由 ${TARGET_ENTRY_ID} 承载。`,
  )

  watchRouteRegistration(ctx)
}

export default { name, inject, apply }
