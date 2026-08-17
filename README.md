# dsh-plugin-manager

<!-- Hero -->
<div align="center">
  <b style="font-size: 1.15em;">DSH 第三方插件管理器：查看 · 检查更新 · 一键更新/删除</b><br /><br />
  <a href="https://www.apache.org/licenses/LICENSE-2.0"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" /></a>
  <a href="https://dshfind.com/zh/plugins/beafreey/dsh-plugin-manager?ref=badge"><img alt="dshfind" src="https://dshfind.com/api/badge/beafreey/dsh-plugin-manager?lang=zh" /></a><br /><br />
  <img alt="插件清单" src="https://img.shields.io/badge/-插件清单-4d6bfe" />
  <img alt="更新检查" src="https://img.shields.io/badge/-更新检查-4d6bfe" />
  <img alt="一键更新" src="https://img.shields.io/badge/-一键更新-4d6bfe" />
  <img alt="删除插件" src="https://img.shields.io/badge/-删除插件-4d6bfe" />
  <img alt="GitHub 安装兼容" src="https://img.shields.io/badge/-GitHub%20安装兼容-4d6bfe" /><br /><br />
  <b>侧边栏「插件管理」入口 + 中央面板</b>——管理 web profile 里通过 pnpm 安装的所有第三方插件，<br />
  从此不用再逐个关注插件的 GitHub 仓库有没有更新。
</div>

## ✨ 功能一览

- **📋 插件清单**：读取 `~/.dsh/profiles/<profile>/package.json` 的 dependencies，逐包解析出包名、版本、git 仓库、安装方式（registry / git / 本地 link），并标识是否声明了 `dsh.bundle.patch`
- **👥 多 profile 管理**：自动检测并管理所有安装了本插件的 profile（如 `web` / `desktop`，可在设置里用 `profiles` 显式指定）；面板顶部 profile 页签切换，每个 profile 独立查看/检查/更新/删除，互不干扰（每 profile 各自单飞锁，可跨 profile 并发）
- **🔍 更新检查**（npm registry + git 双源）：
  - registry 安装的包 → 查询 npm registry 最新版本（registry 地址可在插件设置里改）
  - GitHub / Git 安装的包（`github:用户/仓库`、`git+https://...`、`gitlab:`、`bitbucket:`）→ `git ls-remote` 比对默认分支 HEAD；即使包内没写 `repository` 字段也会从依赖 spec 推导地址；已安装提交从 `pnpm-lock.yaml` 读取（兼容 pnpm 11 不写 `gitHead` 的行为）
  - 本地 link/file 安装 → 标记本地链接，跳过检查（请在源码目录自行更新）
- **⬆️ 一键更新**：单个插件或全部可更新插件；registry 包按**精确最新版本**安装（`pnpm add <包>@<最新版> --save-exact`，绕开 pnpm 11 release-age 策略把 `@latest` 解析成旧版导致的降级），git 包用 `pnpm up`；spawn 时按该 profile 的 `.modules.yaml` 固定 pnpm store，避免 GUI 宿主环境与安装环境 store 不一致导致失败；更新后提示重启 DSH 生效
- **🗑️ 删除插件**：每行「删除」按钮（两段式确认），执行 `pnpm remove <包名>` 并自动从 `dsh.profile.bundles` 清单同步移除
- **🤖 Agent 工具**：`dsh_plugin_check`（列出+检测更新）、`dsh_plugin_update`（更新）、`dsh_plugin_remove`（删除），均可加 `profile` 参数指定 profile——在聊天里说「帮我看看哪些插件有新版本」即可执行
- **⚙️ 可配置**：`profiles` 列表（默认自动检测所有挂载本插件的 profile）、registry 地址、pnpm 路径、总开关、agent 公告开关

## 🚀 安装（下载方式）

**前置**：DSH 可正常运行，Node.js ≥ 20、pnpm 已装好。

### 方式一：一键脚本（推荐）

macOS / Linux（Windows 装了 Git Bash 也可）：

```bash
curl -fsSL https://raw.githubusercontent.com/beafreey/dsh-plugin-manager/main/scripts/install.sh | bash
```

Windows PowerShell 5.1+ / pwsh：

```powershell
irm https://raw.githubusercontent.com/beafreey/dsh-plugin-manager/main/scripts/install.ps1 | iex
```

### 方式二：DSH 插件命令直装

