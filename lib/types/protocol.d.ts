/**
 * Shared protocol between the host half (routes/tools) and the browser half
 * (api client): API paths and payload types. Spelled in one file so the two
 * halves cannot drift.
 * @module dsh-plugin-manager/protocol
 */
/** The /api route family this plugin owns. */
export declare const PLUGIN_MANAGER_API: {
    /** GET/POST — profile summary + installed plugin rows (POST adds an update check). */
    readonly list: "/api/dsh-plugin-manager/list";
    /** POST {names?} — run update checks for every plugin (or the named subset). */
    readonly check: "/api/dsh-plugin-manager/check";
    /** POST {name} — update one plugin to its latest version through pnpm. */
    readonly update: "/api/dsh-plugin-manager/update";
    /** POST — update every plugin that has a newer version. */
    readonly updateAll: "/api/dsh-plugin-manager/update-all";
    /** POST {name} — remove one plugin from the profile through pnpm. */
    readonly remove: "/api/dsh-plugin-manager/remove";
};
/** How a profile dependency is installed. */
export type PluginInstallKind = 'registry' | 'git' | 'local';
/** The update state of one plugin. */
export type PluginUpdateState = 'unknown' | 'checking' | 'current' | 'outdated' | 'error';
/** One installed third-party plugin as the manager sees it. */
export interface PluginEntry {
    /** Package name (dependency key in the profile package.json). */
    name: string;
    /** Version recorded in the profile package.json dependency spec (raw). */
    spec: string;
    /** Version actually installed in the profile node_modules. */
    version: string;
    /** Repository URL from the installed package manifest, when present. */
    repository: string | undefined;
    /** The package declares a `dsh.bundle.patch` (i.e. mounts plugin rows). */
    isBundle: boolean;
    /** How the dependency is installed. */
    kind: PluginInstallKind;
    /** gitHead recorded by pnpm/npm for git-installed packages. */
    gitHead: string | undefined;
    /** Latest version/target discovered by the last check. */
    latest: string | undefined;
    /** Latest git commit hash discovered by the last check (git deps). */
    latestGitHead: string | undefined;
    /** Where `latest` came from: the npm registry or the git remote. */
    latestSource: 'registry' | 'git' | undefined;
    /** Update state after the last check. */
    state: PluginUpdateState;
    /** Human-readable error from the last check/update, when any. */
    error: string | undefined;
}
/** Summary of the profile the manager operates on. */
export interface ProfileSummary {
    /** Profile name (e.g. `web`). */
    name: string;
    /** Absolute profile directory. */
    dir: string;
    /** Absolute pnpm binary that updates run through (or undefined when unknown). */
    pnpm: string | undefined;
    /** The npm registry used for version checks. */
    registry: string;
    /** True when another update is currently running (buttons stay disabled). */
    updating: boolean;
}
/** POST /check body. */
export interface CheckRequest {
    /** Restrict the check to these package names; omitted = all. */
    names?: string[];
}
/** POST /update body. */
export interface UpdateRequest {
    /** Package name to update. */
    name: string;
}
/** One update result. */
export interface UpdateResult {
    name: string;
    ok: boolean;
    /** Full captured stdout+stderr of the pnpm run. */
    output: string;
    /** Seconds the run took. */
    durationMs: number;
    error: string | undefined;
}
/** A pnpm child process spawn descriptor, injectable for tests. */
export interface SpawnResult {
    exitCode: number | null;
    stdout: string;
    stderr: string;
    error?: string;
}
