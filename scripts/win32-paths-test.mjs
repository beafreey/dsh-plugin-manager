/**
 * Windows-compatibility test (runs on any platform): probes the
 * platform-aware pnpm discovery (PATH `;` separator, .cmd shim probing,
 * Windows candidate dirs) with a fake pnpm.cmd fixture, and verifies the
 * safe-package-name guard rejects shell metacharacters before spawn.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findPnpm, PluginManager } from '../lib/index.js'

// 1. win32 PATH parsing: a `;`-separated PATH containing a fixture dir with a
// pnpm.cmd shim must resolve to that shim (bare `pnpm` probe misses it).
const fixture = mkdtempSync(join(tmpdir(), 'dshpm-win-'))
writeFileSync(join(fixture, 'pnpm.cmd'), '@echo off\n')
const winEnv = { PATH: `C:\\Program Files\\nodejs;${fixture}` }
const found = findPnpm(undefined, winEnv, 'win32')
console.log('win32 pnpm.cmd discovery:', found ?? 'NOT FOUND')
if (found !== join(fixture, 'pnpm.cmd')) {
  console.error('WIN32-PATHS FAILED: pnpm.cmd shim not discovered')
  process.exit(1)
}
rmSync(fixture, { recursive: true, force: true })

// 2. The safe-name guard must reject metacharacters before any spawn.
const manager = new PluginManager({
  config: () => ({ profile: 'web' }),
  spawn: async () => { throw new Error('spawn must not be reached') },
})
let rejected = false
try {
  await manager.removePlugin('evil; rm -rf /')
} catch (error) {
  rejected = error instanceof Error && error.message.includes('refusing package name')
}
console.log('shell-metacharacter package name refused:', rejected)
if (!rejected) {
  console.error('WIN32-PATHS FAILED: unsafe package name reached spawn')
  process.exit(1)
}

console.log('WIN32-PATHS OK')
