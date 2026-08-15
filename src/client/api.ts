/**
 * Browser-side API client for the /api/dsh-plugin-manager route family. The
 * only data access path the panel uses — plain fetch, same origin.
 */

import {
  PLUGIN_MANAGER_API,
  type PluginEntry,
  type ProfileSummary,
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
  /** Profile summary + installed plugin rows (no checks). */
  async list(): Promise<{ profile: ProfileSummary; plugins: PluginEntry[] }> {
    const response = await fetch(PLUGIN_MANAGER_API.list)
    return readJson<{ profile: ProfileSummary; plugins: PluginEntry[] }>(response)
  }

  /** Run update checks (every plugin, or the named subset). */
  async check(names?: string[]): Promise<{ profile: ProfileSummary; plugins: PluginEntry[] }> {
    const response = await fetch(PLUGIN_MANAGER_API.check, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(names !== undefined && names.length > 0 ? { names } : {}),
    })
    return readJson<{ profile: ProfileSummary; plugins: PluginEntry[] }>(response)
  }

  /** Update one plugin through pnpm. */
  async update(name: string): Promise<UpdateResult> {
    const response = await fetch(PLUGIN_MANAGER_API.update, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const body = await readJson<{ result: UpdateResult }>(response)
    return body.result
  }

  /** Update every outdated plugin. */
  async updateAll(): Promise<UpdateResult[]> {
    const response = await fetch(PLUGIN_MANAGER_API.updateAll, { method: 'POST' })
    const body = await readJson<{ results: UpdateResult[] }>(response)
    return body.results
  }

  /** Remove one plugin from the profile through pnpm. */
  async remove(name: string): Promise<UpdateResult> {
    const response = await fetch(PLUGIN_MANAGER_API.remove, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const body = await readJson<{ result: UpdateResult }>(response)
    return body.result
  }
}
