/**
 * dsh-plugin-manager client plugin: wires the framework-free controller to the
 * DOM surfaces — the sidebar entry row and the management panel in the center
 * column. No client services are required: every data path is same-origin
 * fetch, and the mounts self-heal until the shell renders.
 *
 * Failure policy: DOM mounting problems are logged, never thrown — the web
 * shell fails the whole boot when a plugin apply throws, and an external
 * plugin must not take the GUI down.
 */
import type { Context } from '@deepseek-ai/cordis';
/** Stable cordis plugin name (mirrors the bundle row id). */
export declare const name = "ui-plugin-manager";
/** No required client services — the mounts self-heal on their own. */
export declare const inject: string[];
/**
 * Mount the plugin manager panel and sidebar entry.
 * @param ctx - client root context (unused beyond effects).
 */
export declare function apply(ctx: Context): void;
