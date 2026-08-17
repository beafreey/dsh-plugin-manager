/**
 * dsh-plugin-manager styles. One CSS string injected as a <style> tag on
 * mount (no bundler CSS pipeline needed). Scoped by the plugin's own class
 * prefix and data attributes so nothing leaks into the rest of the GUI;
 * colors ride the dsh --dsw-* tokens so the panel follows the active theme.
 * The center-column hide rules are attribute-scoped and must stay in this
 * stylesheet (it is imported by mount.tsx, so the styles load with the
 * plugin).
 */

export const PANEL_CSS = `
/* --- center-column takeover (global rules, attribute-scoped) ----------------- */

[data-pane='conversation'] {
  position: relative;
}

[data-dsh-pluginmanager-view] {
  position: absolute;
  inset: 0;
  display: none;
  /* Above the conversation composer so the panel paints over the input card. */
  z-index: 60;
  /* Opaque backdrop: the conversation subtree stays mounted under the panel. */
  background: var(--dsw-alias-bg-base, #ffffff);
}

/* The center column is single-occupant; the :not() guards keep the sibling
   panels (task board / ssh) from fighting over visibility if activation
   attributes ever coexist. */
html[data-dsh-pluginmanager-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [data-dsh-pluginmanager-view] {
  display: block;
}

html[data-dsh-pluginmanager-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [data-pane='conversation'] > :not([data-dsh-pluginmanager-view]),
html[data-dsh-pluginmanager-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [class*='centerCol'] > :not([data-dsh-pluginmanager-view]) {
  display: none !important;
}

/* --- sidebar entry row ------------------------------------------------------- */

.dshpm-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 32px;
  padding: 0 12px;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: var(--dsw-alias-label-secondary, #8a8f98);
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
}

.dshpm-entry:hover {
  background: var(--dsw-specific-sidebar-nav-item-hover, rgba(127, 127, 127, 0.12));
  color: var(--dsw-alias-label-primary, #22252b);
}

.dshpm-entry[data-active] {
  background: var(--dsw-specific-sidebar-nav-item-active, rgba(127, 127, 127, 0.18));
  color: var(--dsw-alias-label-primary, #22252b);
  font-weight: 600;
}

.dshpm-entryIcon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.dshpm-entryLabel {
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Collapsed rail: icon-only, centered. */
[data-dsh-frame][data-sidebar-collapsed] .dshpm-entry {
  justify-content: center;
  padding: 0;
  width: 100%;
}

[data-dsh-frame][data-sidebar-collapsed] .dshpm-entryLabel {
  display: none;
}

/* --- panel frame -------------------------------------------------------------- */

.dshpm-view {
  overflow: hidden;
}

.dshpm-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
  padding: 14px 16px 16px;
  gap: 10px;
  background: var(--dsw-alias-bg-base, #ffffff);
  color: var(--dsw-alias-label-primary, #22252b);
  font-family: var(--dsw-font-family, inherit);
}

.dshpm-panelHeader {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}

.dshpm-panelTitle {
  margin: 0;
  flex: 1;
  font-size: 16px;
  font-weight: 700;
  color: var(--dsw-alias-label-primary, #22252b);
  white-space: nowrap;
}

/* --- toolbar / controls ------------------------------------------------------- */

.dshpm-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  flex-wrap: wrap;
}

.dshpm-toolbarSpacer {
  flex: 1;
}

/* --- tables ------------------------------------------------------------------- */

.dshpm-tableWrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.2));
  border-radius: 10px;
}

.dshpm-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}

.dshpm-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 8px 10px;
  text-align: left;
  background: var(--dsw-alias-bg-layer-2, #f5f6f8);
  color: var(--dsw-alias-label-secondary, #8a8f98);
  font-weight: 600;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.2));
  white-space: nowrap;
}

.dshpm-table td {
  padding: 7px 10px;
  border-bottom: 1px solid var(--dsw-alias-separator-primary, rgba(127, 127, 127, 0.1));
  vertical-align: top;
}

.dshpm-table tbody tr:last-child td {
  border-bottom: none;
}

.dshpm-table tbody tr:hover td {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.08));
}

.dshpm-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.dshpm-strong {
  font-weight: 600;
}

.dshpm-muted {
  color: var(--dsw-alias-label-tertiary, #b3b6bd);
}

.dshpm-tiny {
  font-size: 11px;
}

.dshpm-error-text {
  color: var(--dsw-alias-state-error-primary, #e5484d);
  overflow-wrap: anywhere;
}

.dshpm-link {
  color: var(--dsw-alias-state-business-primary, #3b82f6);
  text-decoration: none;
  overflow-wrap: anywhere;
}

.dshpm-link:hover {
  text-decoration: underline;
}

.dshpm-inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  white-space: nowrap;
}

/* --- badges ------------------------------------------------------------------- */

.dshpm-badge {
  display: inline-block;
  padding: 1px 8px;
  font-size: 11px;
  line-height: 1.6;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.25));
  color: var(--dsw-alias-label-secondary, #8a8f98);
  white-space: nowrap;
}

.dshpm-badge[data-kind='ok'] {
  color: var(--dsw-alias-state-success-primary, #30a46c);
  border-color: var(--dsw-alias-state-success-primary, #30a46c);
}

.dshpm-badge[data-kind='warn'] {
  color: var(--dsw-alias-state-warn-primary, #f0a020);
  border-color: var(--dsw-alias-state-warn-primary, #f0a020);
}

.dshpm-badge[data-kind='fail'] {
  color: var(--dsw-alias-state-error-primary, #e5484d);
  border-color: var(--dsw-alias-state-error-primary, #e5484d);
}

.dshpm-badge[data-kind='info'],
.dshpm-badge[data-kind='key'] {
  color: var(--dsw-alias-state-business-primary, #3b82f6);
  border-color: var(--dsw-alias-state-business-primary, #3b82f6);
}

/* --- buttons ------------------------------------------------------------------ */

.dshpm-primaryButton {
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary-foreground, #ffffff);
  background: var(--dsw-alias-button-info-fill, #3b82f6);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  white-space: nowrap;
}

.dshpm-primaryButton:hover:not(:disabled) {
  background: var(--dsw-alias-button-info-hover, #2f6fe0);
}

.dshpm-primaryButton:disabled {
  opacity: 0.5;
  cursor: default;
}

.dshpm-ghostButton {
  padding: 5px 12px;
  font-size: 12px;
  color: var(--dsw-alias-label-primary, #22252b);
  background: transparent;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.25));
  border-radius: 8px;
  cursor: pointer;
  white-space: nowrap;
}

.dshpm-ghostButton:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.08));
}

.dshpm-ghostButton:disabled {
  opacity: 0.45;
  cursor: default;
}

.dshpm-dangerButton {
  color: var(--dsw-alias-state-error-primary, #e5484d);
  border-color: var(--dsw-alias-state-error-primary, #e5484d);
}

.dshpm-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

/* --- profile tab bar -------------------------------------------------------- */

.dshpm-tabBar {
  display: flex;
  gap: 2px;
  flex: none;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.2));
  overflow-x: auto;
}

.dshpm-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  font-size: 13px;
  color: var(--dsw-alias-label-secondary, #8a8f98);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 6px 6px 0 0;
  cursor: pointer;
  white-space: nowrap;
}

.dshpm-tab:hover {
  color: var(--dsw-alias-label-primary, #22252b);
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.08));
}

.dshpm-tab[data-active] {
  color: var(--dsw-alias-label-primary, #22252b);
  font-weight: 600;
  border-bottom-color: var(--dsw-alias-state-business-primary, #3b82f6);
}

.dshpm-tabCount {
  display: inline-block;
  min-width: 16px;
  padding: 0 5px;
  font-size: 11px;
  line-height: 1.5;
  text-align: center;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.1));
  color: var(--dsw-alias-label-tertiary, #b3b6bd);
}

.dshpm-tabCount[data-outdated] {
  background: var(--dsw-alias-state-warn-primary, #f0a020);
  color: #ffffff;
}

/* --- spinner / banners / states ------------------------------------------------ */

.dshpm-spinner {
  display: inline-block;
  width: 11px;
  height: 11px;
  flex: none;
  border: 2px solid var(--dsw-alias-state-business-primary, #3b82f6);
  border-top-color: transparent;
  border-radius: 50%;
  animation: dshpmSpin 800ms linear infinite;
  vertical-align: -1px;
}

@keyframes dshpmSpin {
  to { transform: rotate(360deg); }
}

.dshpm-banner {
  padding: 8px 12px;
  font-size: 12.5px;
  line-height: 1.5;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.25));
  color: var(--dsw-alias-label-secondary, #8a8f98);
  overflow-wrap: anywhere;
}

.dshpm-banner[data-kind='ok'] {
  color: var(--dsw-alias-state-success-primary, #30a46c);
  border-color: var(--dsw-alias-state-success-primary, #30a46c);
}

.dshpm-banner[data-kind='error'] {
  color: var(--dsw-alias-state-error-primary, #e5484d);
  border-color: var(--dsw-alias-state-error-primary, #e5484d);
}

.dshpm-banner[data-kind='info'] {
  color: var(--dsw-alias-state-business-primary, #3b82f6);
  border-color: var(--dsw-alias-state-business-primary, #3b82f6);
}

.dshpm-empty,
.dshpm-loading {
  padding: 28px 12px;
  text-align: center;
  font-size: 12.5px;
  color: var(--dsw-alias-label-tertiary, #b3b6bd);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.dshpm-details {
  flex: none;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, #8a8f98);
}

.dshpm-details summary {
  cursor: pointer;
}

.dshpm-pre {
  margin: 6px 0 0;
  padding: 8px 10px;
  max-height: 180px;
  overflow: auto;
  background: var(--dsw-alias-bg-layer-2, #f5f6f8);
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.25));
  border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px;
  white-space: pre-wrap;
  word-break: break-all;
}
`

/** Style tag id so repeated mounts never duplicate the sheet. */
const STYLE_ID = 'dsh-plugin-manager-styles'

/** Inject the stylesheet once (idempotent). */
export function injectStyles(): void {
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = PANEL_CSS
  document.head.appendChild(style)
}