```bash
dsh plugin --profile web add github:beafreey/dsh-plugin-manager
```

> 仓库已提交 `lib/` 构建产物，git 安装**无需构建**，不会触发 pnpm 11 的 build-script 审批（allowBuilds）。包内声明了 `dsh.bundle.patch`，CLI 会自动把它挂进 profile 的 bundles。

### 方式三：克隆 + 本地链接（二次开发）

```bash
git clone https://github.com/beafreey/dsh-plugin-manager.git
cd dsh-plugin-manager
pnpm install && pnpm run build
dsh plugin --profile web add link:$(pwd)
```

任何方式装完后：**完全退出并重新打开 DSH**，侧边栏出现「插件管理」入口。

**卸载**：

```bash
dsh plugin --profile web remove dsh-plugin-manager
# 或在插件面板里直接点该插件的「删除」按钮
```

## 🔧 构建（开发者）

```bash
pnpm install          # 安装依赖（devDependencies 仅用于构建）
pnpm run typecheck    # tsc 类型检查
pnpm run build        # 产物：lib/index.js（host）、lib/client.js（client bundle）、lib/types/
```

- host 产物：rolldown ESM bundle，`@deepseek-ai/*`、`schemastery`、node 内置模块保持 external，由 host 运行时解析；
- client 产物：单 chunk CJS，包进 `window.__ModuleLoader__.load({...})` 交接块，由 dsh web shell 以 `/plugins/<id>/client.js` 提供；react/react-dom 打包在内，样式由 JS 在挂载时注入 `<style>`。

## 📁 目录结构

```
src/
  index.ts        host 入口：cordis 插件（name/inject/apply），注册路由、工具、设置区、agent 公告
  manager.ts      核心服务：profile 解析、插件清单、registry/git 更新检查、pnpm 更新/删除（单飞锁）
  routes.ts       /api/dsh-plugin-manager/*（仅 loopback + 同源标记放行）
  tools.ts        dsh_plugin_check / dsh_plugin_update / dsh_plugin_remove
  protocol.ts     host/client 共享的路径常量与类型
  invariant.ts    invariant 伴生模块（空实现）
  client/
    index.ts      client 入口：挂载侧边栏入口 + 中央面板
    controller.ts 面板状态机（列表 / 检查 / 更新中 / 重启提示）
    api.ts        /api 的 fetch 封装
    sidebar-entry.ts  侧边栏入口行（MutationObserver 自愈）
    mount.tsx     中央面板挂载（与 ssh/任务看板插件的互斥协议兼容）
    Panel.tsx     React 面板 UI
    styles.ts     样式字符串注入
scripts/
  build.mjs            rolldown 构建 host/client 产物
  install.sh/.ps1      一键安装脚本
  smoke.mjs            核心冒烟测试（直读本机 web profile）
  integration-smoke.mjs host 插件挂载测试（真实 cordis 上下文）
  client-smoke.mjs     client 端 jsdom 冒烟
  blank-panel-repro.mjs 面板渲染回归测试
  update-flow-test.mjs  更新/删除全链路测试（一次性副本 profile）
  git-flow-test.mjs      GitHub 安装插件兼容性测试
```

## 🔒 安全与限制

- 所有 `/api` 路由仅接受 loopback + 浏览器同源请求（更新/删除会改动用户 profile，局域网暴露的 dsh 部署不应可触发）；
- 更新/删除依赖宿主机有 pnpm 与网络；GUI 启动的进程 PATH 可能缺 pnpm，插件会按设置项 → PATH → 常见安装路径顺序查找；
- `link:` 本地包不会被面板自动更新（需在源码目录自行更新）；
- 面板只管理当前 profile 的 dependencies（即第三方插件）；dsh 内置 bundle（`@deepseek-ai/dsh-base` 等）不在 dependencies 中，不受影响；
- 更新/删除只改 profile 的依赖与 lock 文件；host 端新代码需重启 DSH 生效。

## 📝 说明

侧边栏入口与中央面板挂载方式沿用了 dsh-web-ui（Apache-2.0）中 dsh-ssh / dsh-task-board 的 DOM 级扩展约定（`data-*` 激活属性 + `dsh-panel-activate` 互斥事件），以便多个插件在同一侧边栏与中央列和平共存。

## 📄 许可证

[Apache-2.0](./LICENSE)
