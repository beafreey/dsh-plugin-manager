/**
 * The /api/dsh-plugin-manager route family: plugin list, update checks, and
 * pnpm-backed updates. Every route carries a loopback-only trust fence plus
 * browser same-origin markers (mirrors the dsh-ssh pairing routes): these
 * endpoints run package updates in the user's dsh profile, so LAN-exposed dsh
 * web deployments must not serve them.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { PluginManager } from './manager.ts'
import { PLUGIN_MANAGER_API, type CheckRequest, type UpdateRequest } from './protocol.ts'

/** Cap on JSON request bodies (update/check payloads are tiny). */
const MAX_JSON_BODY_BYTES = 16 * 1024

/** Loopback literal check plus browser same-origin markers. */
function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** One JSON response. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(payload)
}

/** Read a JSON request body (undefined when too large or unparseable). */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_JSON_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

/**
 * Build every /api/dsh-plugin-manager route (exact paths).
 * @param manager - the plugin manager service.
 * @returns the routes to register on the web server.
 */
export function makeRoutes(manager: PluginManager): WebRoute[] {
  /** Guard helper: fence + method check. */
  const guard = (req: IncomingMessage, res: ServerResponse, method: string): boolean => {
    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { error: 'forbidden: loopback-only' })
      return false
    }
    if (req.method !== method) {
      writeJson(res, 405, { error: `method not allowed: ${req.method ?? 'unknown'}` })
      return false
    }
    return true
  }

  return [
    {
      kind: 'exact',
      path: PLUGIN_MANAGER_API.list,
      handler: (_req, res) => {
        if (!guard(_req, res, 'GET')) return
        writeJson(res, 200, { profile: manager.summary(), plugins: manager.listPlugins() })
      },
    },
    {
      kind: 'exact',
      path: PLUGIN_MANAGER_API.check,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const names = Array.isArray(body?.names) ? body.names.filter((x): x is string => typeof x === 'string') : undefined
        const request: CheckRequest = names === undefined ? {} : { names }
        try {
          writeJson(res, 200, { profile: manager.summary(), plugins: await manager.checkUpdates(request) })
        } catch (error) {
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: PLUGIN_MANAGER_API.update,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const name = typeof body?.name === 'string' ? body.name : ''
        if (name === '') {
          writeJson(res, 400, { error: 'name is required' })
          return
        }
        const request: UpdateRequest = { name }
        try {
          writeJson(res, 200, { result: await manager.updatePlugin(request.name) })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          writeJson(res, message.startsWith('another update') ? 409 : 400, { error: message })
        }
      },
    },
    {
      kind: 'exact',
      path: PLUGIN_MANAGER_API.updateAll,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          writeJson(res, 200, { results: await manager.updateAll() })
        } catch (error) {
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: PLUGIN_MANAGER_API.remove,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const name = typeof body?.name === 'string' ? body.name : ''
        if (name === '') {
          writeJson(res, 400, { error: 'name is required' })
          return
        }
        try {
          writeJson(res, 200, { result: await manager.removePlugin(name) })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          writeJson(res, message.startsWith('another profile operation') ? 409 : 400, { error: message })
        }
      },
    },
  ]
}
