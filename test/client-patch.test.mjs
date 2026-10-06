#!/usr/bin/env node
/**
 * 客户端补丁的行为测试。
 *
 * 客户端补丁不是 ESM，而是 DSH 客户端模块的包装格式
 * （window.__ModuleLoader__.load），所以这里用 node:vm 在桩环境里把它跑起来：
 * 桩 __ModuleLoader__.load 收下注册信息，桩 document 收下注入的样式元素。
 * 验证它注册的 id 与包名一致、注入的规则只针对本 provider 的那一行、
 * 且卸载时会把样式清掉。
 *
 * 用法: node test/client-patch.test.mjs
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { PROVIDER_KEY } from '../src/merge.js'

/** 本测试文件所在目录。 */
const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 仓库根目录。 */
const ROOT = path.resolve(HERE, '..')
/** 客户端补丁源码。 */
const SOURCE = readFileSync(path.join(ROOT, 'client', 'client.js'), 'utf8')
/** 本插件的包声明。 */
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

/** 造一个桩环境并跑客户端补丁。 */
function run(source = SOURCE, withDocument = true) {
  const appended = []
  const created = []
  /** 桩样式元素。 */
  const makeElement = (tagName) => {
    const element = {
      tagName,
      id: '',
      textContent: '',
      removed: false,
      remove() {
        this.removed = true
      },
    }
    created.push(element)
    return element
  }
  const sandbox = {
    console,
    window: { __ModuleLoader__: { load: (registration) => { sandbox.registered = registration } } },
    registered: undefined,
  }
  if (withDocument) {
    sandbox.document = {
      getElementById: () => null,
      createElement: makeElement,
      head: { append: (element) => appended.push(element) },
    }
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  return { sandbox, appended, created }
}

/** 逐项检查结果。 */
const checks = []
/**
 * 登记一项检查。
 *
 * @param {string} label 检查项描述
 * @param {boolean} ok 是否通过
 */
const check = (label, ok) => checks.push([label, ok])

const { sandbox, appended, created } = run()
const registration = sandbox.registered

check('客户端补丁按 DSH 的包装格式注册', registration !== undefined && typeof registration.factory === 'function')
check('注册 id 等于 package.json 的 name（DSH 按包名建模块表）', registration?.id === manifest.name)
check('补丁不是 ESM（按 DSH 包装格式发布，不能被 Node 直接 import）', !/^export\s/m.test(SOURCE))

const exported = registration.factory((specifier) => {
  throw new Error(`客户端补丁不该有外部依赖，却 require 了 ${specifier}`)
})
check('导出 apply 函数', typeof exported?.apply === 'function')
check('导出 name 便于日志辨认', typeof exported?.name === 'string' && exported.name.length > 0)

let disposer
exported.apply({
  effect: (callback) => {
    disposer = callback()
  },
})

const style = appended[0]
check('注入了一个 style 元素', style !== undefined && style.tagName === 'style')
check('样式规则按 provider 路由名定位本行', style?.textContent.includes(`(${PROVIDER_KEY})`))
check('样式规则隐藏的是 rowTag（DSH 的「自定义」标签）', style?.textContent.includes('rowTag'))
check('样式规则不碰删除按钮（删除按钮由补丁层本身消除）', !style?.textContent.includes('dangerButton'))
check('样式元素带稳定 id，便于重复加载时复用', style?.id === 'dsh-radeon-cloud-hide-custom-tag')

check('effect 回调返回了清理函数', typeof disposer === 'function')
disposer?.()
check('卸载时把样式元素移除', style?.removed === true)
check('只造了一个 style 元素', created.length === 1)

/** 没有 document 的环境（例如 WebWorker 里）应当安静返回。 */
const headless = run(SOURCE, false)
const headlessExports = headless.sandbox.registered?.factory(() => {
  throw new Error('不该 require 任何东西')
})
let headlessThrew = false
try {
  headlessExports.apply({ effect: () => {} })
} catch {
  headlessThrew = true
}
check('无 document 的环境下安静返回，不抛异常', headlessThrew === false)

let failed = 0
for (const [label, ok] of checks) {
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${label}`)
}

console.log()
console.log(`共 ${checks.length} 项，未通过 ${failed} 项`)
if (failed > 0) process.exit(1)
console.log('✓ 客户端补丁按预期隐藏本行的「自定义」标签')
