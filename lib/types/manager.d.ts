/**
 * Plugin manager core — framework-free service the host routes/tools wrap.
 *
 * Responsibilities: resolve the active dsh profile, project its third-party
 * dependencies (package.json deps) into plugin rows with installed version /
 * repository metadata, check for updates against the npm registry (registry
 * deps) or the git remote (git deps), and update plugins by running pnpm in
 * the profile directory. Only one update runs at a time.
 */
import type { CheckRequest, PluginEntry, PluginInstallKind, PluginUpdateState, ProfileSummary, SpawnResult, UpdateResult } from './protocol.ts';
/** The plugin settings the host surfaces (validated by schemastery in index.ts). */
export interface ManagerConfig {
    /** Profile to manage; empty = auto-detect (argv --profile, then `web`). */
    profile?: string;
    /** npm registry base URL for version checks. */
    registry?: string;
    /** Explicit pnpm binary path; empty = auto-detect. */
    pnpmPath?: string;
}
/** One child-process run, injectable for tests. */
export type SpawnFn = (command: string, args: string[], options: {
    cwd: string;
    timeoutMs: number;
    env: NodeJS.ProcessEnv;
}) => Promise<SpawnResult>;
/** Dependency injection for the manager (tests substitute filesystem/spawn). */
export interface ManagerDeps {
    /** Caller-configurable overrides (live value getter). */
    config: () => ManagerConfig;
    /** Child-process runner (defaults to node:child_process spawn). */
    spawn?: SpawnFn;
    /** Home directory base for profile discovery. */
    home?: string;
}
/** Default spawn implementation over node:child_process. */
export declare const defaultSpawn: SpawnFn;
/** Classify a profile dependency spec. */
export declare function classifySpec(spec: string): PluginInstallKind;
/**
 * Derive a browsable repository URL from a git dependency spec. Fallback for
 * git-installed plugins whose own manifest carries no `repository` field —
 * github:/gitlab:/bitbucket: shorthands and git+https URLs all resolve.
 */
export declare function specToRepositoryUrl(spec: string): string | undefined;
/** Locate the pnpm binary from explicit config, PATH, then known locations. */
export declare function findPnpm(explicit: string | undefined, env?: NodeJS.ProcessEnv): string | undefined;
/** The dsh plugin manager: one instance per host plugin apply. */
export declare class PluginManager {
    private readonly deps;
    private readonly spawn;
    private updating;
    /** pnpm absolute path, re-resolved on every use (config may change). */
    private lastPnpm;
    constructor(deps: ManagerDeps);
    /** The active profile name: config → argv --profile → env → `web`. */
    profileName(): string;
    /** Absolute profile directory. */
    profileDir(): string;
    /** The npm registry base URL (trailing slash trimmed). */
    registry(): string;
    /** Resolve the pnpm binary for update runs. */
    pnpmPath(): string | undefined;
    /** Read the profile manifest (undefined when the profile does not exist). */
    private readProfileManifest;
    /** Absolute directory of one installed dependency, or undefined. */
    private resolvePackageDir;
    /** Metadata of one installed dependency's own package.json. */
    private readPackageMeta;
    /**
     * The commit hash pnpm resolved for a git dependency, read from the
     * profile's pnpm-lock.yaml. pnpm 11 no longer records `gitHead` inside the
     * installed package.json, but the lockfile's importer entry carries the
     * commit-addressed tarball URL (`...tar.gz/<40-hex-hash>`).
     */
    private installedGitCommit;
    /** Project every profile dependency into a plugin row (no update checks). */
    listPlugins(): PluginEntry[];
    /** The live profile summary for the panel header. */
    summary(): ProfileSummary;
    /** Fetch the latest published version of one package from the registry. */
    private registryLatest;
    /** Resolve the git remote's default branch head for a repository URL. */
    private gitRemoteHead;
    /** Check one plugin for updates and return the updated row. */
    checkOne(entry: PluginEntry): Promise<PluginEntry>;
    /** Run update checks (all plugins or the named subset), limited concurrency. */
    checkUpdates(request?: CheckRequest): Promise<PluginEntry[]>;
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
    private updateArgs;
    /** Update one plugin through pnpm (throws on failure details). */
    updatePlugin(name: string): Promise<UpdateResult>;
    /** Drop a removed dependency from the profile's bundle layer list. */
    private reconcileBundlesAfterRemoval;
    /** Remove one plugin from the profile through pnpm (throws on failure). */
    removePlugin(name: string): Promise<UpdateResult>;
    /** Update every plugin whose last check said `outdated`, sequentially. */
    updateAll(): Promise<UpdateResult[]>;
}
/** Re-export the update-state type for type-only imports elsewhere. */
export type { PluginUpdateState };
