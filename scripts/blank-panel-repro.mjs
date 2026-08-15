/**
 * Blank-panel reproduction: fabricate the minimal dsh shell DOM, apply the
 * client plugin, click the sidebar entry, and check whether the React panel
 * renders content (or throws the useSyncExternalStore identity error).
 */

import { JSDOM } from 'jsdom'

const dom = new JSDOM(`<!doctype html><html><head></head><body>
  <div data-pane="sidebar">
    <div><div class="logoRowX"><button class="newSessionX">新会话</button></div></div>
  </div>
  <div data-pane="conversation"><div class="chatX">chat</div></div>
</body></html>`, { url: 'http://127.0.0.1:54226/' })

const { window } = dom
globalThis.window = window
globalThis.document = window.document
globalThis.MutationObserver = window.MutationObserver
globalThis.CustomEvent = window.CustomEvent
globalThis.HTMLElement = window.HTMLElement
globalThis.HTMLButtonElement = window.HTMLButtonElement
globalThis.Node = window.Node
globalThis.Element = window.Element
globalThis.getComputedStyle = window.getComputedStyle.bind(window)
// No fetch: the controller's first load fails into the error banner path,
// which is fine — the panel chrome must still render.
globalThis.fetch = () => Promise.reject(new Error('no fetch in repro'))

let handoff
window.__ModuleLoader__ = { load: (h) => { handoff = h } }

await import('../lib/client.js')
const client = handoff.factory(() => { throw new Error('unexpected require') })
const ctx = { effect: (fn) => fn() }
client.apply(ctx)

// Sidebar entry must be placed.
const entry = document.querySelector('[data-dsh-pluginmanager-entry]')
console.log('entry placed:', entry !== null)
if (entry === null) process.exit(1)

// Click it — this toggles the panel open and mounts the React view.
entry.click()
await new Promise((resolve) => setTimeout(resolve, 300))

const view = document.querySelector('[data-dsh-pluginmanager-view]')
console.log('panel container appended:', view !== null)
console.log('html active attr:', document.documentElement.hasAttribute('data-dsh-pluginmanager-active'))
if (view !== null) {
  console.log('panel innerHTML length:', view.innerHTML.length)
  console.log('panel text head:', view.textContent?.slice(0, 120))
}

// Regression assertions: the panel must actually render its chrome. The
// useSyncExternalStore identity bug made this throw / stay blank.
const text = view?.textContent ?? ''
const ok = entry !== null && view !== null && text.includes('插件管理') && text.includes('检查更新')
console.log(ok ? 'BLANK-PANEL REGRESSION OK' : 'BLANK-PANEL REGRESSION FAILED')
if (!ok) process.exit(1)
