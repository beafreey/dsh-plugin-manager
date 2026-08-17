/**
 * Browser-side API client for the /api/dsh-plugin-manager route family. The
 * only data access path the panel uses — plain fetch, same origin.
 */
import { type ProfileView, type UpdateResult } from '../protocol.ts';
/** Error carrying the route's JSON error message. */
export declare class PluginManagerApiError extends Error {
    constructor(message: string);
}
/** The browser half's only data entry point. */
export declare class PluginManagerApi {
    /** Profile views (summary + plugin rows) for every managed profile. */
    list(profile?: string): Promise<ProfileView[]>;
    /** Run update checks (every profile, or the named one / subset of plugins). */
    check(profile?: string, names?: string[]): Promise<ProfileView[]>;
    /** Update one plugin through pnpm in one profile. */
    update(profile: string, name: string): Promise<UpdateResult>;
    /** Update every outdated plugin in one profile. */
    updateAll(profile: string): Promise<UpdateResult[]>;
    /** Remove one plugin from one profile through pnpm. */
    remove(profile: string, name: string): Promise<UpdateResult>;
}
