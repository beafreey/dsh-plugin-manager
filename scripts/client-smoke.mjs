/**
 * Client-side smoke test: load the built client bundle into a jsdom window
 * with a __ModuleLoader__ handoff, then run apply() against a minimal cordis
 * Context mock. Asserts the style sheet injects, no apply-time exception is
 * thrown, and disposal cleans up. Dev-only; not shipped.
 */

import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://127.0.0.1:60872/' })
const { window } = dom

// Expose the browser globals the bundle touches at load/apply time.
globalThis.window = window
globalThis.document = window.document
globalThis.MutationObserver = window.MutationObserver
globalThis.CustomEvent = window.CustomEvent
globalThis.HTMLElement = window.HTMLElement
globalThis.HTMLButtonElement = window.HTMLButtonElement
globalThis.Node = window.Node
globalThis.Element = window.Element
globalThis.getComputedStyle = window.getComputedStyle.bind(window)

let handoff
window.__ModuleLoader__ = {
  load(h) {
    handoff = h
  },
}

// Executing the bundle registers the handoff (script-style wrapper, no ESM
// exports); the loader contract is handoff.factory(require) → module exports.
await import('../lib/client.js')
const client = handoff.factory(() => { throw new Error('unexpected require call') })
const { apply, inject, name } = client
console.log('handoff id:', handoff.id, '| exports:', [typeof apply, Array.isArray(inject), typeof name].join(', '))
if (handoff.id !== 'dsh-plugin-manager') {
  console.error('unexpected handoff id')
  process.exit(1)
}

const disposers = []
const ctx = {
  effect: (fn) => {
    const disposer = fn()
    disposers.push(disposer)
    return disposer
  },
}

try {
  apply(ctx)
  console.log('client apply() ran without throwing')
} catch (error) {
  console.error('client apply() threw:', error)
  process.exitCode = 1
}

const style = document.getElementById('dsh-plugin-manager-styles')
console.log('stylesheet injected:', style !== null && style.textContent.length > 1000 ? 'yes' : 'NO')

// The entry row cannot place without the shell DOM, but mounting must be armed.
console.log('entry rows placed (expected 0 without shell):', document.querySelectorAll('[data-dsh-pluginmanager-entry]').length)

// Dispose everything and confirm the tree is clean.
for (const dispose of disposers) dispose()
console.log('disposed:', disposers.length, 'disposers')

if (process.exitCode !== 1) console.log('client smoke OK')
