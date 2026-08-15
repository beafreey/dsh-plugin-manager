/**
 * Agent tools: let the dsh agent list installed third-party plugins, check
 * them for updates, and update them — the same service the web panel uses, so
 * an update started in the GUI is visible to the agent and vice versa.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { PluginManager } from './manager.ts'
import type { PluginEntry, UpdateResult } from './protocol.ts'

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

/** The check tool: lists installed plugins and optionally checks for updates. */
export function pluginCheckTool(manager: PluginManager) {
  return defineTool({
    name: 'dsh_plugin_check',
    description: 'List the third-party plugins installed in the active dsh profile with their versions and git repositories, and optionally check the npm registry / git remotes for newer versions. ' +
      'Triggers: plugin update status, check for plugin updates, list installed dsh plugins.',
    parameters: {
      check: { type: 'boolean', description: 'Also query the registry/git remotes for newer versions (default true).' },
      names: { type: 'array', items: { type: 'string' }, description: 'Optional package names to check instead of every plugin.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
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
      render: (_args, value: { plugins: CheckToolRow[] }) => {
        const plugins = value.plugins
        if (plugins.length === 0) return text('no third-party plugins installed in this profile')
        return text(['name | version | latest | state | repository | error', '--- | --- | --- | --- | --- | ---', ...plugins.map(row => renderRow(row as PluginEntry))].join('\n'))
      },
    },
    async execute(args) {
      const plugins = (args.check ?? true)
        ? await manager.checkUpdates(args.names !== undefined ? { names: args.names } : undefined)
        : manager.listPlugins()
      return { plugins }
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
      const results = args.name !== undefined && args.name !== ''
        ? [await manager.updatePlugin(args.name)]
        : await manager.updateAll()
      return { results }
    },
  })
}
