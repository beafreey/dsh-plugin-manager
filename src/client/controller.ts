/**
 * Panel controller — framework-free state machine between the React panel and
 * the host API. Owns: the plugin list, per-plugin update-check state, in-flight
 * update flags, the restart hint, and the panel open flag driving the sidebar
 * entry + center-column takeover. Subscribers get the whole snapshot.
 */

import { PluginManagerApi } from './api.ts'
import type { PluginEntry, ProfileSummary, UpdateResult } from '../protocol.ts'

/** Full UI state the panel renders. */
export interface PanelSnapshot {
  /** Panel visibility (sidebar entry toggle). */
  panelOpen: boolean
  /** Profile summary from the last list/check response. */
  profile: ProfileSummary | undefined
  /** Plugin rows in dependency order. */
  plugins: PluginEntry[]
  /** A list/check call is in flight. */
  loading: boolean
  /** A check call is in flight (separate from the initial list load). */
  checking: boolean
  /** Package names with an update running right now. */
  updating: Set<string>
  /** Last banner (info / error) shown to the user. */
  banner: { kind: 'info' | 'error' | 'ok'; text: string } | undefined
  /** True once an update succeeded — the panel keeps the restart hint visible. */
  needsRestart: boolean
  /** Last update result log (collapsible detail). */
  lastUpdateOutput: string
}

/** Snapshot factory (mutations replace the object, never edit in place). */
export interface ControllerDeps {
  /** The host API client. */
  api: PluginManagerApi
}

/** The panel controller. */
export class PluginManagerController {
  private readonly api: PluginManagerApi
  private snapshot: PanelSnapshot = {
    panelOpen: false,
    profile: undefined,
    plugins: [],
    loading: false,
    checking: false,
    updating: new Set(),
    banner: undefined,
    needsRestart: false,
    lastUpdateOutput: '',
  }
  private readonly listeners = new Set<() => void>()

  constructor(deps: ControllerDeps) {
    this.api = deps.api
  }

  /**
   * Subscribe to snapshot changes; returns the unsubscribe function.
   * Arrow property: a stable reference for useSyncExternalStore.
   */
  subscribe = (listener: () => void): () => void => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Current snapshot — a stable object reference between emits. Arrow
   * property: a stable reference for useSyncExternalStore, which REQUIRES
   * getSnapshot to return the same reference while the store is unchanged
   * (a fresh object every call makes React loop and blank the panel).
   */
  getSnapshot = (): PanelSnapshot => this.snapshot

  private emit(next: Partial<PanelSnapshot>): void {
    this.snapshot = {
      ...this.snapshot,
      ...next,
      updating: new Set(next.updating ?? this.snapshot.updating),
    }
    for (const listener of this.listeners) listener()
  }

  /** Open/close the panel. */
  toggle(): void {
    this.emit({ panelOpen: !this.snapshot.panelOpen })
  }

  /** Close the panel (sibling-panel eviction path). */
  close(): void {
    if (!this.snapshot.panelOpen) return
    this.emit({ panelOpen: false })
  }

  /**
   * Load the plugin list; runs a check when it is the first load (so the
   * panel opens with update states already populated).
   */
  async load(forceCheck: boolean): Promise<void> {
    if (this.snapshot.loading) return
    this.emit({ loading: true, banner: undefined })
    try {
      const { profile, plugins } = await this.api.list()
      this.emit({ profile, plugins })
    } catch (error) {
      this.emit({
        banner: {
          kind: 'error',
          text: error instanceof Error ? error.message : String(error),
        },
      })
    } finally {
      this.emit({ loading: false })
    }
    if (forceCheck || this.snapshot.plugins.every(entry => entry.state === 'unknown')) {
      await this.check()
    }
  }

  /** Re-run update checks for every plugin. */
  async check(names?: string[]): Promise<void> {
    if (this.snapshot.checking) return
    this.emit({ checking: true, banner: undefined })
    try {
      const { profile, plugins } = await this.api.check(names)
      this.emit({ profile, plugins })
    } catch (error) {
      this.emit({
        banner: {
          kind: 'error',
          text: error instanceof Error ? error.message : String(error),
        },
      })
    } finally {
      this.emit({ checking: false })
    }
  }

