/**
 * Agent tools: let the dsh agent list installed third-party plugins across
 * every managed profile, check them for updates, and update/remove them — the
 * same service the web panel uses, so an update started in the GUI is visible
 * to the agent and vice versa. Every tool accepts an optional `profile`
 * parameter (default: every managed profile / the current profile).
 */
import type { PluginManager } from './manager.ts';
/** The check tool: lists installed plugins and optionally checks for updates. */
export declare function pluginCheckTool(manager: PluginManager): import("@deepseek-ai/dsh-tools").ToolDefinition;
/** The update tool: updates one plugin (or every outdated plugin). */
export declare function pluginUpdateTool(manager: PluginManager): import("@deepseek-ai/dsh-tools").ToolDefinition;
/** The remove tool: removes one installed third-party plugin from a profile. */
export declare function pluginRemoveTool(manager: PluginManager): import("@deepseek-ai/dsh-tools").ToolDefinition;
