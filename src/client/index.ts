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

import type { Context } from '@deepseek-ai/cordis'
import { PluginManagerApi } from './api.ts'
import { PluginManagerController } from './controller.ts'
import { mountPanel } from './mount.tsx'
import { mountSidebarEntry } from './sidebar-entry.ts'
import { injectStyles } from './styles.ts'

/** Stable cordis plugin name (mirrors the bundle row id). */
export const name = 'ui-plugin-manager'

/** No required client services — the mounts self-heal on their own. */
export const inject: string[] = []

/**
 * Mount the plugin manager panel and sidebar entry.
 * @param ctx - client root context (unused beyond effects).
 */
export function apply(ctx: Context): void {
  injectStyles()
  const controller = new PluginManagerController({ api: new PluginManagerApi() })

  const disposers: Array<() => void> = []
  try {
    disposers.push(mountSidebarEntry(controller))
    disposers.push(mountPanel(controller))
  } catch (error) {
    // DOM failures degrade the manager, never the GUI.
    console.error('[dsh-plugin-manager] mount failed:', error)
  }

  // First list load when the panel opens for the first time.
  let loaded = false
  const loadOnce = (): void => {
    if (loaded || !controller.getSnapshot().panelOpen) return
    loaded = true
    void controller.load(true)
  }
  const unsubscribeOpen = controller.subscribe(loadOnce)

  ctx.effect(() => () => {
    unsubscribeOpen()
    for (const dispose of disposers.splice(0)) dispose()
  }, 'dsh-plugin-manager: ui mounts')
}