  /** Update one plugin; returns the pnpm result for the inline log. */
  async update(name: string): Promise<UpdateResult | undefined> {
    const updating = new Set(this.snapshot.updating)
    if (updating.has(name)) return undefined
    updating.add(name)
    this.emit({ updating, banner: undefined, lastUpdateOutput: '' })
    try {
      const result = await this.api.update(name)
      const plugins = await this.reloadAfterUpdate(name)
      const ok = result.ok
      this.emit({
        plugins,
        banner: ok
          ? { kind: 'ok', text: `已更新 ${name}（${result.durationMs < 1000 ? '不足 1 秒' : `${Math.round(result.durationMs / 1000)} 秒`}）。重启 DSH 后生效。` }
          : { kind: 'error', text: `更新 ${name} 失败：${result.error ?? '未知错误'}` },
        needsRestart: ok || this.snapshot.needsRestart,
        lastUpdateOutput: result.output,
      })
      return result
    } catch (error) {
      this.emit({
        banner: {
          kind: 'error',
          text: error instanceof Error ? error.message : String(error),
        },
      })
      return undefined
    } finally {
      const updating = new Set(this.snapshot.updating)
      updating.delete(name)
      this.emit({ updating })
    }
  }

  /** Update every outdated plugin sequentially. */
  async updateAll(): Promise<void> {
    if (this.snapshot.updating.size > 0) return
    const targets = this.snapshot.plugins.filter(entry => entry.state === 'outdated').map(entry => entry.name)
    if (targets.length === 0) {
      this.emit({ banner: { kind: 'info', text: '没有可更新的插件。' } })
      return
    }
    const outputs: string[] = []
    let anyOk = false
    for (const name of targets) {
      const result = await this.update(name)
      if (result?.ok === true) anyOk = true
      if (result?.output !== undefined && result.output !== '') {
        outputs.push(`$ pnpm → ${name}\n${result.output}`)
      }
    }
    if (anyOk) {
      this.emit({
        banner: { kind: 'ok', text: '批量更新完成。重启 DSH 后新代码生效。' },
        needsRestart: true,
        lastUpdateOutput: outputs.join('\n\n'),
      })
    }
  }

  /** Remove one plugin from the profile; returns the pnpm result. */
  async remove(name: string): Promise<UpdateResult | undefined> {
    const updating = new Set(this.snapshot.updating)
    if (updating.has(name)) return undefined
    updating.add(name)
    this.emit({ updating, banner: undefined, lastUpdateOutput: '' })
    try {
      const result = await this.api.remove(name)
      const { plugins } = await this.api.list()
      const ok = result.ok
      this.emit({
        plugins,
        banner: ok
          ? { kind: 'ok', text: `已删除 ${name}。重启 DSH 后完全卸载。` }
          : { kind: 'error', text: `删除 ${name} 失败：${result.error ?? '未知错误'}` },
        needsRestart: ok || this.snapshot.needsRestart,
        lastUpdateOutput: result.output,
      })
      return result
    } catch (error) {
      this.emit({
        banner: {
          kind: 'error',
          text: error instanceof Error ? error.message : String(error),
        },
      })
      return undefined
    } finally {
      const updating = new Set(this.snapshot.updating)
      updating.delete(name)
      this.emit({ updating })
    }
  }

  /** Refresh the row list after one update so the new versions show. */
  private async reloadAfterUpdate(name: string): Promise<PluginEntry[]> {
    try {
      const { plugins } = await this.api.list()
      const rows = [...plugins]
      // Re-check just the updated plugin so its state reflects the new version.
      const row = rows.find(entry => entry.name === name)
      if (row !== undefined) {
        const { plugins: checked } = await this.api.check([name])
        const updated = checked.find(entry => entry.name === name)
        if (updated !== undefined) {
          rows[rows.indexOf(row)] = updated
        }
      }
      return rows
    } catch {
      return this.snapshot.plugins
    }
  }
}
