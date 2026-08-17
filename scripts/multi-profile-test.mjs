/**
 * Multi-profile test: stages a fake home with two profiles (web + desktop),
 * both mounting dsh-plugin-manager, and verifies auto-detection, per-profile
 * isolation, and that update spawns target the right profile directory.
 * Offline: registry checks are bypassed by asserting list-level behavior and
 * a mocked spawn (the update path pins the exact version, so no real pnpm).
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PluginManager } from '../lib/index.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const testHome = join(root, '.test-home-multi')
rmSync(testHome, { recursive: true, force: true })

function stageProfile(name, deps) {
  const dir = join(testHome, '.dsh', 'profiles', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: `dsh-profile-${name}`,
    private: true,
    dependencies: deps,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', ...Object.keys(deps)] } },
  }, null, 2))
}

stageProfile('web', {
  '@linxin666/dsh-web-ui-all': '0.1.16',
  'dsh-plugin-manager': 'github:beafreey/dsh-plugin-manager',
})
stageProfile('desktop', {
  'dsh-better-sidebar': '0.12.2',
  'dsh-plugin-manager': 'github:beafreey/dsh-plugin-manager',
})
// A third profile without the manager must NOT be auto-managed.
stageProfile('headless', { 'some-other-tool': '1.0.0' })

const spawned = []
const manager = new PluginManager({
  config: () => ({ registry: 'https://registry.npmjs.org' }),
  home: testHome,
  spawn: async (command, args, options) => {
    spawned.push({ command, args, cwd: options.cwd })
    return { exitCode: 0, stdout: 'ok', stderr: '' }
  },
})

const detected = manager.profiles()
console.log('auto-detected profiles:', detected.join(', '))
if (detected.length !== 2 || !detected.includes('web') || !detected.includes('desktop')) {
  console.error('MULTI-PROFILE FAILED: expected [web, desktop]')
  process.exit(1)
}

// Per-profile isolation: each profile lists only its own plugins.
const webPlugins = manager.listPlugins('web').map(entry => entry.name)
const desktopPlugins = manager.listPlugins('desktop').map(entry => entry.name)
console.log('web plugins:', webPlugins.join(', '))
console.log('desktop plugins:', desktopPlugins.join(', '))
if (webPlugins.length !== 2 || desktopPlugins.length !== 2) {
  console.error('MULTI-PROFILE FAILED: per-profile lists wrong')
  process.exit(1)
}

// Update must spawn pnpm in the TARGET profile's directory.
await manager.updatePlugin('dsh-better-sidebar', 'desktop')
const target = spawned.find(entry => entry.args[0] === 'add')
console.log('update spawn cwd:', target?.cwd)
if (target === undefined || !target.cwd.includes('desktop')) {
  console.error('MULTI-PROFILE FAILED: update did not target the desktop profile')
  process.exit(1)
}

// A concurrent update in a DIFFERENT profile must be allowed (per-profile locks).
spawned.length = 0
const first = manager.updatePlugin('@linxin666/dsh-web-ui-all', 'web')
let desktopRejected = false
manager.updatePlugin('dsh-better-sidebar', 'desktop').catch(error => {
  desktopRejected = error.message.includes('another profile operation')
})
await first
console.log('concurrent cross-profile update rejected:', desktopRejected)
if (desktopRejected) {
  console.error('MULTI-PROFILE FAILED: different profiles share a lock')
  process.exit(1)
}

console.log('MULTI-PROFILE OK')
rmSync(testHome, { recursive: true, force: true })
