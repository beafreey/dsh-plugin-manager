/**
 * Agent tools: let the dsh agent list installed third-party plugins across
 * every managed profile, check them for updates, and update/remove them — the
 * same service the web panel uses, so an update started in the GUI is visible
 * to the agent and vice versa. Every tool accepts an optional `profile`
 * parameter (default: every managed profile / the current profile).
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { PluginManager } from './manager.ts'
import type { PluginEntry, ProfileView, UpdateResult } from './protocol.ts'

/** One text content block (the only render shape these tools emit). */
function text(value: string): ContentBlock[] {
  return [{ type: 'text', text: value }]
}

/** Render one plugin row for the agent. */
function renderRow(entry: PluginEntry): string {
  const parts = [
    entry.name,
    entry.version,
    entry.latest ?? '-',
    entry.state,
  ]
  if (entry.repository !== undefined) parts.push(entry.repository)
  if (entry.error !== undefined) parts.push(entry.error)
  return parts.join(' | ')
}

/** The schema-derived plugin row the check tool renders. */
type CheckToolRow = Pick<PluginEntry, 'name' | 'version' | 'latest' | 'state' | 'repository' | 'error'>
/** The schema-derived update result the update tool renders. */
type UpdateToolRow = Pick<UpdateResult, 'name' | 'ok' | 'output' | 'durationMs'> & { error?: string }
/** The schema-derived profile view the check tool renders. */
type CheckToolView = { profile: string; plugins: CheckToolRow[] }

/** Render one profile's plugin rows with a header. */
function renderView(view: CheckToolView): string {
  const header = `profile: ${view.profile}`
  if (view.plugins.length === 0) return `${header} — no third-party plugins installed`
  return [
    header,
    'name | version | latest | state | repository | error',
    '--- | --- | --- | --- | --- | ---',
    ...view.plugins.map(row => renderRow(row as PluginEntry)),
  ].join('\n')
}

/** The check tool: lists installed plugins and optionally checks for updates. */
export function pluginCheckTool(manager: PluginManager) {
  return defineTool({
    name: 'dsh_plugin_check',
    description: 'List the third-party plugins installed in the managed dsh profiles with their versions and git repositories, and optionally check the npm registry / git remotes for newer versions. ' +
      'Triggers: plugin update status, check for plugin updates, list installed dsh plugins.',
    parameters: {
      check: { type: 'boolean', description: 'Also query the registry/git remotes for newer versions (default true).' },
      names: { type: 'array', items: { type: 'string' }, description: 'Optional package names to check instead of every plugin.' },
      profile: { type: 'string', description: 'Restrict to one profile name (default: every managed profile).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          profiles: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                profile: { type: 'string', required: true },
                plugins: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      name: { type: 'string', required: true },
                      version: { type: 'string', required: true },
                      latest: { type: 'string' },
                      state: { type: 'string', enum: ['unknown', 'current', 'outdated', 'error', 'checking'], required: true },
                      repository: { type: 'string' },
                      error: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      render: (_args, value: { profiles: CheckToolView[] }) => {
        if (value.profiles.length === 0) return text('no managed dsh profiles found')
        return text(value.profiles.map(renderView).join('\n\n'))
      },
    },
    async execute(args) {
      const target = args.profile !== undefined && args.profile !== '' ? args.profile : undefined
      if (args.check ?? true) {
        const views = await manager.checkProfileViews(target)
        return {
          profiles: views.map(view => ({
            profile: view.profile.name,
            plugins: view.plugins.map(row => ({
              name: row.name,
              version: row.version,
              latest: row.latest,
              state: row.state,
              repository: row.repository,
              error: row.error,
            })),
          })),
        }
      }
      const views: ProfileView[] = target !== undefined
        ? [manager.profileView(target)]
        : manager.allProfileViews()
      return {
        profiles: views.map(view => ({
          profile: view.profile.name,
          plugins: view.plugins.map(row => ({
            name: row.name,
            version: row.version,
            latest: row.latest,
            state: row.state,
            repository: row.repository,
            error: row.error,
          })),
        })),
      }
    },
  })
}

/** The update tool: updates one plugin (or every outdated plugin). */
export function pluginUpdateTool(manager: PluginManager) {
  return defineTool({
    name: 'dsh_plugin_update',
    description: 'Update one installed third-party dsh plugin to its latest version by running pnpm in the profile directory (or update every outdated plugin when no name is given). ' +
      'Requires pnpm on the host and network access. Host-side plugin code reloads only after dsh restarts. ' +
      'Triggers: update a plugin, upgrade plugins.',
    parameters: {
      name: { type: 'string', description: 'Package name to update; omit to update every outdated plugin.' },
      profile: { type: 'string', description: 'Profile to update in (default: the current profile).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          results: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                ok: { type: 'boolean', required: true },
                output: { type: 'string', required: true },
                durationMs: { type: 'integer', required: true },
                error: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value: { results: UpdateToolRow[] }) => {
        const results = value.results
        if (results.length === 0) return text('nothing to update')
        return text(results.map((result) => {
          const status = result.ok ? 'ok' : 'failed'
          const tail = result.error !== undefined ? ` (${result.error})` : ''
          return `${result.name}: ${status}${tail}\n${result.output}`.trim()
        }).join('\n\n'))
      },
    },
    async execute(args) {
      const profile = args.profile !== undefined && args.profile !== '' ? args.profile : undefined
      const results = args.name !== undefined && args.name !== ''
        ? [await manager.updatePlugin(args.name, profile)]
        : await manager.updateAll(profile)
      return { results }
    },
  })
}

/** The remove tool: removes one installed third-party plugin from a profile. */
export function pluginRemoveTool(manager: PluginManager) {
  return defineTool({
    name: 'dsh_plugin_remove',
    description: 'Remove one installed third-party dsh plugin from a profile by running pnpm in the profile directory. ' +
      'Host-side plugin code unloads only after dsh restarts. Requires pnpm on the host. ' +
      'Triggers: uninstall a plugin, remove a plugin, delete a dsh plugin.',
    parameters: {
      name: { type: 'string', required: true, description: 'Package name to remove from the profile.' },
      profile: { type: 'string', description: 'Profile to remove from (default: the current profile).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          ok: { type: 'boolean', required: true },
          output: { type: 'string', required: true },
          durationMs: { type: 'integer', required: true },
          error: { type: 'string' },
        },
      },
      render: (_args, value: UpdateToolRow) => {
        const status = value.ok ? 'removed' : 'failed'
        const tail = value.error !== undefined ? ` (${value.error})` : ''
        return text(`${value.name}: ${status}${tail}\n${value.output}`.trim())
      },
    },
    async execute(args) {
      const profile = args.profile !== undefined && args.profile !== '' ? args.profile : undefined
      return await manager.removePlugin(args.name, profile)
    },
  })
}
