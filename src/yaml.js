/**
 * 定位 YAML 解析器。
 *
 * 本插件以 peerDependency 方式依赖 yaml：装进 DSH profile 后它由宿主提供，
 * 可直接解析。但在以下场景下按包名解析会失败，此时依次回退到显式路径：
 *   - 直接在本仓库里运行脚本与测试（仓库自身没有安装依赖）；
 *   - 某些裁剪过的宿主环境没有把 yaml 提升到包名可解析的位置。
 *
 * 回退路径可用环境变量 DSH_MODULES 覆盖，指向一个 node_modules 目录。
 */
import { createRequire } from 'node:module'

/** 依次尝试的 yaml 模块位置。 */
const CANDIDATES = [
  'yaml',
  process.env.DSH_MODULES ? `${process.env.DSH_MODULES}/yaml` : undefined,
  '/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/yaml',
].filter(Boolean)

/**
 * 解析出一个可用的 yaml 模块。
 *
 * @returns {{ parse: (text: string) => any, stringify: (value: any) => string }} yaml 模块
 * @throws {Error} 所有候选位置都不可用时抛出
 */
export function loadYaml() {
  const require = createRequire(import.meta.url)
  for (const candidate of CANDIDATES) {
    try {
      return require(candidate)
    } catch {
      // 换下一个候选位置
    }
  }
  throw new Error(
    'dsh-radeon-cloud-patcher: 找不到 yaml 模块。请确认本插件已装进 DSH profile，' +
    '或用环境变量 DSH_MODULES 指向一个包含 yaml 的 node_modules 目录。',
  )
}