/**
 * Plugin manager core — framework-free service the host routes/tools wrap.
 *
 * Responsibilities: resolve the managed dsh profiles (config override, or
 * auto-detect the profiles that mount this plugin), project their third-party
 * dependencies (package.json deps) into plugin rows with installed version /
 * repository metadata, check for updates against the npm registry (registry
 * deps) or the git remote (git deps), and update/remove plugins by running
 * pnpm in each profile directory. Only one operation runs per profile at a
 * time (different profiles may update concurrently).
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type {
  CheckRequest,
  PluginEntry,
  PluginInstallKind,
  ProfileSummary,
  SpawnResult,
  UpdateResult,
} from './protocol.ts'

/** Latest-version endpoint shape the npm registry answers. */
interface RegistryLatest {
  version?: string
  error?: string
}

/** The plugin settings the host surfaces (validated by schemastery in index.ts). */
export interface ManagerConfig {
  /** Profiles to manage (explicit list wins). */
  profiles?: string[]
  /** Single-profile fallback; empty = auto-detect (argv --profile, then `web`). */
  profile?: string
  /** npm registry base URL for version checks. */
  registry?: string
  /** Explicit pnpm binary path; empty = auto-detect. */
  pnpmPath?: string
}

/** One child-process run, injectable for tests. */
export type SpawnFn = (
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number; env: NodeJS.ProcessEnv },
) => Promise<SpawnResult>

/** Dependency injection for the manager (tests substitute filesystem/spawn). */
export interface ManagerDeps {
  /** Caller-configurable overrides (live value getter). */
  config: () => ManagerConfig
  /** Child-process runner (defaults to node:child_process spawn). */
  spawn?: SpawnFn
  /** Home directory base for profile discovery. */
  home?: string
}

/** Cached registry latest-version lookups so repeated checks stay cheap. */
const registryCache = new Map<string, { at: number; version?: string; error?: string }>()
/** Registry cache TTL. */
const REGISTRY_CACHE_MS = 60_000
/** Parallelism cap for update checks. */
const CHECK_CONCURRENCY = 6
/** In-flight operations, one per profile directory (value = operation label). */
const activeOperations = new Map<string, string>()
/** The package name this manager identifies itself as for auto-detection. */
const SELF_PACKAGE = 'dsh-plugin-manager'

/** Whether the target platform runs Windows (spawn/candidates behave differently). */
const isWin = (platform: NodeJS.Platform): boolean => platform === 'win32'

/** Default spawn implementation over node:child_process. */
export const defaultSpawn: SpawnFn = (command, args, { cwd, timeoutMs, env }) => new Promise((resolveSpawn) => {
  // Windows ships pnpm as a .cmd shim, which node cannot exec without a shell.
  // shell:true makes cmd.exe run it; the argument list contains only validated
  // package names and fixed flags (no user-controlled free text), so quoting
  // through cmd.exe is safe.
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: isWin(process.platform),
  })
  let stdout = ''
  let stderr = ''
  let settled = false
  const timer = setTimeout(() => {
    if (settled) return
    settled = true
    child.kill('SIGKILL')
    resolveSpawn({ exitCode: null, stdout, stderr, error: `timed out after ${timeoutMs} ms` })
  }, timeoutMs)
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
  child.on('error', (error) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    resolveSpawn({ exitCode: null, stdout, stderr, error: error.message })
  })
  child.on('close', (exitCode) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    resolveSpawn({ exitCode, stdout, stderr })
  })
})

/** Rough semver-aware compare: >0 newer, <0 older, 0 equal. */
function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/)
  const pb = b.split(/[.+-]/)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? ''
    const vb = pb[i] ?? ''
    if (va === vb) continue
    const na = Number(va)
    const nb = Number(vb)
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na > nb ? 1 : -1
    return va > vb ? 1 : -1
  }
  return 0
}

