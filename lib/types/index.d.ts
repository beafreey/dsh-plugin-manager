/**
 * dsh-plugin-manager — host half. Mounts the plugin manager service (profile
 * scan, npm/git update checks, pnpm-backed updates), the /api/dsh-plugin-manager
 * route family, the agent tools (dsh_plugin_check, dsh_plugin_update), and a
 * system-prompt announcement. The browser half (./client) renders the sidebar
 * entry and the management panel. Everything rides official NPM SDK packages —
 * no dsh source changes.
 */
import type { Context } from '@deepseek-ai/cordis';
import z from 'schemastery';
import { type ManagerConfig } from './manager.ts';
/** Stable cordis plugin name. */
export declare const name = "plugin-manager";
/** Services required before the plugin surfaces can mount. */
export declare const inject: string[];
/**
 * Settings namespace of the plugin manager — the section the web settings
 * surface edits. Spelled here rather than imported: the browser half spells
 * the same value and must not depend on a Host package.
 */
export declare const PLUGIN_MANAGER_SETTINGS_NAMESPACE: import("@deepseek-ai/dsh-settings").SettingsNamespace;
/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
    /** Profile to manage; empty auto-detects (argv --profile, then `web`). */
    profile?: string;
    /** npm registry base URL for version checks. */
    registry?: string;
    /** Explicit pnpm binary path; empty auto-detects. */
    pnpmPath?: string;
    /** Master switch for the plugin (routes, tools, prompt section). */
    enabled?: boolean;
    /** When true (default), a system-prompt section announces the plugin. */
    announceToAgent?: boolean;
}
export declare const Config: z<Config>;
/**
 * Mount the plugin manager service, routes, tools, and announcement.
 * @param ctx - host plugin context carrying webServer/tools/systemPrompt.
 * @param config - resolved plugin config (schema defaults applied by the loader).
 */
export declare function apply(ctx: Context, config?: Config): void;
export { PluginManager, classifySpec, specToRepositoryUrl } from './manager.ts';
export type { ManagerConfig };
export type { PluginEntry, ProfileSummary, UpdateResult } from './protocol.ts';
