/**
 * The plugin manager panel: profile tab bar, per-profile plugin table (name,
 * installed version, latest version, state, repository), check/update/remove
 * actions, and the restart hint. Pure view over the controller snapshot
 * (useSyncExternalStore).
 */

import { Component, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { PluginManagerController, PanelSnapshot } from './controller.ts'
import type { PluginEntry } from '../protocol.ts'

/** Error boundary: a render failure must show a message, never a blank panel. */
class PanelErrorBoundary extends Component<{ children: ReactNode }, { error: Error | undefined }> {
  state: { error: Error | undefined } = { error: undefined }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  render(): ReactNode {
    if (this.state.error !== undefined) {
      return (
        <div className="dshpm-panel">
          <div className="dshpm-banner" data-kind="error">
            面板渲染失败：{this.state.error.message}
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

/** State badge labels and kinds (fallback kept out-of-band for strictness). */
const STATE_META: Record<string, { label: string; kind: string }> = {
  unknown: { label: '未检查', kind: 'muted' },
  checking: { label: '检查中', kind: 'info' },
  current: { label: '已是最新', kind: 'ok' },
  outdated: { label: '可更新', kind: 'warn' },
  error: { label: '检查失败', kind: 'fail' },
}
const STATE_FALLBACK = { label: '未检查', kind: 'muted' }

/** Short repo display text. */
function repoLabel(url: string | undefined): string {
  if (url === undefined) return '—'
  return url.replace(/^https?:\/\/(www[.])?/, '').replace(/\/$/, '')
}

/** Render one plugin row. */
function PluginRow(props: {
  entry: PluginEntry
  updating: boolean
  busy: boolean
  onUpdate: (name: string) => void
  onRemove: (name: string) => void
}): JSX.Element {
  const { entry, updating, busy, onUpdate, onRemove } = props
  const [confirming, setConfirming] = useState(false)
  const meta = STATE_META[entry.state] ?? STATE_FALLBACK
  const local = entry.kind === 'local'
  const canUpdate = !updating && !busy && !local && entry.state !== 'unknown'
  const canRemove = !updating && !busy
  return (
    <tr>
      <td>
        <div className="dshpm-mono dshpm-strong">{entry.name}</div>
        <div className="dshpm-muted dshpm-tiny">{entry.spec}{local ? '（本地 link 安装）' : ''}</div>
      </td>
      <td className="dshpm-mono">{entry.version}</td>
      <td className="dshpm-mono">
        {entry.state === 'checking' ? <span className="dshpm-spinner" /> : entry.latest ?? '—'}
        {entry.latestSource === 'git' && entry.latest !== undefined ? (
          <span className="dshpm-muted dshpm-tiny"> git</span>
        ) : null}
      </td>
      <td>
        <span className="dshpm-badge" data-kind={meta.kind}>{meta.label}</span>
        {entry.error !== undefined && entry.error !== '' ? (
          <div className="dshpm-muted dshpm-tiny dshpm-error-text">{entry.error}</div>
        ) : null}
      </td>
      <td>
        {entry.repository !== undefined ? (
          <a className="dshpm-link" href={entry.repository} target="_blank" rel="noreferrer noopener" title={entry.repository}>
            {repoLabel(entry.repository)}
          </a>
        ) : (
          <span className="dshpm-muted">—</span>
        )}
      </td>
      <td>
        {updating ? (
          <span className="dshpm-inline dshpm-muted"><span className="dshpm-spinner" />处理中…</span>
        ) : confirming ? (
          <span className="dshpm-actions">
            <button
              type="button"
              className="dshpm-ghostButton"
              disabled={!canRemove}
              onClick={() => { setConfirming(false); onRemove(entry.name) }}
            >
              确认删除
            </button>
            <button
              type="button"
              className="dshpm-ghostButton"
              onClick={() => { setConfirming(false) }}
            >
              取消
            </button>
          </span>
        ) : (
          <span className="dshpm-actions">
            {local ? (
              <span className="dshpm-muted dshpm-tiny">本地链接，请在源码目录更新</span>
            ) : (
              <button
                type="button"
                className="dshpm-ghostButton"
                disabled={!canUpdate}
                title={entry.state === 'unknown' ? '先检查更新' : `更新 ${entry.name} 到最新版本`}
                onClick={() => { onUpdate(entry.name) }}
              >
                更新
              </button>
            )}
            <button
              type="button"
              className="dshpm-ghostButton dshpm-dangerButton"
              disabled={!canRemove}
              title={`从 profile 中删除 ${entry.name}`}
              onClick={() => { setConfirming(true) }}
            >
              删除
            </button>
          </span>
        )}
      </td>
    </tr>
  )
}

/** The panel root component. */
export function PluginManagerPanel(props: { controller: PluginManagerController }): JSX.Element {
  const { controller } = props
  // Stable references straight off the controller: getSnapshot MUST return
  // the same object between emits or useSyncExternalStore loops forever.
  const snapshot: PanelSnapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot)

  const active = snapshot.active
  const activeView = controller.activeView()
  const plugins = activeView?.plugins ?? []
  const activeSummary = activeView?.profile
  const outdatedCount = plugins.filter(entry => entry.state === 'outdated').length
  const busy = snapshot.updating.size > 0 || snapshot.checking || snapshot.loading

  return (
    <PanelErrorBoundary>
      <div className="dshpm-panel">
        <div className="dshpm-panelHeader">
          <h2 className="dshpm-panelTitle">插件管理</h2>
          {activeSummary !== undefined ? (
            <span className="dshpm-badge" data-kind="info" title={activeSummary.dir}>
              {activeSummary.name}
            </span>
          ) : null}
          {activeSummary?.pnpm !== undefined ? (
            <span className="dshpm-badge" data-kind="key" title={activeSummary.pnpm}>pnpm ✓</span>
          ) : activeSummary !== undefined ? (
            <span className="dshpm-badge" data-kind="fail" title="找不到 pnpm，无法更新">pnpm ✗</span>
          ) : null}
        </div>

        {snapshot.profiles.length > 1 ? (
          <div className="dshpm-tabBar">
            {snapshot.profiles.map(view => (
              <button
                key={view.profile.name}
                type="button"
                className="dshpm-tab"
                data-active={view.profile.name === active ? 'true' : undefined}
                onClick={() => { controller.setActive(view.profile.name) }}
              >
                {view.profile.name}
                <span className="dshpm-tabCount" data-outdated={view.plugins.some(entry => entry.state === 'outdated') ? 'true' : undefined}>
                  {view.plugins.length}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {snapshot.needsRestart ? (
          <div className="dshpm-banner" data-kind="info">
            已更新插件。host 端新代码需要 <b>重启 DSH</b>（完全退出后重新打开）才会加载；浏览器侧刷新页面即可加载新的 client 代码。
          </div>
        ) : null}
        {snapshot.banner !== undefined ? (
          <div className="dshpm-banner" data-kind={snapshot.banner.kind}>{snapshot.banner.text}</div>
        ) : null}

        <div className="dshpm-toolbar">
          <button type="button" className="dshpm-primaryButton" disabled={busy} onClick={() => { void controller.check(active || undefined) }}>
            {snapshot.checking ? '检查中…' : '检查更新'}
          </button>
          <button
            type="button"
            className="dshpm-primaryButton"
            disabled={busy || outdatedCount === 0 || active === ''}
            title={outdatedCount === 0 ? '没有可更新的插件' : `更新 ${outdatedCount} 个可更新插件`}
            onClick={() => { if (active !== '') void controller.updateAll(active) }}
          >
            全部更新{outdatedCount > 0 ? `（${outdatedCount}）` : ''}
          </button>
          <button type="button" className="dshpm-ghostButton" disabled={busy} onClick={() => { void controller.load(false) }}>
            刷新列表
          </button>
          <span className="dshpm-toolbarSpacer" />
          <span className="dshpm-muted dshpm-tiny">
            {snapshot.profiles.length} 个 profile · 共 {plugins.length} 个第三方插件 · 检查源：{activeSummary?.registry ?? 'npm registry'} + git
          </span>
        </div>

        <div className="dshpm-tableWrap">
          {snapshot.loading && snapshot.profiles.length === 0 ? (
            <div className="dshpm-loading"><span className="dshpm-spinner" /> 正在读取 profile 插件列表…</div>
          ) : snapshot.profiles.length === 0 ? (
            <div className="dshpm-empty">没有检测到可管理的 dsh profile。</div>
          ) : plugins.length === 0 ? (
            <div className="dshpm-empty">
              profile「{active}」没有通过 pnpm 安装的第三方插件。
              <div className="dshpm-tiny">在命令行执行 <code className="dshpm-mono">dsh plugin --profile {active} add &lt;包名&gt;</code> 即可安装。</div>
            </div>
          ) : (
            <table className="dshpm-table">
              <thead>
                <tr>
                  <th>插件</th>
                  <th>当前版本</th>
                  <th>最新版本</th>
                  <th>状态</th>
                  <th>仓库</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {plugins.map(entry => (
                  <PluginRow
                    key={entry.name}
                    entry={entry}
                    updating={snapshot.updating.has(`${active}\u0000${entry.name}`)}
                    busy={busy}
                    onUpdate={(name) => { if (active !== '') void controller.update(active, name) }}
                    onRemove={(name) => { if (active !== '') void controller.remove(active, name) }}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {snapshot.lastUpdateOutput !== '' ? (
          <details className="dshpm-details">
            <summary>最近一次 pnpm 更新输出</summary>
            <pre className="dshpm-pre">{snapshot.lastUpdateOutput}</pre>
          </details>
        ) : null}
      </div>
    </PanelErrorBoundary>
  )
}
