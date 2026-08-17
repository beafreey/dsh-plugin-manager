/**
 * Browser-side API client for the /api/dsh-plugin-manager route family. The
 * only data access path the panel uses — plain fetch, same origin.
 */

import {
  PLUGIN_MANAGER_API,
  type ProfileView,
  type UpdateResult,
} from '../protocol.ts'

/** Error carrying the route's JSON error message. */
export class PluginManagerApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PluginManagerApiError'
  }
}

/** Parse a JSON response or throw a PluginManagerApiError. */
async function readJson<T>(response: Response): Promise<T> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new PluginManagerApiError(`HTTP ${response.status}: invalid JSON response`)
  }
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `HTTP ${response.status}`
    throw new PluginManagerApiError(message)
  }
  return body as T
}

/** The browser half's only data entry point. */
export class PluginManagerApi {
  /** Profile views (summary + plugin rows) for every managed profile. */
  async list(profile?: string): Promise<ProfileView[]> {
    const query = profile !== undefined && profile !== '' ? `?profile=${encodeURIComponent(profile)}` : ''
    const response = await fetch(PLUGIN_MANAGER_API.list + query)
    return readJson<{ profiles: ProfileView[] }>(response).then(body => body.profiles)
  }

  /** Run update checks (every profile, or the named one / subset of plugins). */
  async check(profile?: string, names?: string[]): Promise<ProfileView[]> {
    const body: Record<string, unknown> = {}
    if (profile !== undefined && profile !== '') body.profile = profile
    if (names !== undefined && names.length > 0) body.names = names
    const response = await fetch(PLUGIN_MANAGER_API.check, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return readJson<{ profiles: ProfileView[] }>(response).then(body => body.profiles)
  }

  /** Update one plugin through pnpm in one profile. */
  async update(profile: string, name: string): Promise<UpdateResult> {
    const response = await fetch(PLUGIN_MANAGER_API.update, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profile, name }),
    })
    const body = await readJson<{ result: UpdateResult }>(response)
    return body.result
  }

  /** Update every outdated plugin in one profile. */
  async updateAll(profile: string): Promise<UpdateResult[]> {
    const response = await fetch(PLUGIN_MANAGER_API.updateAll, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profile }),
    })
    const body = await readJson<{ results: UpdateResult[] }>(response)
    return body.results
  }

  /** Remove one plugin from one profile through pnpm. */
  async remove(profile: string, name: string): Promise<UpdateResult> {
    const response = await fetch(PLUGIN_MANAGER_API.remove, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profile, name }),
    })
    const body = await readJson<{ result: UpdateResult }>(response)
    return body.result
  }
}
