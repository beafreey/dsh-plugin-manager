/**
 * Agent tools: let the dsh agent list installed third-party plugins, check
 * them for updates, and update them — the same service the web panel uses, so
 * an update started in the GUI is visible to the agent and vice versa.
 */
import type { PluginManager } from './manager.ts';
/** The check tool: lists installed plugins and optionally checks for updates. */
export declare function pluginCheckTool(manager: PluginManager): import("@deepseek-ai/dsh-tools").ToolDefinition;
/** The update tool: updates one plugin (or every outdated plugin). */
export declare function pluginUpdateTool(manager: PluginManager): import("@deepseek-ai/dsh-tools").ToolDefinition;
/** The remove tool: removes one installed third-party plugin from the profile. */
export declare function pluginRemoveTool(manager: PluginManager): import("@deepseek-ai/dsh-tools").ToolDefinition;
