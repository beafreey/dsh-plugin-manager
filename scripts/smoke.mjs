/**
 * Smoke test for the plugin manager core against the real dsh profile.
 * Not shipped in the package — a local verification script.
 */

import { PluginManager } from '../lib/index.js'

const manager = new PluginManager({
  config: () => ({ profile: 'web' }),
})

console.log('=== summary ===')
console.log(JSON.stringify(manager.summary(), null, 2))

console.log('=== listPlugins ===')
for (const entry of manager.listPlugins()) {
  console.log(`${entry.name} ${entry.version} kind=${entry.kind} bundle=${entry.isBundle} repo=${entry.repository ?? '-'}`)
}

console.log('=== checkUpdates (registry + git) ===')
const checked = await manager.checkUpdates()
for (const entry of checked) {
  console.log(`${entry.name}: ${entry.version} -> ${entry.latest ?? '-'} [${entry.state}] ${entry.error ?? ''}`)
}
