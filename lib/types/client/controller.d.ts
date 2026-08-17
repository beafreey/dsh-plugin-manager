/**
 * Panel controller — framework-free state machine between the React panel and
 * the host API. Owns: the per-profile plugin lists, update-check state,
 * in-flight operation flags, the restart hint, and the panel open flag driving
 * the sidebar entry + center-column takeover. Subscribers get the whole
 * snapshot.
 */
import { PluginManagerApi } from './api.ts';
import type { PluginEntry, ProfileSummary, ProfileView, UpdateResult } from '../protocol.ts';
/** Full UI state the panel renders. */
export interface PanelSnapshot {
    /** Panel visibility (sidebar entry toggle). */
    panelOpen: boolean;
    /** Every managed profile with its summary and plugin rows. */
    profiles: ProfileView[];
    /** The active profile tab. */
    active: string;
    /** A list/check call is in flight. */
    loading: boolean;
    /** A check call is in flight (separate from the initial list load). */
    checking: boolean;
    /** `${profile}\u0000${name}` keys with an update/remove running right now. */
    updating: Set<string>;
    /** Last banner (info / error) shown to the user. */
    banner: {
        kind: 'info' | 'error' | 'ok';
        text: string;
    } | undefined;
    /** True once an update succeeded — the panel keeps the restart hint visible. */
    needsRestart: boolean;
    /** Last update result log (collapsible detail). */
    lastUpdateOutput: string;
}
/** Snapshot factory (mutations replace the object, never edit in place). */
export interface ControllerDeps {
    /** The host API client. */
    api: PluginManagerApi;
}
/** The panel controller. */
export declare class PluginManagerController {
    private readonly api;
    private snapshot;
    private readonly listeners;
    constructor(deps: ControllerDeps);
    /**
     * Subscribe to snapshot changes; returns the unsubscribe function.
     * Arrow property: a stable reference for useSyncExternalStore.
     */
    subscribe: (listener: () => void) => () => void;
    /**
     * Current snapshot — a stable object reference between emits. Arrow
     * property: a stable reference for useSyncExternalStore, which REQUIRES
     * getSnapshot to return the same reference while the store is unchanged
     * (a fresh object every call makes React loop and blank the panel).
     */
    getSnapshot: () => PanelSnapshot;
    private emit;
    /** Open/close the panel. */
    toggle(): void;
    /** Close the panel (sibling-panel eviction path). */
    close(): void;
    /** Switch the active profile tab. */
    setActive(profile: string): void;
    /** Replace (or merge) profile views into the state. */
    private mergeViews;
    /**
     * Load the profile views; runs a check when it is the first load (so the
     * panel opens with update states already populated).
     */
    load(forceCheck: boolean): Promise<void>;
    /** Re-run update checks (the active profile, or every profile when omitted). */
    check(profile?: string, names?: string[]): Promise<void>;
    /** Update one plugin in one profile; returns the pnpm result. */
    update(profile: string, name: string): Promise<UpdateResult | undefined>;
    /** Update every outdated plugin in the active profile sequentially. */
    updateAll(profile: string): Promise<void>;
    /** Remove one plugin from one profile; returns the pnpm result. */
    remove(profile: string, name: string): Promise<UpdateResult | undefined>;
    /** Convenience accessors for the panel. */
    activeView(): ProfileView | undefined;
    summaryOf(profile: string): ProfileSummary | undefined;
    pluginsOf(profile: string): PluginEntry[];
}
