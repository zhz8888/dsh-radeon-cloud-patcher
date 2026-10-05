#!/usr/bin/env node
/**
 * 用 llm-pi-ai 真实的 Config schema 校验 provider 定义。
 *
 * 这是「字段在当前 DSH 版本里是否仍然有效」的那道校验——插件运行时拿不到这个
 * schema（DSH 的包在 profile 的 node_modules 里不可解析），所以只能在这里做。
 * 建议接入 CI，或在升级 DSH 之后手工跑一次。
 *
 * 除了 schema 判定，还会跑一遍本项目自带的结构校验，并把每个模型声明的思考
 * 档位打印出来，另对若干易错项给出提醒。
 *
 * 用法: node scripts/validate-config.mjs
 */
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadProfile, PROVIDER_KEY } from '../src/index.js'
import { validateProfile } from '../src/validate.js'

/** 本脚本文件所在目录。 */
const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 仓库根目录。 */
const ROOT = path.resolve(HERE, '..')
/** 待校验的 provider 定义文件。 */
const PROFILE_FILE = path.join(ROOT, 'provider', 'radeon-cloud.yml')

// DSH 桌面版应用包内的 node_modules 绝对路径。脚本运行在仓库中而非 DSH 的
// 依赖树内，无法按包名解析，因此直接按绝对路径构造 file URL 导入。
const DSH_MODULES = process.env.DSH_MODULES
  ?? '/Applications/DSH Desktop.app/Contents/Resources/app/node_modules'

/** 按 DSH 应用包内的路径导入一个模块。 */
const loadFromDsh = (spec) => import(pathToFileURL(path.join(DSH_MODULES, spec)).href)

/** 待校验的 provider 定义。 */
const profile = loadProfile(PROFILE_FILE)

// ── 第一道：结构校验（不依赖 DSH，任何环境都能跑）──
const structural = validateProfile(profile)
if (structural.length > 0) {
  console.error('✗ provider 定义未通过结构校验：\n')
  for (const issue of structural) console.error(`   ${issue.field}：${issue.message}`)
  process.exit(1)
}

// ── 第二道：真实 schema 校验（判断字段在当前 DSH 版本里是否仍然有效）──
let Config
try {
  ;({ Config } = await loadFromDsh('@deepseek-ai/dsh-llm-pi-ai/lib/index.js'))
} catch {
  console.error('✗ 找不到 llm-pi-ai 的 Config schema。')
  console.error(`   请确认 ${DSH_MODULES} 存在，或用环境变量 DSH_MODULES 指向它。`)
  process.exit(1)
}

// llm-pi-ai 的配置形状是 providers 这个字典，这里包一层再交给它校验。
// Standard Schema 的 validate 返回 { value } 或 { issues }，不会抛异常。
const result = Config['~standard'].validate({ providers: { [PROVIDER_KEY]: profile } })
if (result.issues) {
  console.error('✗ provider 定义未通过 llm-pi-ai 的 schema 校验：\n')
  for (const issue of result.issues) {
    console.error(`   ${issue.path?.join('.') ?? '(根)'}: ${issue.message}`)
  }
  process.exit(1)
}

console.log('✓ provider/radeon-cloud.yml 通过结构校验与 llm-pi-ai 的 schema 校验')
console.log(`  路由 ${PROVIDER_KEY} | 端点 ${profile.baseURL} | ${profile.models.length} 个模型`)
console.log(`  默认思考档位 ${profile.reasoning} | maxTokens 上限 ${profile.defaultMaxTokens}`)

/** 声明了思考档位的模型数量。 */
const withEfforts = profile.models.filter((m) => m.reasoningEfforts && m.reasoningEfforts !== false).length
console.log(`  ${withEfforts} 个模型声明了思考档位：\n`)
for (const m of profile.models) {
  /** 该模型在模型选择器中会显示的档位文本。 */
  const efforts = m.reasoningEfforts === false
    ? '（声明为非推理模型）'
    : m.reasoningEfforts
      ? Object.keys(m.reasoningEfforts).join('/')
      : '⚠ 未声明 reasoningEfforts —— 选择器不会出现档位控件'
  console.log(`    ${m.id.padEnd(30)} ${efforts}`)
}

if (profile.compat?.supportsDeveloperRole !== false) {
  console.error('\n⚠ compat.supportsDeveloperRole 未设为 false —— 多数模型会返回 400')
  process.exit(1)
}