/** Classify a profile dependency spec. */
export function classifySpec(spec: string): PluginInstallKind {
  if (/^(link|file|workspace|portal):/.test(spec)) return 'local'
  if (/^git[+]|^github:|^gitlab:|^bitbucket:|[.]git(?:#|$)/.test(spec)) return 'git'
  return 'registry'
}

/**
 * Derive a browsable repository URL from a git dependency spec. Fallback for
 * git-installed plugins whose own manifest carries no `repository` field —
 * github:/gitlab:/bitbucket: shorthands and git+https URLs all resolve.
 */
export function specToRepositoryUrl(spec: string): string | undefined {
  const shorthand = /^(github|gitlab|bitbucket):([^#/]+)\/([^#]+)/.exec(spec)
  if (shorthand?.[1] !== undefined && shorthand[2] !== undefined && shorthand[3] !== undefined) {
    const host = { github: 'github.com', gitlab: 'gitlab.com', bitbucket: 'bitbucket.org' }[shorthand[1]]
    return `https://${host}/${shorthand[2]}/${shorthand[3].replace(/[.]git$/, '')}`
  }
  const direct = /^(?:git\+)?(https?:\/\/\S+?)(?:#\S*)?$/.exec(spec)
  return direct?.[1]?.replace(/[.]git$/, '')
}

/** Platform-aware PATH separator and well-known package-manager locations. */
function platformPathSpec(platform: NodeJS.Platform): { separator: string; extras: string[] } {
  if (platform === 'win32') {
    const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
    const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
    return {
      separator: ';',
      extras: [
        join(appData, 'npm'),
        join(localAppData, 'pnpm'),
        join(programFiles, 'nodejs'),
      ],
    }
  }
  return {
    separator: ':',
    extras: ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', join(homedir(), 'Library', 'pnpm'), join(homedir(), '.local', 'share', 'pnpm')],
  }
}

/** Locate the pnpm binary from explicit config, PATH, then known locations. */
export function findPnpm(
  explicit: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (explicit !== undefined && explicit !== '') {
    if (existsSync(explicit)) return resolve(explicit)
    return undefined
  }
  const { separator, extras } = platformPathSpec(platform)
  const pathDirs = (env.PATH ?? '').split(separator).filter((entry) => entry !== '')
  // Windows ships pnpm as a .cmd shim; probe both the bare name and the shim.
  const candidateNames = isWin(platform) ? ['pnpm', 'pnpm.cmd'] : ['pnpm']
  const candidates = [
    ...pathDirs.flatMap((dir) => candidateNames.map((name) => join(dir, name))),
    ...extras.flatMap((dir) => candidateNames.map((name) => join(dir, name))),
  ]
  for (const candidate of candidates) {
    if (candidate !== '' && existsSync(candidate)) return resolve(candidate)
  }
  return undefined
}

/**
 * Merge common binary dirs into a PATH so GUI-spawned shells still find
 * pnpm/git. Platform-aware: `;` separator and npm/pnpm/nodejs locations on
 * Windows, brew/usr locations elsewhere.
 */
function widenedPath(base: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  const { separator, extras } = platformPathSpec(platform)
  const seen = new Set((base.PATH ?? '').split(separator).filter((entry) => entry !== ''))
  for (const dir of extras) {
    if (!seen.has(dir) && existsSync(dir)) seen.add(dir)
  }
  return [...seen].join(separator)
}

/**
 * Acceptable package-name shape for command lines. Registry package names and
 * scoped names fit this; anything outside it (whitespace, shell metacharacters)
 * is refused before it can reach a spawned shell.
 */
const SAFE_PACKAGE_NAME = /^[A-Za-z0-9@._/-]+$/

/** Validate a package name before it reaches a spawn argument list. */
function assertSafePackageName(name: string): void {
  if (!SAFE_PACKAGE_NAME.test(name)) {
    throw new Error(`refusing package name ${JSON.stringify(name)}: characters outside [A-Za-z0-9@._/-] are not allowed`)
  }
}

/**
 * The dsh plugin manager. One instance per host plugin apply; methods take an
 * optional profile name (default: the current profile this host booted).
 */
export class PluginManager {
  private readonly deps: ManagerDeps
  private readonly spawn: SpawnFn
  /** pnpm absolute path, re-resolved on every use (config may change). */
  private lastPnpm: string | undefined

  constructor(deps: ManagerDeps) {
    this.deps = deps
    this.spawn = deps.spawn ?? defaultSpawn
  }

  /** The home directory this manager operates under. */
  private homeBase(): string {
    return this.deps.home ?? homedir()
  }

  /** The active profile name: config → argv --profile → env → `web`. */
  profileName(): string {
    const configured = this.deps.config().profile
    if (configured !== undefined && configured !== '') return configured
    const argv = process.argv
    for (let i = 0; i < argv.length - 1; i++) {
      if (argv[i] === '--profile' && argv[i + 1] !== '') return argv[i + 1] as string
    }
    const env = process.env.DSH_PROFILE
    if (env !== undefined && env !== '') return env
    return 'web'
  }

  /** Absolute directory of one profile (default: the current one). */
  profileDir(profile = this.profileName()): string {
    return join(this.homeBase(), '.dsh', 'profiles', profile)
  }

  /**
   * The profiles this manager manages, in order: explicit `profiles` config,
   * then the single `profile` config, then auto-detection — the profiles that
   * mount this plugin (its dependency), falling back to every profile that
   * exists, then to the current profile.
   */
  profiles(): string[] {
    const configured = this.deps.config().profiles
    if (configured !== undefined && configured.length > 0) return [...configured]
    const single = this.deps.config().profile
    if (single !== undefined && single !== '') return [single]
    return this.detectProfiles()
  }

  /** Scan ~/.dsh/profiles for profiles that exist / host this plugin. */
  private detectProfiles(): string[] {
    const base = join(this.homeBase(), '.dsh', 'profiles')
    let names: string[] = []
    try {
      names = readdirSync(base, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && existsSync(join(base, entry.name, 'package.json')))
        .map((entry) => entry.name)
    } catch {
      // No profiles directory at all.
    }
    const hosting = names.filter((name) => this.profileHasSelf(name))
    if (hosting.length > 0) return hosting
    if (names.length > 0) return names
    return [this.profileName()]
  }

  /** Whether a profile's dependencies include this plugin. */
  private profileHasSelf(name: string): boolean {
    try {
      const manifest = JSON.parse(readFileSync(join(this.homeBase(), '.dsh', 'profiles', name, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, unknown>
      }
      return typeof manifest.dependencies === 'object' && manifest.dependencies !== null && SELF_PACKAGE in manifest.dependencies
    } catch {
      return false
    }
  }

  /** The npm registry base URL (trailing slash trimmed). */
  registry(): string {
    const configured = this.deps.config().registry
    if (configured !== undefined && configured !== '') return configured.replace(/\/+$/, '')
    return 'https://registry.npmjs.org'
  }

  /** Resolve the pnpm binary for update runs. */
  pnpmPath(): string | undefined {
    const explicit = this.deps.config().pnpmPath
    this.lastPnpm = findPnpm(explicit)
    return this.lastPnpm
  }

  /**
   * The store-dir a profile's node_modules was linked against, read from
   * pnpm's `.modules.yaml`. GUI-host processes can resolve a different
   * default store than the shell that installed the profile; pinning the
   * spawned pnpm to the recorded store avoids "linked with a different pnpm
   * store" failures.
   */
  private storeDir(dir: string): string | undefined {
    const modulesYaml = join(dir, 'node_modules', '.modules.yaml')
    if (!existsSync(modulesYaml)) return undefined
    try {
      const match = /["']storeDir["']\s*:\s*["']([^"']+)["']/.exec(readFileSync(modulesYaml, 'utf8'))
      return match?.[1]
    } catch {
      return undefined
    }
  }

  /** Spawn env for pnpm/git: widened PATH plus the profile's pinned store. */
  private spawnEnv(dir: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: widenedPath() }
    const storeDir = this.storeDir(dir)
    if (storeDir !== undefined) env.npm_config_store_dir = storeDir
    return env
  }

  /** Read the profile manifest (undefined when the profile does not exist). */
  private readProfileManifest(profile = this.profileName()): { dependencies: Record<string, string> } | undefined {
    const manifestPath = join(this.profileDir(profile), 'package.json')
    if (!existsSync(manifestPath)) return undefined
    try {
      const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const deps = (manifest as { dependencies?: unknown }).dependencies
      if (typeof deps !== 'object' || deps === null) return { dependencies: {} }
      return { dependencies: deps as Record<string, string> }
    } catch {
      return undefined
    }
  }

  /** Absolute directory of one installed dependency, or undefined. */
  private resolvePackageDir(name: string, profile = this.profileName()): string | undefined {
    try {
      const requireFromProfile = createRequire(join(this.profileDir(profile), 'package.json'))
      const manifestPath = requireFromProfile.resolve(`${name}/package.json`)
      return dirname(manifestPath)
    } catch {
      return undefined
    }
  }

  /** Metadata of one installed dependency's own package.json. */
  private readPackageMeta(name: string, profile = this.profileName()): {
    version: string
    repository: string | undefined
    gitHead: string | undefined
    isBundle: boolean
  } | undefined {
    const dir = this.resolvePackageDir(name, profile)
    if (dir === undefined) return undefined
    const manifestPath = join(dir, 'package.json')
    if (!existsSync(manifestPath)) return undefined
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        version?: unknown
        repository?: unknown
        gitHead?: unknown
        dsh?: { bundle?: { patch?: unknown } }
      }
      const repository = manifest.repository
      let repoUrl: string | undefined
      if (typeof repository === 'string') repoUrl = repository
      else if (typeof repository === 'object' && repository !== null) {
        const url = (repository as { url?: unknown }).url
        if (typeof url === 'string') repoUrl = url
      }
      if (repoUrl !== undefined) {
        repoUrl = repoUrl.replace(/^git[+]/, '').replace(/#.*$/, '').replace(/[.]git$/, '')
      }
      const dsh = manifest.dsh as { bundle?: { patch?: unknown } } | undefined
      return {
        version: typeof manifest.version === 'string' ? manifest.version : 'unknown',
        repository: repoUrl,
        gitHead: typeof manifest.gitHead === 'string' ? manifest.gitHead : undefined,
        isBundle: dsh?.bundle?.patch !== undefined,
      }
    } catch {
      return undefined
    }
  }

  /**
   * The commit hash pnpm resolved for a git dependency, read from the
   * profile's pnpm-lock.yaml. pnpm 11 no longer records `gitHead` inside the
   * installed package.json, but the lockfile's importer entry carries the
   * commit-addressed tarball URL (`...tar.gz/<40-hex-hash>`).
   */
  private installedGitCommit(name: string, profile = this.profileName()): string | undefined {
    const lockPath = join(this.profileDir(profile), 'pnpm-lock.yaml')
    if (!existsSync(lockPath)) return undefined
    const text = readFileSync(lockPath, 'utf8')
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Direct-dep entry under `importers:` — the name at 6-space indent, then
    // its `version:` line (the resolved tarball URL for git specs).
    const block = new RegExp(`^\\s{6}${escaped}:\\n(?:\\s{8}[^:\\n]+:[^\\n]*\\n)*?\\s{8}version: (\\S+)`, 'm').exec(text)
    const version = block?.[1]
    if (version === undefined) return undefined
    return /(?:tar\.gz\/|\.git#)([0-9a-f]{40})$/.exec(version)?.[1]
  }

  /** Project every profile dependency into a plugin row (no update checks). */
  listPlugins(profile = this.profileName()): PluginEntry[] {
    const manifest = this.readProfileManifest(profile)
    if (manifest === undefined) return []
    return Object.entries(manifest.dependencies).map(([name, spec]) => {
      const meta = this.readPackageMeta(name, profile)
      return {
        name,
        spec,
        version: meta?.version ?? 'unknown',
        repository: meta?.repository ?? specToRepositoryUrl(spec),
        isBundle: meta?.isBundle ?? false,
        kind: classifySpec(spec),
        gitHead: meta?.gitHead ?? this.installedGitCommit(name, profile),
        latest: undefined,
        latestGitHead: undefined,
        latestSource: undefined,
        state: 'unknown',
        error: undefined,
      }
    })
  }

  /** The live profile summary for the panel header. */
  summary(profile = this.profileName()): ProfileSummary {
    const dir = this.profileDir(profile)
    return {
      name: profile,
      dir,
      pnpm: this.pnpmPath(),
      registry: this.registry(),
      updating: activeOperations.has(dir),
    }
  }

  /** One profile view (summary + plugin rows) for the panel / tools. */
  profileView(profile = this.profileName()): { profile: ProfileSummary; plugins: PluginEntry[] } {
    return { profile: this.summary(profile), plugins: this.listPlugins(profile) }
  }

  /** Views for every managed profile. */
  allProfileViews(): Array<{ profile: ProfileSummary; plugins: PluginEntry[] }> {
    return this.profiles().map((profile) => this.profileView(profile))
  }

  /** Fetch the latest published version of one package from the registry. */
  private async registryLatest(name: string): Promise<{ version?: string; error?: string }> {
    const cacheKey = `${this.registry()}\u0000${name}`
    const cached = registryCache.get(cacheKey)
    if (cached !== undefined && Date.now() - cached.at < REGISTRY_CACHE_MS) {
      return { version: cached.version, error: cached.error }
    }
    let result: { version?: string; error?: string }
    try {
      const url = `${this.registry()}/${name.replace('/', '%2f')}/latest`
      const response = await fetch(url, {
        signal: AbortSignal.timeout(20_000),
        headers: { accept: 'application/json' },
      })
      if (!response.ok) {
        result = { error: `registry HTTP ${response.status}` }
      } else {
        const body = await response.json() as RegistryLatest
        result = typeof body.version === 'string'
          ? { version: body.version }
          : { error: 'registry returned no version' }
      }
    } catch (error) {
      result = { error: error instanceof Error ? error.message : String(error) }
    }
    registryCache.set(cacheKey, { at: Date.now(), ...result })
    return result
  }

  /** Resolve the git remote's default branch head for a repository URL. */
  private async gitRemoteHead(url: string, profile = this.profileName()): Promise<{ head?: string; branch?: string; error?: string }> {
    const run = async (args: string[]): Promise<SpawnResult> =>
      this.spawn('git', args, { cwd: this.profileDir(profile), timeoutMs: 25_000, env: this.spawnEnv(this.profileDir(profile)) })
    try {
      const symref = await run(['ls-remote', '--symref', url, 'HEAD'])
      const refLine = symref.stdout.split('\n').find((line) => line.includes('ref:'))
      const branchMatch = /ref:\s+refs\/heads\/(\S+)/.exec(refLine ?? '')
      const branch = branchMatch?.[1]
      if (branch === undefined) {
        // No symbolic ref (or plain output): use the HEAD hash directly.
        const headMatch = /^(\S+)\s+HEAD\s*$/m.exec(symref.stdout)
        return headMatch?.[1] !== undefined
          ? { head: headMatch[1], error: symref.error }
          : { error: 'no HEAD advertised by the git remote' }
      }
      const heads = await run(['ls-remote', url, `refs/heads/${branch}`])
      const headMatch = /^(\S+)\s+/.exec(heads.stdout)
      return headMatch?.[1] !== undefined
        ? { head: headMatch[1], branch }
        : { branch, error: 'no commit for the default branch' }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Check one plugin for updates and return the updated row. */
  async checkOne(entry: PluginEntry, profile = this.profileName()): Promise<PluginEntry> {
    const next: PluginEntry = { ...entry, state: 'checking' }
    if (entry.kind === 'local') {
      return { ...next, state: 'current', error: undefined, latest: entry.version }
    }
    if (entry.kind === 'git') {
      // The manifest's repository field first; for GitHub-installed plugins
      // whose manifest lacks one, derive the remote from the dependency spec
      // (github:/gitlab:/bitbucket: shorthands and git+https URLs).
      const url = entry.repository ?? specToRepositoryUrl(entry.spec)
      if (url === undefined) {
        return { ...next, state: 'error', error: 'git dependency without a resolvable repository URL' }
      }
      const remote = await this.gitRemoteHead(url, profile)
      if (remote.head === undefined) {
        return { ...next, state: 'error', error: remote.error ?? 'git check failed' }
      }
      const current = entry.gitHead?.slice(0, 7) ?? entry.version
      const latest = remote.head.slice(0, 7)
      return {
        ...next,
        repository: entry.repository ?? url,
        latest,
        latestGitHead: remote.head,
        latestSource: 'git',
        state: entry.gitHead === remote.head ? 'current' : 'outdated',
      }
    }
    // Registry dependency.
    const result = await this.registryLatest(entry.name)
    if (result.version === undefined) {
      return { ...next, state: 'error', error: result.error ?? 'registry check failed' }
    }
    const comparison = compareVersions(result.version, entry.version)
    return {
      ...next,
      latest: result.version,
      latestSource: 'registry',
      state: comparison <= 0 ? 'current' : 'outdated',
    }
  }

  /** Run update checks (all plugins or the named subset), limited concurrency. */
  async checkUpdates(request?: CheckRequest, profile = this.profileName()): Promise<PluginEntry[]> {
    let entries = this.listPlugins(profile)
    if (request?.names !== undefined && request.names.length > 0) {
      const wanted = new Set(request.names)
      entries = entries.filter((entry) => wanted.has(entry.name))
    }
    const queue = [...entries]
    const results: PluginEntry[] = []
    const workers = Array.from({ length: Math.min(CHECK_CONCURRENCY, queue.length) }, async () => {
      for (;;) {
        const entry = queue.shift()
        if (entry === undefined) return
        results.push(await this.checkOne(entry, profile))
      }
    })
    await Promise.all(workers)
    // Preserve dependency order.
    const byName = new Map(results.map((entry) => [entry.name, entry]))
    return entries.map((entry) => byName.get(entry.name) ?? entry)
  }

  /** Checked views for one profile (or every managed profile when omitted). */
  async checkProfileViews(profile?: string): Promise<Array<{ profile: ProfileSummary; plugins: PluginEntry[] }>> {
    const targets = profile !== undefined && profile !== '' ? [profile] : this.profiles()
    const views: Array<{ profile: ProfileSummary; plugins: PluginEntry[] }> = []
    for (const target of targets) {
      views.push({ profile: this.summary(target), plugins: await this.checkUpdates(undefined, target) })
    }
    return views
  }

  /**
   * The pnpm argument list for updating one plugin to its newest version.
   *
   * Registry packages are pinned to the EXACT version the registry reports as
   * latest, never `@latest`: pnpm 11's supply-chain release-age policy
   * (default minimumReleaseAge = 1 day) resolves the `latest` tag to the
   * newest release older than the age gate, which for fast-moving plugins can
   * be a downgrade from the installed version. An explicit version installs
   * as requested (pnpm records it in minimumReleaseAgeExclude), matching what
   * a manual `pnpm add pkg@<version>` update would do. A version at or below
   * the installed one is refused.
   */
  private async updateArgs(name: string, spec: string, profile: string): Promise<string[] | undefined> {
    if (classifySpec(spec) === 'local') return undefined
    if (classifySpec(spec) === 'git') return ['up', name]
    const latest = await this.registryLatest(name)
    if (latest.version === undefined) {
      throw new Error(`cannot resolve the newest version of '${name}': ${latest.error ?? 'registry check failed'}`)
    }
    const meta = this.readPackageMeta(name, profile)
    if (meta !== undefined && compareVersions(latest.version, meta.version) <= 0) {
      throw new Error(`'${name}' is already at the newest available version (${meta.version})`)
    }
    return ['add', `${name}@${latest.version}`, '--save-exact']
  }

  /** Update one plugin through pnpm (throws on failure details). */
  async updatePlugin(name: string, profile = this.profileName()): Promise<UpdateResult> {
    assertSafePackageName(name)
    const dir = this.profileDir(profile)
    const existing = activeOperations.get(dir)
    if (existing !== undefined) {
      throw new Error(`another profile operation is already running in profile '${profile}' (${existing})`)
    }
    const manifest = this.readProfileManifest(profile)
    const spec = manifest?.dependencies[name]
    if (spec === undefined) throw new Error(`package '${name}' is not a dependency of profile '${profile}'`)
    // The in-flight lock must be taken before the first await: updateArgs
    // resolves the target version over the network, and a second operation
    // could otherwise slip through the check during that window and run pnpm
    // concurrently in the same profile directory.
    activeOperations.set(dir, name)
    const started = Date.now()
    try {
      const args = await this.updateArgs(name, spec, profile)
      if (args === undefined) {
        throw new Error(`'${name}' is installed as a local link — update it in its source directory`)
      }
      const pnpm = this.pnpmPath()
      if (pnpm === undefined) {
        throw new Error('pnpm not found — install pnpm or set the pnpm path in the plugin settings')
      }
      const result = await this.spawn(pnpm, args, {
        cwd: dir,
        timeoutMs: 10 * 60_000,
        env: this.spawnEnv(dir),
      })
      const output = [result.stdout, result.stderr].filter((part) => part !== '').join('\n')
      const ok = result.exitCode === 0
      return {
        name,
        ok,
        output: output === '' ? `pnpm exited with code ${String(result.exitCode)}` : output,
        durationMs: Date.now() - started,
        error: result.error ?? (ok ? undefined : `pnpm exited with code ${String(result.exitCode)}`),
      }
    } finally {
      activeOperations.delete(dir)
    }
  }

  /** Drop a removed dependency from the profile's bundle layer list. */
  private reconcileBundlesAfterRemoval(name: string, profile: string): void {
    const manifestPath = join(this.profileDir(profile), 'package.json')
    if (!existsSync(manifestPath)) return
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        dsh?: { profile?: { bundles?: string[] } }
      }
      const bundles = manifest.dsh?.profile?.bundles
      if (bundles === undefined || !bundles.includes(name)) return
      manifest.dsh = {
        ...manifest.dsh,
        profile: {
          ...manifest.dsh?.profile,
          bundles: bundles.filter((entry) => entry !== name),
        },
      }
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    } catch {
      // Manifest rewrite is best-effort: a failed sync leaves the name in the
      // bundle list, which the dsh CLI reconciles away on the next plugin
      // command anyway.
    }
  }

  /** Remove one plugin from the profile through pnpm (throws on failure). */
  async removePlugin(name: string, profile = this.profileName()): Promise<UpdateResult> {
    assertSafePackageName(name)
    const dir = this.profileDir(profile)
    const existing = activeOperations.get(dir)
    if (existing !== undefined) {
      throw new Error(`another profile operation is already running in profile '${profile}' (${existing})`)
    }
    const manifest = this.readProfileManifest(profile)
    if (manifest?.dependencies[name] === undefined) {
      throw new Error(`package '${name}' is not a dependency of profile '${profile}'`)
    }
    const pnpm = this.pnpmPath()
    if (pnpm === undefined) {
      throw new Error('pnpm not found — install pnpm or set the pnpm path in the plugin settings')
    }
    activeOperations.set(dir, `remove:${name}`)
    const started = Date.now()
    try {
      const result = await this.spawn(pnpm, ['remove', name], {
        cwd: dir,
        timeoutMs: 10 * 60_000,
        env: this.spawnEnv(dir),
      })
      const output = [result.stdout, result.stderr].filter((part) => part !== '').join('\n')
      const ok = result.exitCode === 0
      if (ok) this.reconcileBundlesAfterRemoval(name, profile)
      return {
        name,
        ok,
        output: output === '' ? `pnpm exited with code ${String(result.exitCode)}` : output,
        durationMs: Date.now() - started,
        error: result.error ?? (ok ? undefined : `pnpm exited with code ${String(result.exitCode)}`),
      }
    } finally {
      activeOperations.delete(dir)
    }
  }

  /** Update every plugin whose last check said `outdated` in one profile. */
  async updateAll(profile = this.profileName()): Promise<UpdateResult[]> {
    const outdated = (await this.checkUpdates(undefined, profile)).filter((entry) => entry.state === 'outdated')
    const results: UpdateResult[] = []
    for (const entry of outdated) {
      try {
        results.push(await this.updatePlugin(entry.name, profile))
      } catch (error) {
        results.push({
          name: entry.name,
          ok: false,
          output: '',
          durationMs: 0,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return results
  }
}
