/**
 * Browser-side API client for the /api/dsh-plugin-manager route family. The
 * only data access path the panel uses — plain fetch, same origin.
 */
import { type PluginEntry, type ProfileSummary, type UpdateResult } from '../protocol.ts';
/** Error carrying the route's JSON error message. */
export declare class PluginManagerApiError extends Error {
    constructor(message: string);
}
/** The browser half's only data entry point. */
export declare class PluginManagerApi {
    /** Profile summary + installed plugin rows (no checks). */
    list(): Promise<{
        profile: ProfileSummary;
        plugins: PluginEntry[];
    }>;
    /** Run update checks (every plugin, or the named subset). */
    check(names?: string[]): Promise<{
        profile: ProfileSummary;
        plugins: PluginEntry[];
    }>;
    /** Update one plugin through pnpm. */
    update(name: string): Promise<UpdateResult>;
    /** Update every outdated plugin. */
    updateAll(): Promise<UpdateResult[]>;
    /** Remove one plugin from the profile through pnpm. */
    remove(name: string): Promise<UpdateResult>;
}
