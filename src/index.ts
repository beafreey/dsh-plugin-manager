/**
 * dsh-plugin-manager — host half. Mounts the plugin manager service (profile
 * scan, npm/git update checks, pnpm-backed updates), the /api/dsh-plugin-manager
 * route family, the agent tools (dsh_plugin_check, dsh_plugin_update), and a
 * system-prompt announcement. The browser half (./client) renders the sidebar
 * entry and the management panel. Everything rides official NPM SDK packages —
 * no dsh source changes.
 */

import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { PluginManager, type ManagerConfig } from './manager.ts'
import { makeRoutes } from './routes.ts'
import { pluginCheckTool, pluginRemoveTool, pluginUpdateTool } from './tools.ts'

/** Stable cordis plugin name. */
export const name = 'plugin-manager'

/** Services required before the plugin surfaces can mount. */
export const inject = ['webServer', 'tools', 'systemPrompt']

/**
 * Settings namespace of the plugin manager — the section the web settings
 * surface edits. Spelled here rather than imported: the browser half spells
 * the same value and must not depend on a Host package.
 */
export const PLUGIN_MANAGER_SETTINGS_NAMESPACE = settingsNamespace('dsh-plugin-manager')

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** Profile to manage; empty auto-detects (argv --profile, then `web`). */
  profile?: string
  /** Explicit profile list; empty auto-detects the profiles mounting this plugin. */
  profiles?: string[]
  /** npm registry base URL for version checks. */
  registry?: string
  /** Explicit pnpm binary path; empty auto-detects. */
  pnpmPath?: string
  /** Master switch for the plugin (routes, tools, prompt section). */
  enabled?: boolean
  /** When true (default), a system-prompt section announces the plugin. */
  announceToAgent?: boolean
}

export const Config: z<Config> = z.object({
  profile: z.string().description('要管理的 profile 名称（留空自动检测，默认 web）。'),
  profiles: z.array(z.string()).description('要管理的 profile 列表（留空自动检测安装了本插件的所有 profile）。'),
  registry: z.string().description('npm registry 地址（默认 https://registry.npmjs.org）。'),
  pnpmPath: z.string().description('pnpm 可执行文件路径（留空自动检测）。'),
  enabled: z.boolean().default(true).description('插件总开关。'),
  announceToAgent: z.boolean().default(true).description('向 agent 公告本插件。'),
})

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 160

/** Model-facing announcement: plugin presence, capabilities, and limits. */
const PLUGIN_MANAGER_GUIDANCE = '本机已安装 dsh-plugin-manager 插件（DSH 第三方插件管理器）：侧边栏「插件管理」入口；自动检测并管理所有安装了本插件的 dsh profile（如 web / desktop）中通过 pnpm 安装的第三方插件（包名/版本/git 仓库，含 GitHub 安装的插件），面板内可切换 profile。能力：dsh_plugin_check 列出已装插件并检测更新（npm registry 或 git ls-remote）、dsh_plugin_update 通过 pnpm 更新单个或全部可更新插件、dsh_plugin_remove 删除单个第三方插件（均可加 profile 参数指定 profile）；面板内可一键更新/删除。限制：更新/删除只改对应 profile 的依赖与 lock 文件；host 端新代码需重启 DSH 生效；需网络与 pnpm；本地 link 安装的插件需在源码目录自行更新。用户提到「插件更新 / 升级插件 / 检查插件版本 / 删除插件 / 卸载插件」时即指本插件，请据此协作。'

/**
 * Mount the plugin manager service, routes, tools, and announcement.
 * @param ctx - host plugin context carrying webServer/tools/systemPrompt.
 * @param config - resolved plugin config (schema defaults applied by the loader).
 */
export function apply(ctx: Context, config?: Config): void {
  let current: () => Config = () => config ?? {}
  const resolve = (): Config => ({
    ...current(),
    enabled: current().enabled ?? true,
    announceToAgent: current().announceToAgent ?? true,
  })

  const manager = new PluginManager({ config: resolve })

  let disposeRoutes: (() => void) | undefined
  let disposeTools: (() => void) | undefined
  let disposeSection: (() => void) | undefined

  // Register (or drop) every surface to match the current source. Each group
  // is kept under one disposer: re-registering first tears the old one down
  // so duplicate-name registrations never throw.
  const sync = (): void => {
    if (disposeSection !== undefined) {
      disposeSection()
      disposeSection = undefined
    }
    if (disposeRoutes !== undefined) {
      disposeRoutes()
      disposeRoutes = undefined
    }
    if (disposeTools !== undefined) {
      disposeTools()
      disposeTools = undefined
    }
    const value = resolve()
    if (!value.enabled) return
    if (value.announceToAgent) {
      disposeSection = ctx.systemPrompt.section({
        name: 'plugin:dsh-plugin-manager',
        order: SECTION_ORDER,
        text: PLUGIN_MANAGER_GUIDANCE,
      })
    }
    const routes = makeRoutes(manager)
    disposeRoutes = ctx.effect(
      () => {
        const disposers = routes.map(route => ctx.webServer.register(route))
        return () => { for (const dispose of disposers) dispose() }
      },
      'dsh-plugin-manager: routes',
    )
    const tools = [pluginCheckTool(manager), pluginUpdateTool(manager), pluginRemoveTool(manager)]
    disposeTools = ctx.effect(
      () => {
        const disposers = tools.map(tool => ctx.tools.register(tool))
        return () => { for (const dispose of disposers) dispose() }
      },
      'dsh-plugin-manager: tools',
    )
  }

  installSettingsSection(ctx, PLUGIN_MANAGER_SETTINGS_NAMESPACE, Config, config ?? {}, {
    setSource: (source) => {
      current = source
      sync()
    },
    onChange: sync,
  })

  // Initial registration from the composition entry (covers deployments with
  // no settings service, whose installSettingsSection never fires its hooks).
  sync()
}

export { PluginManager, classifySpec, findPnpm, specToRepositoryUrl } from './manager.ts'
export type { ManagerConfig }
export type { PluginEntry, ProfileSummary, UpdateResult } from './protocol.ts'
