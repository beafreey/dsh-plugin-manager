/**
 * Panel view mounting.
 *
 * The `conversation` slot is single-occupant (ui-conversation) and external
 * plugins cannot declare slots, so the panel takes over the center column at
 * the DOM level: a container is appended inside the `[data-pane="conversation"]`
 * grid item (an extra trailing child React never manages), and a stylesheet
 * rule hides the conversation content while the panel is active. Toggling is
 * a data attribute on <html> — no React involvement, so the conversation
 * subtree underneath stays mounted and stateful.
 *
 * Cross-plugin etiquette (same convention as dsh-ssh / task-board): opening
 * this panel removes the sibling panels' activation attributes and announces
 * itself through the `dsh-panel-activate` event; receiving that event from a
 * sibling closes this panel.
 */
import type { PluginManagerController } from './controller.ts';
/** The injected panel container (kept in the DOM, hidden when inactive). */
export declare const PANEL_VIEW_SELECTOR = "[data-dsh-pluginmanager-view]";
/**
 * Mount the panel React tree into the center column and bind its visibility
 * to the controller's panelOpen state.
 * @param controller - the panel controller driving the view.
 * @returns disposer unmounting the tree and restoring the column.
 */
export declare function mountPanel(controller: PluginManagerController): () => void;
