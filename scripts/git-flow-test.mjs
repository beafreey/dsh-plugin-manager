/**
 * Git-install compatibility test: proves plugins installed from GitHub are
 * discovered and manageable. Stages a throwaway profile copy, installs a real
 * GitHub-hosted DSH plugin with `pnpm add github:...`, then verifies the
 * manager lists it (kind=git), derives the repository URL from the spec when
 * needed, checks it through git ls-remote, and runs the git update path.
 * The user's real ~/.dsh/profiles/web is never touched.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { PluginManager, specToRepositoryUrl } from '../lib/index.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const testHome = join(root, '.test-home-git')
const realProfile = join(process.env.HOME ?? '', '.dsh', 'profiles', 'web')
const testProfile = join(testHome, '.dsh', 'profiles', 'web')

// 0. specToRepositoryUrl unit cases.
const cases = [
  ['github:omdsh-dev/DSH-better-sidebar#main', 'https://github.com/omdsh-dev/DSH-better-sidebar'],
  ['gitlab:foo/bar', 'https://gitlab.com/foo/bar'],
  ['bitbucket:foo/bar.git#v1', 'https://bitbucket.org/foo/bar'],
  ['git+https://github.com/a/b.git#branch', 'https://github.com/a/b'],
]
for (const [input, expected] of cases) {
  const got = specToRepositoryUrl(input)
  if (got !== expected) {
    console.error(`specToRepositoryUrl FAIL: ${input} -> ${got}, expected ${expected}`)
    process.exit(1)
  }
}
console.log('specToRepositoryUrl unit cases OK')

// 1. Stage a fresh copy of the profile manifest/lock/workspace (no node_modules).
rmSync(testHome, { recursive: true, force: true })
mkdirSync(testProfile, { recursive: true })
for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.yml', 'cordis.patch.yml']) {
  const source = join(realProfile, file)
  if (existsSync(source)) cpSync(source, join(testProfile, file))
}

// 2. Materialize deps, then install a real GitHub-hosted DSH plugin.
const install = spawnSync('pnpm', ['install'], { cwd: testProfile, encoding: 'utf8', timeout: 300_000 })
if (install.status !== 0) {
  console.error('staging pnpm install failed:', install.stdout, install.stderr)
  process.exit(1)
}
// pnpm 11 blocks git-hosted build scripts unless allowlisted. The workspace
// allowBuilds key must be the exact `name@<tarball-url>` pnpm prints in its
// error (the URL carries the commit hash, unknowable upfront) — so mirror the
// real user flow: attempt, parse the required key from stderr, approve, retry.
const addArgs = ['add', 'github:omdsh-dev/DSH-better-sidebar']
let addGit = spawnSync('pnpm', addArgs, { cwd: testProfile, encoding: 'utf8', timeout: 300_000 })
if (addGit.status !== 0) {
  const keyMatch = /allowBuilds:\s*\n\s+(\S+):\s*true/.exec(addGit.stdout + addGit.stderr)
  if (keyMatch?.[1] === undefined) {
    console.error('pnpm add github:... failed and no allowBuilds key was advertised:', addGit.stdout, addGit.stderr)
    process.exit(1)
  }
  const workspacePath = join(testProfile, 'pnpm-workspace.yaml')
  let workspaceText = readFileSync(workspacePath, 'utf8')
  workspaceText = /allowBuilds:/.test(workspaceText)
    ? workspaceText.replace(/allowBuilds:\n/, `allowBuilds:\n  ${keyMatch[1]}: true\n`)
    : workspaceText + `\nallowBuilds:\n  ${keyMatch[1]}: true\n`
  writeFileSync(workspacePath, workspaceText)
  console.log('approved build for:', keyMatch[1])
  addGit = spawnSync('pnpm', addArgs, { cwd: testProfile, encoding: 'utf8', timeout: 300_000 })
}
if (addGit.status !== 0) {
  console.error('pnpm add github:... failed:', addGit.stdout, addGit.stderr)
  process.exit(1)
}

// 3. The manager must list the GitHub-installed plugin as kind=git.
const manager = new PluginManager({ config: () => ({ profile: 'web' }), home: testHome })
const rows = manager.listPlugins()
const row = rows.find(entry => entry.name === 'dsh-better-sidebar')
console.log('git row:', JSON.stringify({ spec: row?.spec, version: row?.version, kind: row?.kind, repository: row?.repository, gitHead: row?.gitHead?.slice(0, 7) }))
if (row === undefined || row.kind !== 'git' || row.repository === undefined || row.gitHead === undefined) {
  console.error('GIT-FLOW FAILED: GitHub-installed plugin not listed as a git dependency with repo + head')
  process.exit(1)
}

// 4. Update check through git ls-remote.
const checked = await manager.checkOne(row)
console.log('git check:', JSON.stringify({ state: checked.state, latest: checked.latest, error: checked.error }))
if (checked.state === 'error') {
  console.error('GIT-FLOW FAILED: git check errored:', checked.error)
  process.exit(1)
}

// 5. The git update path (`pnpm up`) must run cleanly.
const updated = await manager.updatePlugin('dsh-better-sidebar')
console.log('git update:', JSON.stringify({ ok: updated.ok, error: updated.error }))
if (!updated.ok) {
  console.error('GIT-FLOW FAILED: git update errored:', updated.error)
  process.exit(1)
}

console.log('GIT-FLOW OK')
rmSync(testHome, { recursive: true, force: true })
console.log('test home cleaned up')
