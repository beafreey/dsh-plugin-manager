/**
 * Update-flow integration test: exercises the real pnpm update path against a
 * THROWAWAY copy of the web profile (a fake home under the workspace). The
 * user's real ~/.dsh/profiles/web is never touched. Verifies spawn plumbing,
 * update args, in-flight lock, and post-update version re-read.
 */

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { PluginManager } from '../lib/index.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const testHome = join(root, '.test-home')
const realProfile = join(process.env.HOME ?? '', '.dsh', 'profiles', 'web')
const testProfile = join(testHome, '.dsh', 'profiles', 'web')

// 1. Stage a fresh copy of the profile manifest/lock/workspace (no node_modules).
rmSync(testHome, { recursive: true, force: true })
mkdirSync(testProfile, { recursive: true })
for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.yml', 'cordis.patch.yml']) {
  const source = join(realProfile, file)
  if (existsSync(source)) cpSync(source, join(testProfile, file))
}

// 2. Materialize dependencies in the copy. The store comes from the
// environment (npm_config_store_dir), so the staging install and the
// manager's pnpm spawn agree on the store — exactly like the real profile,
// where both use the user's default store.
const install = spawnSync('pnpm', ['install'], {
  cwd: testProfile,
  encoding: 'utf8',
  timeout: 300_000,
})
if (install.status !== 0) {
  console.error('staging pnpm install failed:', install.stdout, install.stderr)
  process.exit(1)
}

// 3. Run the real update path for the smallest third-party plugin.
const manager = new PluginManager({
  config: () => ({ profile: 'web' }),
  home: testHome,
})

const before = manager.listPlugins().find(entry => entry.name === '@liustack/modlens')
const sidebarBefore = manager.listPlugins().find(entry => entry.name === 'dsh-better-sidebar')
console.log('before:', before?.name, before?.version, '| sidebar before:', sidebarBefore?.version)

const result = await manager.updatePlugin('@liustack/modlens')
console.log('update result:', JSON.stringify({ ok: result.ok, error: result.error, durationMs: result.durationMs }))
console.log('pnpm output tail:', result.output.slice(-300).replaceAll('\n', ' | '))

const after = manager.listPlugins().find(entry => entry.name === '@liustack/modlens')
console.log('after:', after?.name, after?.version)

// 4. In-flight lock: while one update runs, a second update must be rejected
// (the lock is taken before the registry lookup, so the second call rejects
// on the lock even though its own package state would allow an update).
const webUiBefore = manager.listPlugins().find(entry => entry.name === '@linxin666/dsh-web-ui-all')
const first = manager.updatePlugin('dsh-better-sidebar')
let lockRejected = false
manager.updatePlugin('@linxin666/dsh-web-ui-all').catch(error => {
  lockRejected = error.message.includes('another update')
})
const firstResult = await first
console.log('first update result:', JSON.stringify({ ok: firstResult.ok, error: firstResult.error, durationMs: firstResult.durationMs }))
console.log('in-flight lock rejects concurrent update:', lockRejected)

// 5. After the first update settles, the next update must go through (lock released).
const secondResult = await manager.updatePlugin('@linxin666/dsh-web-ui-all')
console.log('second update result:', JSON.stringify({ ok: secondResult.ok, error: secondResult.error, durationMs: secondResult.durationMs }))
const sidebarAfter = manager.listPlugins().find(entry => entry.name === 'dsh-better-sidebar')
const webUiAfter = manager.listPlugins().find(entry => entry.name === '@linxin666/dsh-web-ui-all')
console.log('dsh-better-sidebar after:', sidebarAfter?.version, '| web-ui-all after:', webUiAfter?.version)

const ok = firstResult.ok && after?.version !== before?.version && lockRejected && secondResult.ok
  && sidebarAfter?.version !== sidebarBefore?.version && webUiAfter?.version !== webUiBefore?.version
console.log(ok ? 'UPDATE-FLOW OK' : 'UPDATE-FLOW FAILED')
if (!ok) process.exitCode = 1

// 6. Clean up the throwaway copy.
rmSync(testHome, { recursive: true, force: true })
console.log('test home cleaned up')
