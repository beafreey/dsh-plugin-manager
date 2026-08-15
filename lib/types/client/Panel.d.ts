/**
 * The plugin manager panel: profile summary, plugin table (name, installed
 * version, latest version, state, repository), check/update actions, and the
 * restart hint. Pure view over the controller snapshot (useSyncExternalStore).
 */
import type { PluginManagerController } from './controller.ts';
/** The panel root component. */
export declare function PluginManagerPanel(props: {
    controller: PluginManagerController;
}): JSX.Element;
