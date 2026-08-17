/**
 * Panel controller — framework-free state machine between the React panel and
 * the host API. Owns: the per-profile plugin lists, update-check state,
 * in-flight operation flags, the restart hint, and the panel open flag driving
 * the sidebar entry + center-column takeover. Subscribers get the whole
 * snapshot.
 */

import { PluginManagerApi } from './api.ts'
import type { PluginEntry, ProfileSummary, ProfileView, UpdateResult } from '../protocol.ts'

/** Full UI state the panel renders. */
export interface PanelSnapshot {
  /** Panel visibility (sidebar entry toggle). */
  panelOpen: boolean
  /** Every managed profile with its summary and plugin rows. */
  profiles: ProfileView[]
  /** The active profile tab. */
  active: string
  /** A list/check call is in flight. */
  loading: boolean
  /** A check call is in flight (separate from the initial list load). */
  checking: boolean
  /** `${profile}\u0000${name}` keys with an update/remove running right now. */
  updating: Set<string>
  /** Last banner (info / error) shown to the user. */
  banner: { kind: 'info' | 'error' | 'ok'; text: string } | undefined
  /** True once an update succeeded — the panel keeps the restart hint visible. */
  needsRestart: boolean
  /** Last update result log (collapsible detail). */
  lastUpdateOutput: string
}

/** Key for one in-flight operation. */
function opKey(profile: string, name: string): string {
  return `${profile}\u0000${name}`
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
    profiles: [],
    active: '',
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

  /** Switch the active profile tab. */
  setActive(profile: string): void {
    if (this.snapshot.active === profile) return
    this.emit({ active: profile })
  }

  /** Replace (or merge) profile views into the state. */
  private mergeViews(views: ProfileView[]): void {
    const byName = new Map(views.map(view => [view.profile.name, view]))
    const merged = this.snapshot.profiles.map(view => byName.get(view.profile.name) ?? view)
    for (const view of views) {
      if (!merged.some(existing => existing.profile.name === view.profile.name)) merged.push(view)
    }
    const active = this.snapshot.active !== '' && merged.some(view => view.profile.name === this.snapshot.active)
      ? this.snapshot.active
      : merged[0]?.profile.name ?? ''
    this.emit({ profiles: merged, active })
  }

  /**
   * Load the profile views; runs a check when it is the first load (so the
   * panel opens with update states already populated).
   */
  async load(forceCheck: boolean): Promise<void> {
    if (this.snapshot.loading) return
    this.emit({ loading: true, banner: undefined })
    try {
      const views = await this.api.list()
      this.mergeViews(views)
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
    if (forceCheck || this.snapshot.profiles.every(view => view.plugins.every(entry => entry.state === 'unknown'))) {
      await this.check()
    }
  }

  /** Re-run update checks (the active profile, or every profile when omitted). */
  async check(profile?: string, names?: string[]): Promise<void> {
    if (this.snapshot.checking) return
    this.emit({ checking: true, banner: undefined })
    try {
      const views = await this.api.check(profile, names)
      this.mergeViews(views)
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

  /** Update one plugin in one profile; returns the pnpm result. */
  async update(profile: string, name: string): Promise<UpdateResult | undefined> {
    const key = opKey(profile, name)
    const updating = new Set(this.snapshot.updating)
    if (updating.has(key)) return undefined
    updating.add(key)
    this.emit({ updating, banner: undefined, lastUpdateOutput: '' })
    try {
      const result = await this.api.update(profile, name)
      const ok = result.ok
      const views = await this.api.list(profile)
      this.mergeViews(views)
      this.emit({
        banner: ok
          ? { kind: 'ok', text: `已更新 ${profile}/${name}（${result.durationMs < 1000 ? '不足 1 秒' : `${Math.round(result.durationMs / 1000)} 秒`}）。重启 DSH 后生效。` }
          : { kind: 'error', text: `更新 ${profile}/${name} 失败：${result.error ?? '未知错误'}` },
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
      updating.delete(key)
      this.emit({ updating })
    }
  }

  /** Update every outdated plugin in the active profile sequentially. */
  async updateAll(profile: string): Promise<void> {
    if (this.snapshot.updating.size > 0) return
    const view = this.snapshot.profiles.find(entry => entry.profile.name === profile)
    const targets = view?.plugins.filter(entry => entry.state === 'outdated').map(entry => entry.name) ?? []
    if (targets.length === 0) {
      this.emit({ banner: { kind: 'info', text: `profile ${profile} 没有可更新的插件。` } })
      return
    }
    const outputs: string[] = []
    let anyOk = false
    for (const name of targets) {
      const result = await this.update(profile, name)
      if (result?.ok === true) anyOk = true
      if (result?.output !== undefined && result.output !== '') {
        outputs.push(`$ pnpm → ${profile}/${name}\n${result.output}`)
      }
    }
    if (anyOk) {
      this.emit({
        banner: { kind: 'ok', text: `profile ${profile} 批量更新完成。重启 DSH 后新代码生效。` },
        needsRestart: true,
        lastUpdateOutput: outputs.join('\n\n'),
      })
    }
  }

  /** Remove one plugin from one profile; returns the pnpm result. */
  async remove(profile: string, name: string): Promise<UpdateResult | undefined> {
    const key = opKey(profile, name)
    const updating = new Set(this.snapshot.updating)
    if (updating.has(key)) return undefined
    updating.add(key)
    this.emit({ updating, banner: undefined, lastUpdateOutput: '' })
    try {
      const result = await this.api.remove(profile, name)
      const ok = result.ok
      const views = await this.api.list(profile)
      this.mergeViews(views)
      this.emit({
        banner: ok
          ? { kind: 'ok', text: `已从 ${profile} 删除 ${name}。重启 DSH 后完全卸载。` }
          : { kind: 'error', text: `删除 ${profile}/${name} 失败：${result.error ?? '未知错误'}` },
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
      updating.delete(key)
      this.emit({ updating })
    }
  }

  /** Convenience accessors for the panel. */
  activeView(): ProfileView | undefined {
    return this.snapshot.profiles.find(view => view.profile.name === this.snapshot.active)
  }

  summaryOf(profile: string): ProfileSummary | undefined {
    return this.snapshot.profiles.find(view => view.profile.name === profile)?.profile
  }

  pluginsOf(profile: string): PluginEntry[] {
    return this.snapshot.profiles.find(view => view.profile.name === profile)?.plugins ?? []
  }
}
