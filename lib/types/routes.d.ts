/**
 * The /api/dsh-plugin-manager route family: plugin list, update checks, and
 * pnpm-backed updates. Every route carries a loopback-only trust fence plus
 * browser same-origin markers (mirrors the dsh-ssh pairing routes): these
 * endpoints run package updates in the user's dsh profile, so LAN-exposed dsh
 * web deployments must not serve them.
 */
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver';
import type { PluginManager } from './manager.ts';
/**
 * Build every /api/dsh-plugin-manager route (exact paths).
 * @param manager - the plugin manager service.
 * @returns the routes to register on the web server.
 */
export declare function makeRoutes(manager: PluginManager): WebRoute[];
