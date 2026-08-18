import { createRequire } from "node:module";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "schemastery";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";
//#region src/manager.ts
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
/** Cached registry latest-version lookups so repeated checks stay cheap. */
const registryCache = /* @__PURE__ */ new Map();
/** Registry cache TTL. */
const REGISTRY_CACHE_MS = 6e4;
/** Parallelism cap for update checks. */
const CHECK_CONCURRENCY = 6;
/** In-flight operations, one per profile directory (value = operation label). */
const activeOperations = /* @__PURE__ */ new Map();
/** The package name this manager identifies itself as for auto-detection. */
const SELF_PACKAGE = "dsh-plugin-manager";
/** Whether the target platform runs Windows (spawn/candidates behave differently). */
const isWin = (platform) => platform === "win32";
/** Default spawn implementation over node:child_process. */
const defaultSpawn = (command, args, { cwd, timeoutMs, env }) => new Promise((resolveSpawn) => {
	const child = spawn(command, args, {
		cwd,
		env,
		stdio: [
			"ignore",
			"pipe",
			"pipe"
		],
		shell: isWin(process.platform)
	});
	let stdout = "";
	let stderr = "";
	let settled = false;
	const timer = setTimeout(() => {
		if (settled) return;
		settled = true;
		child.kill("SIGKILL");
		resolveSpawn({
			exitCode: null,
			stdout,
			stderr,
			error: `timed out after ${timeoutMs} ms`
		});
	}, timeoutMs);
	child.stdout.on("data", (chunk) => {
		stdout += chunk.toString("utf8");
	});
	child.stderr.on("data", (chunk) => {
		stderr += chunk.toString("utf8");
	});
	child.on("error", (error) => {
		if (settled) return;
		settled = true;
		clearTimeout(timer);
		resolveSpawn({
			exitCode: null,
			stdout,
			stderr,
			error: error.message
		});
	});
	child.on("close", (exitCode) => {
		if (settled) return;
		settled = true;
		clearTimeout(timer);
		resolveSpawn({
			exitCode,
			stdout,
			stderr
		});
	});
});
/** Rough semver-aware compare: >0 newer, <0 older, 0 equal. */
function compareVersions(a, b) {
	const pa = a.split(/[.+-]/);
	const pb = b.split(/[.+-]/);
	const len = Math.max(pa.length, pb.length);
	for (let i = 0; i < len; i++) {
		const va = pa[i] ?? "";
		const vb = pb[i] ?? "";
		if (va === vb) continue;
		const na = Number(va);
		const nb = Number(vb);
		if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na > nb ? 1 : -1;
		return va > vb ? 1 : -1;
	}
	return 0;
}
/** Classify a profile dependency spec. */
function classifySpec(spec) {
	if (/^(link|file|workspace|portal):/.test(spec)) return "local";
	if (/^git[+]|^github:|^gitlab:|^bitbucket:|[.]git(?:#|$)/.test(spec)) return "git";
	return "registry";
}
/**
* Derive a browsable repository URL from a git dependency spec. Fallback for
* git-installed plugins whose own manifest carries no `repository` field —
* github:/gitlab:/bitbucket: shorthands and git+https URLs all resolve.
*/
function specToRepositoryUrl(spec) {
	const shorthand = /^(github|gitlab|bitbucket):([^#/]+)\/([^#]+)/.exec(spec);
	if (shorthand?.[1] !== void 0 && shorthand[2] !== void 0 && shorthand[3] !== void 0) return `https://${{
		github: "github.com",
		gitlab: "gitlab.com",
		bitbucket: "bitbucket.org"
	}[shorthand[1]]}/${shorthand[2]}/${shorthand[3].replace(/[.]git$/, "")}`;
	return /^(?:git\+)?(https?:\/\/\S+?)(?:#\S*)?$/.exec(spec)?.[1]?.replace(/[.]git$/, "");
}
/** Platform-aware PATH separator and well-known package-manager locations. */
function platformPathSpec(platform) {
	if (platform === "win32") {
		const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
		const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
		const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
		return {
			separator: ";",
			extras: [
				join(appData, "npm"),
				join(localAppData, "pnpm"),
				join(programFiles, "nodejs")
			]
		};
	}
	return {
		separator: ":",
		extras: [
			"/opt/homebrew/bin",
			"/usr/local/bin",
			"/usr/bin",
			"/bin",
			join(homedir(), "Library", "pnpm"),
			join(homedir(), ".local", "share", "pnpm")
		]
	};
}
/** Locate the pnpm binary from explicit config, PATH, then known locations. */
function findPnpm(explicit, env = process.env, platform = process.platform) {
	if (explicit !== void 0 && explicit !== "") {
		if (existsSync(explicit)) return resolve(explicit);
		return;
	}
	const { separator, extras } = platformPathSpec(platform);
	const pathDirs = (env.PATH ?? "").split(separator).filter((entry) => entry !== "");
	const candidateNames = isWin(platform) ? ["pnpm", "pnpm.cmd"] : ["pnpm"];
	const candidates = [...pathDirs.flatMap((dir) => candidateNames.map((name) => join(dir, name))), ...extras.flatMap((dir) => candidateNames.map((name) => join(dir, name)))];
	for (const candidate of candidates) if (candidate !== "" && existsSync(candidate)) return resolve(candidate);
}
/**
* Merge common binary dirs into a PATH so GUI-spawned shells still find
* pnpm/git. Platform-aware: `;` separator and npm/pnpm/nodejs locations on
* Windows, brew/usr locations elsewhere.
*/
function widenedPath(base = process.env, platform = process.platform) {
	const { separator, extras } = platformPathSpec(platform);
	const seen = new Set((base.PATH ?? "").split(separator).filter((entry) => entry !== ""));
	for (const dir of extras) if (!seen.has(dir) && existsSync(dir)) seen.add(dir);
	return [...seen].join(separator);
}
/**
* Acceptable package-name shape for command lines. Registry package names and
* scoped names fit this; anything outside it (whitespace, shell metacharacters)
* is refused before it can reach a spawned shell.
*/
const SAFE_PACKAGE_NAME = /^[A-Za-z0-9@._/-]+$/;
/** Validate a package name before it reaches a spawn argument list. */
function assertSafePackageName(name) {
	if (!SAFE_PACKAGE_NAME.test(name)) throw new Error(`refusing package name ${JSON.stringify(name)}: characters outside [A-Za-z0-9@._/-] are not allowed`);
}
/**
* The dsh plugin manager. One instance per host plugin apply; methods take an
* optional profile name (default: the current profile this host booted).
*/
var PluginManager = class {
	deps;
	spawn;
	/** pnpm absolute path, re-resolved on every use (config may change). */
	lastPnpm;
	constructor(deps) {
		this.deps = deps;
		this.spawn = deps.spawn ?? defaultSpawn;
	}
	/** The home directory this manager operates under. */
	homeBase() {
		return this.deps.home ?? homedir();
	}
	/** The active profile name: config → argv --profile → env → `web`. */
	profileName() {
		const configured = this.deps.config().profile;
		if (configured !== void 0 && configured !== "") return configured;
		const argv = process.argv;
		for (let i = 0; i < argv.length - 1; i++) if (argv[i] === "--profile" && argv[i + 1] !== "") return argv[i + 1];
		const env = process.env.DSH_PROFILE;
		if (env !== void 0 && env !== "") return env;
		return "web";
	}
	/** Absolute directory of one profile (default: the current one). */
	profileDir(profile = this.profileName()) {
		return join(this.homeBase(), ".dsh", "profiles", profile);
	}
	/**
	* The profiles this manager manages, in order: explicit `profiles` config,
	* then the single `profile` config, then auto-detection — the profiles that
	* mount this plugin (its dependency), falling back to every profile that
	* exists, then to the current profile.
	*/
	profiles() {
		const configured = this.deps.config().profiles;
		if (configured !== void 0 && configured.length > 0) return [...configured];
		const single = this.deps.config().profile;
		if (single !== void 0 && single !== "") return [single];
		return this.detectProfiles();
	}
	/** Scan ~/.dsh/profiles for profiles that exist / host this plugin. */
	detectProfiles() {
		const base = join(this.homeBase(), ".dsh", "profiles");
		let names = [];
		try {
			names = readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory() && existsSync(join(base, entry.name, "package.json"))).map((entry) => entry.name);
		} catch {}
		const hosting = names.filter((name) => this.profileHasSelf(name));
		if (hosting.length > 0) return hosting;
		if (names.length > 0) return names;
		return [this.profileName()];
	}
	/** Whether a profile's dependencies include this plugin. */
	profileHasSelf(name) {
		try {
			const manifest = JSON.parse(readFileSync(join(this.homeBase(), ".dsh", "profiles", name, "package.json"), "utf8"));
			return typeof manifest.dependencies === "object" && manifest.dependencies !== null && SELF_PACKAGE in manifest.dependencies;
		} catch {
			return false;
		}
	}
	/** The npm registry base URL (trailing slash trimmed). */
	registry() {
		const configured = this.deps.config().registry;
		if (configured !== void 0 && configured !== "") return configured.replace(/\/+$/, "");
		return "https://registry.npmjs.org";
	}
	/** Resolve the pnpm binary for update runs. */
	pnpmPath() {
		const explicit = this.deps.config().pnpmPath;
		this.lastPnpm = findPnpm(explicit);
		return this.lastPnpm;
	}
	/**
	* The store-dir a profile's node_modules was linked against, read from
	* pnpm's `.modules.yaml`. GUI-host processes can resolve a different
	* default store than the shell that installed the profile; pinning the
	* spawned pnpm to the recorded store avoids "linked with a different pnpm
	* store" failures.
	*/
	storeDir(dir) {
		const modulesYaml = join(dir, "node_modules", ".modules.yaml");
		if (!existsSync(modulesYaml)) return void 0;
		try {
			return /["']storeDir["']\s*:\s*["']([^"']+)["']/.exec(readFileSync(modulesYaml, "utf8"))?.[1];
		} catch {
			return;
		}
	}
	/** Spawn env for pnpm/git: widened PATH plus the profile's pinned store. */
	spawnEnv(dir) {
		const env = {
			...process.env,
			PATH: widenedPath()
		};
		const storeDir = this.storeDir(dir);
		if (storeDir !== void 0) env.npm_config_store_dir = storeDir;
		return env;
	}
	/** Read the profile manifest (undefined when the profile does not exist). */
	readProfileManifest(profile = this.profileName()) {
		const manifestPath = join(this.profileDir(profile), "package.json");
		if (!existsSync(manifestPath)) return void 0;
		try {
			const deps = JSON.parse(readFileSync(manifestPath, "utf8")).dependencies;
			if (typeof deps !== "object" || deps === null) return { dependencies: {} };
			return { dependencies: deps };
		} catch {
			return;
		}
	}
	/** Absolute directory of one installed dependency, or undefined. */
	resolvePackageDir(name, profile = this.profileName()) {
		try {
			const manifestPath = createRequire(join(this.profileDir(profile), "package.json")).resolve(`${name}/package.json`);
			return dirname(manifestPath);
		} catch {
			return;
		}
	}
	/** Metadata of one installed dependency's own package.json. */
	readPackageMeta(name, profile = this.profileName()) {
		const dir = this.resolvePackageDir(name, profile);
		if (dir === void 0) return void 0;
		const manifestPath = join(dir, "package.json");
		if (!existsSync(manifestPath)) return void 0;
		try {
			const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
			const repository = manifest.repository;
			let repoUrl;
			if (typeof repository === "string") repoUrl = repository;
			else if (typeof repository === "object" && repository !== null) {
				const url = repository.url;
				if (typeof url === "string") repoUrl = url;
			}
			if (repoUrl !== void 0) repoUrl = repoUrl.replace(/^git[+]/, "").replace(/#.*$/, "").replace(/[.]git$/, "");
			const dsh = manifest.dsh;
			return {
				version: typeof manifest.version === "string" ? manifest.version : "unknown",
				repository: repoUrl,
				gitHead: typeof manifest.gitHead === "string" ? manifest.gitHead : void 0,
				isBundle: dsh?.bundle?.patch !== void 0
			};
		} catch {
			return;
		}
	}
	/**
	* The commit hash pnpm resolved for a git dependency, read from the
	* profile's pnpm-lock.yaml. pnpm 11 no longer records `gitHead` inside the
	* installed package.json, but the lockfile's importer entry carries the
	* commit-addressed tarball URL (`...tar.gz/<40-hex-hash>`).
	*/
	installedGitCommit(name, profile = this.profileName()) {
		const lockPath = join(this.profileDir(profile), "pnpm-lock.yaml");
		if (!existsSync(lockPath)) return void 0;
		const text = readFileSync(lockPath, "utf8");
		const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const version = new RegExp(`^\\s{6}${escaped}:\\n(?:\\s{8}[^:\\n]+:[^\\n]*\\n)*?\\s{8}version: (\\S+)`, "m").exec(text)?.[1];
		if (version === void 0) return void 0;
		return /(?:tar\.gz\/|\.git#)([0-9a-f]{40})$/.exec(version)?.[1];
	}
	/** Project every profile dependency into a plugin row (no update checks). */
	listPlugins(profile = this.profileName()) {
		const manifest = this.readProfileManifest(profile);
		if (manifest === void 0) return [];
		return Object.entries(manifest.dependencies).map(([name, spec]) => {
			const meta = this.readPackageMeta(name, profile);
			return {
				name,
				spec,
				version: meta?.version ?? "unknown",
				repository: meta?.repository ?? specToRepositoryUrl(spec),
				isBundle: meta?.isBundle ?? false,
				kind: classifySpec(spec),
				gitHead: meta?.gitHead ?? this.installedGitCommit(name, profile),
				latest: void 0,
				latestGitHead: void 0,
				latestSource: void 0,
				state: "unknown",
				error: void 0
			};
		});
	}
	/** The live profile summary for the panel header. */
	summary(profile = this.profileName()) {
		const dir = this.profileDir(profile);
		return {
			name: profile,
			dir,
			pnpm: this.pnpmPath(),
			registry: this.registry(),
			updating: activeOperations.has(dir)
		};
	}
	/** One profile view (summary + plugin rows) for the panel / tools. */
	profileView(profile = this.profileName()) {
		return {
			profile: this.summary(profile),
			plugins: this.listPlugins(profile)
		};
	}
	/** Views for every managed profile. */
	allProfileViews() {
		return this.profiles().map((profile) => this.profileView(profile));
	}
	/** Fetch the latest published version of one package from the registry. */
	async registryLatest(name) {
		const cacheKey = `${this.registry()}\u0000${name}`;
		const cached = registryCache.get(cacheKey);
		if (cached !== void 0 && Date.now() - cached.at < REGISTRY_CACHE_MS) return {
			version: cached.version,
			error: cached.error
		};
		let result;
		try {
			const url = `${this.registry()}/${name.replace("/", "%2f")}/latest`;
			const response = await fetch(url, {
				signal: AbortSignal.timeout(2e4),
				headers: { accept: "application/json" }
			});
			if (!response.ok) result = { error: `registry HTTP ${response.status}` };
			else {
				const body = await response.json();
				result = typeof body.version === "string" ? { version: body.version } : { error: "registry returned no version" };
			}
		} catch (error) {
			result = { error: error instanceof Error ? error.message : String(error) };
		}
		registryCache.set(cacheKey, {
			at: Date.now(),
			...result
		});
		return result;
	}
	/** Resolve the git remote's default branch head for a repository URL. */
	async gitRemoteHead(url, profile = this.profileName()) {
		const run = async (args) => this.spawn("git", args, {
			cwd: this.profileDir(profile),
			timeoutMs: 25e3,
			env: this.spawnEnv(this.profileDir(profile))
		});
		try {
			const symref = await run([
				"ls-remote",
				"--symref",
				url,
				"HEAD"
			]);
			const refLine = symref.stdout.split("\n").find((line) => line.includes("ref:"));
			const branch = /ref:\s+refs\/heads\/(\S+)/.exec(refLine ?? "")?.[1];
			if (branch === void 0) {
				const headMatch = /^(\S+)\s+HEAD\s*$/m.exec(symref.stdout);
				return headMatch?.[1] !== void 0 ? {
					head: headMatch[1],
					error: symref.error
				} : { error: "no HEAD advertised by the git remote" };
			}
			const heads = await run([
				"ls-remote",
				url,
				`refs/heads/${branch}`
			]);
			const headMatch = /^(\S+)\s+/.exec(heads.stdout);
			return headMatch?.[1] !== void 0 ? {
				head: headMatch[1],
				branch
			} : {
				branch,
				error: "no commit for the default branch"
			};
		} catch (error) {
			return { error: error instanceof Error ? error.message : String(error) };
		}
	}
	/** Check one plugin for updates and return the updated row. */
	async checkOne(entry, profile = this.profileName()) {
		const next = {
			...entry,
			state: "checking"
		};
		if (entry.kind === "local") return {
			...next,
			state: "current",
			error: void 0,
			latest: entry.version
		};
		if (entry.kind === "git") {
			const url = entry.repository ?? specToRepositoryUrl(entry.spec);
			if (url === void 0) return {
				...next,
				state: "error",
				error: "git dependency without a resolvable repository URL"
			};
			const remote = await this.gitRemoteHead(url, profile);
			if (remote.head === void 0) return {
				...next,
				state: "error",
				error: remote.error ?? "git check failed"
			};
			entry.gitHead?.slice(0, 7) ?? entry.version;
			const latest = remote.head.slice(0, 7);
			return {
				...next,
				repository: entry.repository ?? url,
				latest,
				latestGitHead: remote.head,
				latestSource: "git",
				state: entry.gitHead === remote.head ? "current" : "outdated"
			};
		}
		const result = await this.registryLatest(entry.name);
		if (result.version === void 0) return {
			...next,
			state: "error",
			error: result.error ?? "registry check failed"
		};
		const comparison = compareVersions(result.version, entry.version);
		return {
			...next,
			latest: result.version,
			latestSource: "registry",
			state: comparison <= 0 ? "current" : "outdated"
		};
	}
	/** Run update checks (all plugins or the named subset), limited concurrency. */
	async checkUpdates(request, profile = this.profileName()) {
		let entries = this.listPlugins(profile);
		if (request?.names !== void 0 && request.names.length > 0) {
			const wanted = new Set(request.names);
			entries = entries.filter((entry) => wanted.has(entry.name));
		}
		const queue = [...entries];
		const results = [];
		const workers = Array.from({ length: Math.min(CHECK_CONCURRENCY, queue.length) }, async () => {
			for (;;) {
				const entry = queue.shift();
				if (entry === void 0) return;
				results.push(await this.checkOne(entry, profile));
			}
		});
		await Promise.all(workers);
		const byName = new Map(results.map((entry) => [entry.name, entry]));
		return entries.map((entry) => byName.get(entry.name) ?? entry);
	}
	/** Checked views for one profile (or every managed profile when omitted). */
	async checkProfileViews(profile) {
		const targets = profile !== void 0 && profile !== "" ? [profile] : this.profiles();
		const views = [];
		for (const target of targets) views.push({
			profile: this.summary(target),
			plugins: await this.checkUpdates(void 0, target)
		});
		return views;
	}
	/**
	* The pnpm argument list for updating one plugin to its newest version.
	*
	* Registry packages are pinned to the EXACT version the registry reports as
	* latest, never `@latest`: pnpm 11's supply-chain release-age policy
	* (default minimumReleaseAge = 1 day) resolves the `latest` tag to the
	* newest release older than the age gate, which for fast-moving plugins can
	* be a downgrade from the installed version. An explicit version installs
	* as requested, matching what a manual `pnpm add pkg@<version>` update
	* would do. A version at or below the installed one is refused.
	*
	* Both paths append `--config.minimumReleaseAge=0`: clicking update is the
	* user's explicit consent to the newest release, and a lockfile holding
	* other young transitive versions (e.g. a freshly-released web-ui-all sub
	* package) would otherwise make pnpm's re-resolution fail the whole run
	* with a policy rejection ("lockfile contains entries that the active
	* policies reject"), unrelated to the plugin being updated.
	*/
	async updateArgs(name, spec, profile) {
		if (classifySpec(spec) === "local") return void 0;
		if (classifySpec(spec) === "git") return [
			"up",
			name,
			"--config.minimumReleaseAge=0"
		];
		const latest = await this.registryLatest(name);
		if (latest.version === void 0) throw new Error(`cannot resolve the newest version of '${name}': ${latest.error ?? "registry check failed"}`);
		const meta = this.readPackageMeta(name, profile);
		if (meta !== void 0 && compareVersions(latest.version, meta.version) <= 0) throw new Error(`'${name}' is already at the newest available version (${meta.version})`);
		return [
			"add",
			`${name}@${latest.version}`,
			"--save-exact",
			"--config.minimumReleaseAge=0"
		];
	}
	/** Update one plugin through pnpm (throws on failure details). */
	async updatePlugin(name, profile = this.profileName()) {
		assertSafePackageName(name);
		const dir = this.profileDir(profile);
		const existing = activeOperations.get(dir);
		if (existing !== void 0) throw new Error(`another profile operation is already running in profile '${profile}' (${existing})`);
		const spec = this.readProfileManifest(profile)?.dependencies[name];
		if (spec === void 0) throw new Error(`package '${name}' is not a dependency of profile '${profile}'`);
		activeOperations.set(dir, name);
		const started = Date.now();
		try {
			const args = await this.updateArgs(name, spec, profile);
			if (args === void 0) throw new Error(`'${name}' is installed as a local link — update it in its source directory`);
			const pnpm = this.pnpmPath();
			if (pnpm === void 0) throw new Error("pnpm not found — install pnpm or set the pnpm path in the plugin settings");
			const result = await this.spawn(pnpm, args, {
				cwd: dir,
				timeoutMs: 6e5,
				env: this.spawnEnv(dir)
			});
			const output = [result.stdout, result.stderr].filter((part) => part !== "").join("\n");
			const ok = result.exitCode === 0;
			return {
				name,
				ok,
				output: output === "" ? `pnpm exited with code ${String(result.exitCode)}` : output,
				durationMs: Date.now() - started,
				error: result.error ?? (ok ? void 0 : `pnpm exited with code ${String(result.exitCode)}`)
			};
		} finally {
			activeOperations.delete(dir);
		}
	}
	/** Drop a removed dependency from the profile's bundle layer list. */
	reconcileBundlesAfterRemoval(name, profile) {
		const manifestPath = join(this.profileDir(profile), "package.json");
		if (!existsSync(manifestPath)) return;
		try {
			const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
			const bundles = manifest.dsh?.profile?.bundles;
			if (bundles === void 0 || !bundles.includes(name)) return;
			manifest.dsh = {
				...manifest.dsh,
				profile: {
					...manifest.dsh?.profile,
					bundles: bundles.filter((entry) => entry !== name)
				}
			};
			writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
		} catch {}
	}
	/** Remove one plugin from the profile through pnpm (throws on failure). */
	async removePlugin(name, profile = this.profileName()) {
		assertSafePackageName(name);
		const dir = this.profileDir(profile);
		const existing = activeOperations.get(dir);
		if (existing !== void 0) throw new Error(`another profile operation is already running in profile '${profile}' (${existing})`);
		if (this.readProfileManifest(profile)?.dependencies[name] === void 0) throw new Error(`package '${name}' is not a dependency of profile '${profile}'`);
		const pnpm = this.pnpmPath();
		if (pnpm === void 0) throw new Error("pnpm not found — install pnpm or set the pnpm path in the plugin settings");
		activeOperations.set(dir, `remove:${name}`);
		const started = Date.now();
		try {
			const result = await this.spawn(pnpm, [
				"remove",
				name,
				"--config.minimumReleaseAge=0"
			], {
				cwd: dir,
				timeoutMs: 6e5,
				env: this.spawnEnv(dir)
			});
			const output = [result.stdout, result.stderr].filter((part) => part !== "").join("\n");
			const ok = result.exitCode === 0;
			if (ok) this.reconcileBundlesAfterRemoval(name, profile);
			return {
				name,
				ok,
				output: output === "" ? `pnpm exited with code ${String(result.exitCode)}` : output,
				durationMs: Date.now() - started,
				error: result.error ?? (ok ? void 0 : `pnpm exited with code ${String(result.exitCode)}`)
			};
		} finally {
			activeOperations.delete(dir);
		}
	}
	/** Update every plugin whose last check said `outdated` in one profile. */
	async updateAll(profile = this.profileName()) {
		const outdated = (await this.checkUpdates(void 0, profile)).filter((entry) => entry.state === "outdated");
		const results = [];
		for (const entry of outdated) try {
			results.push(await this.updatePlugin(entry.name, profile));
		} catch (error) {
			results.push({
				name: entry.name,
				ok: false,
				output: "",
				durationMs: 0,
				error: error instanceof Error ? error.message : String(error)
			});
		}
		return results;
	}
};
//#endregion
//#region src/protocol.ts
/**
* Shared protocol between the host half (routes/tools) and the browser half
* (api client): API paths and payload types. Spelled in one file so the two
* halves cannot drift.
* @module dsh-plugin-manager/protocol
*/
/** The /api route family this plugin owns. */
const PLUGIN_MANAGER_API = {
	/** GET/POST — profile summary + installed plugin rows (POST adds an update check). */
	list: "/api/dsh-plugin-manager/list",
	/** POST {names?} — run update checks for every plugin (or the named subset). */
	check: "/api/dsh-plugin-manager/check",
	/** POST {name} — update one plugin to its latest version through pnpm. */
	update: "/api/dsh-plugin-manager/update",
	/** POST — update every plugin that has a newer version. */
	updateAll: "/api/dsh-plugin-manager/update-all",
	/** POST {name} — remove one plugin from the profile through pnpm. */
	remove: "/api/dsh-plugin-manager/remove"
};
//#endregion
//#region src/routes.ts
/** Cap on JSON request bodies (update/check payloads are tiny). */
const MAX_JSON_BODY_BYTES = 16384;
/** Loopback literal check plus browser same-origin markers. */
function isLoopbackRequest(request) {
	const address = request.socket.remoteAddress;
	if (address !== "127.0.0.1" && address !== "::1" && address !== "::ffff:127.0.0.1") return false;
	const host = request.headers.host;
	if (typeof host !== "string") return false;
	let hostUrl;
	try {
		hostUrl = new URL(`http://${host}`);
	} catch {
		return false;
	}
	if (hostUrl.hostname !== "127.0.0.1" && hostUrl.hostname !== "localhost" && hostUrl.hostname !== "[::1]") return false;
	if (request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
/** One JSON response. */
function writeJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"referrer-policy": "no-referrer"
	});
	res.end(payload);
}
/** Read a JSON request body (undefined when too large or unparseable). */
async function readJsonBody(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = chunk;
		size += buffer.length;
		if (size > MAX_JSON_BODY_BYTES) return void 0;
		chunks.push(buffer);
	}
	try {
		const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		return typeof parsed === "object" && parsed !== null ? parsed : void 0;
	} catch {
		return;
	}
}
/**
* Build every /api/dsh-plugin-manager route (exact paths).
* @param manager - the plugin manager service.
* @returns the routes to register on the web server.
*/
function makeRoutes(manager) {
	/** Guard helper: fence + method check. */
	const guard = (req, res, method) => {
		if (!isLoopbackRequest(req)) {
			writeJson(res, 403, { error: "forbidden: loopback-only" });
			return false;
		}
		if (req.method !== method) {
			writeJson(res, 405, { error: `method not allowed: ${req.method ?? "unknown"}` });
			return false;
		}
		return true;
	};
	return [
		{
			kind: "exact",
			path: PLUGIN_MANAGER_API.list,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				const profile = new URL(req.url ?? "/", "http://localhost").searchParams.get("profile") ?? void 0;
				try {
					writeJson(res, 200, { profiles: profile !== void 0 && profile !== "" ? [manager.profileView(profile)] : manager.allProfileViews() });
				} catch (error) {
					writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
				}
			}
		},
		{
			kind: "exact",
			path: PLUGIN_MANAGER_API.check,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				const body = await readJsonBody(req);
				const names = Array.isArray(body?.names) ? body.names.filter((x) => typeof x === "string") : void 0;
				const profile = typeof body?.profile === "string" && body.profile !== "" ? body.profile : void 0;
				const request = {
					...names !== void 0 ? { names } : {},
					...profile !== void 0 ? { profile } : {}
				};
				try {
					writeJson(res, 200, { profiles: await manager.checkProfileViews(request.profile) });
				} catch (error) {
					writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
				}
			}
		},
		{
			kind: "exact",
			path: PLUGIN_MANAGER_API.update,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				const body = await readJsonBody(req);
				const name = typeof body?.name === "string" ? body.name : "";
				if (name === "") {
					writeJson(res, 400, { error: "name is required" });
					return;
				}
				const request = {
					name,
					...typeof body?.profile === "string" && body.profile !== "" ? { profile: body.profile } : {}
				};
				try {
					writeJson(res, 200, { result: await manager.updatePlugin(request.name, request.profile) });
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					writeJson(res, message.startsWith("another profile operation") ? 409 : 400, { error: message });
				}
			}
		},
		{
			kind: "exact",
			path: PLUGIN_MANAGER_API.updateAll,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				const body = await readJsonBody(req);
				const request = { ...typeof body?.profile === "string" && body.profile !== "" ? { profile: body.profile } : {} };
				try {
					writeJson(res, 200, { results: await manager.updateAll(request.profile) });
				} catch (error) {
					writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
				}
			}
		},
		{
			kind: "exact",
			path: PLUGIN_MANAGER_API.remove,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				const body = await readJsonBody(req);
				const name = typeof body?.name === "string" ? body.name : "";
				if (name === "") {
					writeJson(res, 400, { error: "name is required" });
					return;
				}
				const request = {
					name,
					...typeof body?.profile === "string" && body.profile !== "" ? { profile: body.profile } : {}
				};
				try {
					writeJson(res, 200, { result: await manager.removePlugin(request.name, request.profile) });
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					writeJson(res, message.startsWith("another profile operation") ? 409 : 400, { error: message });
				}
			}
		}
	];
}
//#endregion
//#region src/tools.ts
/**
* Agent tools: let the dsh agent list installed third-party plugins across
* every managed profile, check them for updates, and update/remove them — the
* same service the web panel uses, so an update started in the GUI is visible
* to the agent and vice versa. Every tool accepts an optional `profile`
* parameter (default: every managed profile / the current profile).
*/
/** One text content block (the only render shape these tools emit). */
function text(value) {
	return [{
		type: "text",
		text: value
	}];
}
/** Render one plugin row for the agent. */
function renderRow(entry) {
	const parts = [
		entry.name,
		entry.version,
		entry.latest ?? "-",
		entry.state
	];
	if (entry.repository !== void 0) parts.push(entry.repository);
	if (entry.error !== void 0) parts.push(entry.error);
	return parts.join(" | ");
}
/** Render one profile's plugin rows with a header. */
function renderView(view) {
	const header = `profile: ${view.profile}`;
	if (view.plugins.length === 0) return `${header} — no third-party plugins installed`;
	return [
		header,
		"name | version | latest | state | repository | error",
		"--- | --- | --- | --- | --- | ---",
		...view.plugins.map((row) => renderRow(row))
	].join("\n");
}
/** The check tool: lists installed plugins and optionally checks for updates. */
function pluginCheckTool(manager) {
	return defineTool({
		name: "dsh_plugin_check",
		description: "List the third-party plugins installed in the managed dsh profiles with their versions and git repositories, and optionally check the npm registry / git remotes for newer versions. Triggers: plugin update status, check for plugin updates, list installed dsh plugins.",
		parameters: {
			check: {
				type: "boolean",
				description: "Also query the registry/git remotes for newer versions (default true)."
			},
			names: {
				type: "array",
				items: { type: "string" },
				description: "Optional package names to check instead of every plugin."
			},
			profile: {
				type: "string",
				description: "Restrict to one profile name (default: every managed profile)."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: { profiles: {
					type: "array",
					required: true,
					items: {
						type: "object",
						additionalProperties: false,
						properties: {
							profile: {
								type: "string",
								required: true
							},
							plugins: {
								type: "array",
								required: true,
								items: {
									type: "object",
									additionalProperties: false,
									properties: {
										name: {
											type: "string",
											required: true
										},
										version: {
											type: "string",
											required: true
										},
										latest: { type: "string" },
										state: {
											type: "string",
											enum: [
												"unknown",
												"current",
												"outdated",
												"error",
												"checking"
											],
											required: true
										},
										repository: { type: "string" },
										error: { type: "string" }
									}
								}
							}
						}
					}
				} }
			},
			render: (_args, value) => {
				if (value.profiles.length === 0) return text("no managed dsh profiles found");
				return text(value.profiles.map(renderView).join("\n\n"));
			}
		},
		async execute(args) {
			const target = args.profile !== void 0 && args.profile !== "" ? args.profile : void 0;
			if (args.check ?? true) return { profiles: (await manager.checkProfileViews(target)).map((view) => ({
				profile: view.profile.name,
				plugins: view.plugins.map((row) => ({
					name: row.name,
					version: row.version,
					latest: row.latest,
					state: row.state,
					repository: row.repository,
					error: row.error
				}))
			})) };
			return { profiles: (target !== void 0 ? [manager.profileView(target)] : manager.allProfileViews()).map((view) => ({
				profile: view.profile.name,
				plugins: view.plugins.map((row) => ({
					name: row.name,
					version: row.version,
					latest: row.latest,
					state: row.state,
					repository: row.repository,
					error: row.error
				}))
			})) };
		}
	});
}
/** The update tool: updates one plugin (or every outdated plugin). */
function pluginUpdateTool(manager) {
	return defineTool({
		name: "dsh_plugin_update",
		description: "Update one installed third-party dsh plugin to its latest version by running pnpm in the profile directory (or update every outdated plugin when no name is given). Requires pnpm on the host and network access. Host-side plugin code reloads only after dsh restarts. Triggers: update a plugin, upgrade plugins.",
		parameters: {
			name: {
				type: "string",
				description: "Package name to update; omit to update every outdated plugin."
			},
			profile: {
				type: "string",
				description: "Profile to update in (default: the current profile)."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: { results: {
					type: "array",
					required: true,
					items: {
						type: "object",
						additionalProperties: false,
						properties: {
							name: {
								type: "string",
								required: true
							},
							ok: {
								type: "boolean",
								required: true
							},
							output: {
								type: "string",
								required: true
							},
							durationMs: {
								type: "integer",
								required: true
							},
							error: { type: "string" }
						}
					}
				} }
			},
			render: (_args, value) => {
				const results = value.results;
				if (results.length === 0) return text("nothing to update");
				return text(results.map((result) => {
					const status = result.ok ? "ok" : "failed";
					const tail = result.error !== void 0 ? ` (${result.error})` : "";
					return `${result.name}: ${status}${tail}\n${result.output}`.trim();
				}).join("\n\n"));
			}
		},
		async execute(args) {
			const profile = args.profile !== void 0 && args.profile !== "" ? args.profile : void 0;
			return { results: args.name !== void 0 && args.name !== "" ? [await manager.updatePlugin(args.name, profile)] : await manager.updateAll(profile) };
		}
	});
}
/** The remove tool: removes one installed third-party plugin from a profile. */
function pluginRemoveTool(manager) {
	return defineTool({
		name: "dsh_plugin_remove",
		description: "Remove one installed third-party dsh plugin from a profile by running pnpm in the profile directory. Host-side plugin code unloads only after dsh restarts. Requires pnpm on the host. Triggers: uninstall a plugin, remove a plugin, delete a dsh plugin.",
		parameters: {
			name: {
				type: "string",
				required: true,
				description: "Package name to remove from the profile."
			},
			profile: {
				type: "string",
				description: "Profile to remove from (default: the current profile)."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					name: {
						type: "string",
						required: true
					},
					ok: {
						type: "boolean",
						required: true
					},
					output: {
						type: "string",
						required: true
					},
					durationMs: {
						type: "integer",
						required: true
					},
					error: { type: "string" }
				}
			},
			render: (_args, value) => {
				const status = value.ok ? "removed" : "failed";
				const tail = value.error !== void 0 ? ` (${value.error})` : "";
				return text(`${value.name}: ${status}${tail}\n${value.output}`.trim());
			}
		},
		async execute(args) {
			const profile = args.profile !== void 0 && args.profile !== "" ? args.profile : void 0;
			return await manager.removePlugin(args.name, profile);
		}
	});
}
//#endregion
//#region src/index.ts
/** Stable cordis plugin name. */
const name = "plugin-manager";
/** Services required before the plugin surfaces can mount. */
const inject = [
	"webServer",
	"tools",
	"systemPrompt"
];
/**
* Settings namespace of the plugin manager — the section the web settings
* surface edits. Spelled here rather than imported: the browser half spells
* the same value and must not depend on a Host package.
*/
const PLUGIN_MANAGER_SETTINGS_NAMESPACE = settingsNamespace("dsh-plugin-manager");
const Config = z.object({
	profile: z.string().description("要管理的 profile 名称（留空自动检测，默认 web）。"),
	profiles: z.array(z.string()).description("要管理的 profile 列表（留空自动检测安装了本插件的所有 profile）。"),
	registry: z.string().description("npm registry 地址（默认 https://registry.npmjs.org）。"),
	pnpmPath: z.string().description("pnpm 可执行文件路径（留空自动检测）。"),
	enabled: z.boolean().default(true).description("插件总开关。"),
	announceToAgent: z.boolean().default(true).description("向 agent 公告本插件。")
});
/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 160;
/** Model-facing announcement: plugin presence, capabilities, and limits. */
const PLUGIN_MANAGER_GUIDANCE = "本机已安装 dsh-plugin-manager 插件（DSH 第三方插件管理器）：侧边栏「插件管理」入口；自动检测并管理所有安装了本插件的 dsh profile（如 web / desktop）中通过 pnpm 安装的第三方插件（包名/版本/git 仓库，含 GitHub 安装的插件），面板内可切换 profile。能力：dsh_plugin_check 列出已装插件并检测更新（npm registry 或 git ls-remote）、dsh_plugin_update 通过 pnpm 更新单个或全部可更新插件、dsh_plugin_remove 删除单个第三方插件（均可加 profile 参数指定 profile）；面板内可一键更新/删除。限制：更新/删除只改对应 profile 的依赖与 lock 文件；host 端新代码需重启 DSH 生效；需网络与 pnpm；本地 link 安装的插件需在源码目录自行更新。用户提到「插件更新 / 升级插件 / 检查插件版本 / 删除插件 / 卸载插件」时即指本插件，请据此协作。";
/**
* Mount the plugin manager service, routes, tools, and announcement.
* @param ctx - host plugin context carrying webServer/tools/systemPrompt.
* @param config - resolved plugin config (schema defaults applied by the loader).
*/
function apply(ctx, config) {
	let current = () => config ?? {};
	const resolve = () => ({
		...current(),
		enabled: current().enabled ?? true,
		announceToAgent: current().announceToAgent ?? true
	});
	const manager = new PluginManager({ config: resolve });
	let disposeRoutes;
	let disposeTools;
	let disposeSection;
	const sync = () => {
		if (disposeSection !== void 0) {
			disposeSection();
			disposeSection = void 0;
		}
		if (disposeRoutes !== void 0) {
			disposeRoutes();
			disposeRoutes = void 0;
		}
		if (disposeTools !== void 0) {
			disposeTools();
			disposeTools = void 0;
		}
		const value = resolve();
		if (!value.enabled) return;
		if (value.announceToAgent) disposeSection = ctx.systemPrompt.section({
			name: "plugin:dsh-plugin-manager",
			order: SECTION_ORDER,
			text: PLUGIN_MANAGER_GUIDANCE
		});
		const routes = makeRoutes(manager);
		disposeRoutes = ctx.effect(() => {
			const disposers = routes.map((route) => ctx.webServer.register(route));
			return () => {
				for (const dispose of disposers) dispose();
			};
		}, "dsh-plugin-manager: routes");
		const tools = [
			pluginCheckTool(manager),
			pluginUpdateTool(manager),
			pluginRemoveTool(manager)
		];
		disposeTools = ctx.effect(() => {
			const disposers = tools.map((tool) => ctx.tools.register(tool));
			return () => {
				for (const dispose of disposers) dispose();
			};
		}, "dsh-plugin-manager: tools");
	};
	installSettingsSection(ctx, PLUGIN_MANAGER_SETTINGS_NAMESPACE, Config, config ?? {}, {
		setSource: (source) => {
			current = source;
			sync();
		},
		onChange: sync
	});
	sync();
}
//#endregion
export { Config, PLUGIN_MANAGER_SETTINGS_NAMESPACE, PluginManager, apply, classifySpec, findPnpm, inject, name, specToRepositoryUrl };
