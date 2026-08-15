/**
 * Panel controller — framework-free state machine between the React panel and
 * the host API. Owns: the plugin list, per-plugin update-check state, in-flight
 * update flags, the restart hint, and the panel open flag driving the sidebar
 * entry + center-column takeover. Subscribers get the whole snapshot.
 */
import { PluginManagerApi } from './api.ts';
import type { PluginEntry, ProfileSummary, UpdateResult } from '../protocol.ts';
/** Full UI state the panel renders. */
export interface PanelSnapshot {
    /** Panel visibility (sidebar entry toggle). */
    panelOpen: boolean;
    /** Profile summary from the last list/check response. */
    profile: ProfileSummary | undefined;
    /** Plugin rows in dependency order. */
    plugins: PluginEntry[];
    /** A list/check call is in flight. */
    loading: boolean;
    /** A check call is in flight (separate from the initial list load). */
    checking: boolean;
    /** Package names with an update running right now. */
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
    /**
     * Load the plugin list; runs a check when it is the first load (so the
     * panel opens with update states already populated).
     */
    load(forceCheck: boolean): Promise<void>;
    /** Re-run update checks for every plugin. */
    check(names?: string[]): Promise<void>;
    /** Update one plugin; returns the pnpm result for the inline log. */
    update(name: string): Promise<UpdateResult | undefined>;
    /** Update every outdated plugin sequentially. */
    updateAll(): Promise<void>;
    /** Remove one plugin from the profile; returns the pnpm result. */
    remove(name: string): Promise<UpdateResult | undefined>;
    /** Refresh the row list after one update so the new versions show. */
    private reloadAfterUpdate;
}
