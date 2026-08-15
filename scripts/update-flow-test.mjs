/**
 * Update/remove flow integration test: exercises the real pnpm update and
 * remove paths against a THROWAWAY copy of the web profile (a fake home under
 * the workspace). The user's real ~/.dsh/profiles/web is never touched.
 *
 * Targets are chosen dynamically from the plugins the real profile currently
 * reports as outdated, so the test stays valid as the user updates plugins
 * through the panel over time. Skips gracefully when fewer than two outdated
 * registry plugins exist.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
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

const manager = new PluginManager({
  config: () => ({ profile: 'web' }),
  home: testHome,
})

// 3. Pick two outdated registry plugins dynamically (real-profile state).
const outdated = (await manager.checkUpdates()).filter(entry => entry.state === 'outdated' && entry.kind === 'registry')
if (outdated.length < 2) {
  console.log('SKIP: fewer than 2 outdated registry plugins in the real profile — nothing to exercise')
  rmSync(testHome, { recursive: true, force: true })
  process.exit(0)
}
const [targetA, targetB] = outdated
const beforeA = manager.listPlugins().find(entry => entry.name === targetA?.name)
const beforeB = manager.listPlugins().find(entry => entry.name === targetB?.name)
console.log('targets:', `${targetA.name} ${targetA.version}->${targetA.latest}`, '|', `${targetB.name} ${targetB.version}->${targetB.latest}`)

// 4. Update targetA; the in-flight lock must reject a concurrent update for
// targetB (the lock is taken before the registry lookup, so the second call
// rejects on the lock even though its own package state would allow one).
const first = manager.updatePlugin(targetA.name)
let lockRejected = false
manager.updatePlugin(targetB.name).catch(error => {
  lockRejected = error.message.includes('another profile operation')
})
const firstResult = await first
console.log('first update result:', JSON.stringify({ ok: firstResult.ok, error: firstResult.error, durationMs: firstResult.durationMs }))
console.log('in-flight lock rejects concurrent update:', lockRejected)

// 5. After the first update settles, the next update must go through (lock released).
const secondResult = await manager.updatePlugin(targetB.name)
console.log('second update result:', JSON.stringify({ ok: secondResult.ok, error: secondResult.error, durationMs: secondResult.durationMs }))
const afterA = manager.listPlugins().find(entry => entry.name === targetA.name)
const afterB = manager.listPlugins().find(entry => entry.name === targetB.name)
console.log('after:', `${targetA.name} ${afterA?.version}`, '|', `${targetB.name} ${afterB?.version}`)

// 6. Remove flow: remove targetB; the row must leave the list and the name
// must leave dsh.profile.bundles (bundle-layer reconciliation).
const removeResult = await manager.removePlugin(targetB.name)
console.log('remove result:', JSON.stringify({ ok: removeResult.ok, error: removeResult.error }))
const removedRow = manager.listPlugins().find(entry => entry.name === targetB.name)
const manifestAfter = JSON.parse(readFileSync(join(testProfile, 'package.json'), 'utf8'))
const stillInBundles = manifestAfter.dsh?.profile?.bundles?.includes(targetB.name) ?? false
console.log('removed row gone:', removedRow === undefined, '| removed from bundles:', !stillInBundles)

const ok = firstResult.ok && afterA?.version !== beforeA?.version && lockRejected && secondResult.ok
  && afterB?.version !== beforeB?.version && removeResult.ok && removedRow === undefined && !stillInBundles
console.log(ok ? 'UPDATE-REMOVE-FLOW OK' : 'UPDATE-REMOVE-FLOW FAILED')
if (!ok) process.exitCode = 1

// 7. Clean up the throwaway copy.
rmSync(testHome, { recursive: true, force: true })
console.log('test home cleaned up')
