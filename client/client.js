/**
 * 客户端补丁：把「设置 → 模型」里本插件那一行的「自定义」标签藏掉。
 *
 * 为什么需要它：dsh-llm-pi-ai 对「不在内置模型目录中的 provider」硬编码
 * `declared: !catalog.has(provider)`，而 dsh-client-ui-settings-models 只看到这个
 * 标记就渲染「自定义」标签。本插件的 provider 必然落在这一支，配置层面无从去掉。
 *
 * 做法是纯 CSS，不碰 DSH 的任何模块、不做 DOM 写入：
 *
 *   li:has(button[aria-label*="(radeon-cloud)"]) span[class*="rowTag"] { display: none }
 *
 * 判据取自 DSH 自己拼的 aria-label（`编辑 Radeon Cloud (radeon-cloud)`）——它与
 * 界面语言无关，只随 provider 路由名变化；`rowTag` 是 CSS Modules 源类名，会以
 * 片段形式保留在哈希类名里。
 *
 * 代价说清楚：这依赖 DSH 的 DOM 结构与类名片段。DSH 改版后它会静默失效——
 * 标签重新出现，但功能不受影响；本行「删除」按钮则根本不由本补丁负责，
 * 它由 provider 定义落在补丁层这件事本身永久消除（见 cordis.plugin.patch.yml）。
 *
 * 文件格式注意：本文件不是 ESM，而是 DSH 客户端模块的包装格式
 * （window.__ModuleLoader__.load），因此不要把它 import 进任何 Node 代码。
 * test/client-patch.test.mjs 用 node:vm 在桩环境里跑它。
 */
window.__ModuleLoader__.load({
  // 必须等于 package.json 的 name —— DSH 按包名给客户端模块建表，写错会「加载了却没注册」。
  id: '@zhz8888/dsh-radeon-cloud-patcher',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    /** 本插件负责的 provider 路由名。 */
    var PROVIDER = 'radeon-cloud'
    /** 注入的样式元素 id，便于重复加载时复用而非叠加。 */
    var STYLE_ID = 'dsh-radeon-cloud-hide-custom-tag'
    /** 隐藏标签的规则；只匹配带本 provider 路由名的行。 */
    var CSS = 'li:has(button[aria-label*="(' + PROVIDER + ')"]) span[class*="rowTag"]{display:none !important}'

    /**
     * 注入样式表。用 ctx.effect 登记，插件卸载时一并移除。
     *
     * @param ctx 客户端插件上下文
     */
    function apply(ctx) {
      if (typeof document === 'undefined') return
      ctx.effect(function () {
        var existing = document.getElementById(STYLE_ID)
        var style = existing === null ? document.createElement('style') : existing
        style.id = STYLE_ID
        style.textContent = CSS
        if (existing === null) document.head.append(style)
        return function () {
          style.remove()
        }
      })
    }

    exports.name = 'radeon-cloud-client'
    exports.apply = apply
    return module.exports
  },
})
