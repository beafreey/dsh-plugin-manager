# dsh-plugin-manager

DSH Web GUI 的第三方插件管理器：列出本地 profile 中通过 pnpm 安装的第三方插件（包名 / 版本 / git 仓库），检测更新（npm registry + `git ls-remote`），面板内一键 pnpm 更新。热插拔 —— 通过 profile 的 node_modules 依赖挂载，无需改动 dsh 源码。

## 能力

- **插件清单**：读取 `~/.dsh/profiles/<profile>/package.json` 的 dependencies，逐包解析安装目录中的 package.json，展示版本、仓库地址、是否为 bundle（声明了 `dsh.bundle.patch`）。
- **更新检查**：
  - registry 安装的包 → 查询 npm registry（默认 `https://registry.npmjs.org`，可在插件设置里改）；
  - git 安装的包（`git+...` / `github:...` 等 spec）→ `git ls-remote` 比较默认分支 HEAD 与安装时记录的 `gitHead`；
  - `link:` / `file:` 本地包 → 标记为本地链接，跳过检查。
- **一键更新**：面板内对单个插件或全部可更新插件执行 pnpm（`pnpm add <包名>@latest --save-exact`，git 包用 `pnpm up`）；同一时刻只允许一个更新在跑。更新完成后提示重启 DSH（host 端新代码需重启加载，client 端刷新页面即可）。
- **Agent 工具**：`dsh_plugin_check`（列出插件并检测更新）、`dsh_plugin_update`（更新单个或全部可更新插件），与面板共用同一套服务。
- **设置项**（DSH 设置页插件区，命名空间 `dsh-plugin-manager`）：profile 名称（默认自动检测，缺省 `web`）、registry 地址、pnpm 路径、总开关、agent 公告开关。

## 安装

```bash
# 开发/本地安装（link 到源码目录，改代码后重新构建 + 重启 DSH 即可生效）
dsh plugin --profile web add link:/绝对路径/dsh-plugin-manager

# 或手动等价操作：
#   1. 在 ~/.dsh/profiles/web/package.json 的 dependencies 中加入
#      "dsh-plugin-manager": "link:/绝对路径/dsh-plugin-manager"
#   2. 在 dsh.profile.bundles 中加入 "dsh-plugin-manager"
#   3. 在 profile 目录执行 pnpm install
```

安装后**完全退出并重新打开 DSH**（host 端代码在启动时加载）；侧边栏出现「插件管理」入口。

## 构建

```bash
pnpm install          # 安装依赖（devDependencies 仅用于构建）
pnpm run typecheck    # tsc 类型检查
pnpm run build        # 产物：lib/index.js（host）、lib/client.js（client bundle）、lib/types/
```

- host 产物：rolldown ESM bundle，`@deepseek-ai/*`、`schemastery`、node 内置模块保持 external，由 host 运行时解析；
- client 产物：单 chunk CJS，包进 `window.__ModuleLoader__.load({...})` 交接块，由 dsh web shell 以 `/plugins/plugin-manager/client.js` 提供；react/react-dom 打包在内，样式由 JS 在挂载时注入 `<style>`。

## 目录结构

```
src/
  index.ts        host 入口：cordis 插件（name/inject/apply），注册路由、工具、设置区、agent 公告
  manager.ts      核心服务：profile 解析、插件清单、registry/git 更新检查、pnpm 更新（单飞锁）
  routes.ts       /api/dsh-plugin-manager/*（仅 loopback + 同源标记放行）
  tools.ts        dsh_plugin_check / dsh_plugin_update
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
  build.mjs       rolldown 构建 host/client 产物
  smoke.mjs       本地冒烟测试（直接读本机 web profile）
```

## 安全与限制

- 所有 `/api` 路由仅接受 loopback + 浏览器同源请求（更新操作会改动用户 profile，局域网暴露的 dsh 部署不应可触发）；
- 更新依赖宿主机有 pnpm 与网络；GUI 启动的进程 PATH 可能缺 pnpm，插件会按设置项 → PATH → 常见安装路径顺序查找；
- `link:` 本地包不会被动更新（需在源码目录自行更新）；
- 面板只管理当前 profile 的 dependencies（即第三方插件）；dsh 内置 bundle（`@deepseek-ai/dsh-base` 等）不在 dependencies 中，不受影响。

## 说明

侧边栏入口与中央面板挂载方式沿用了 dsh-web-ui（Apache-2.0）中 dsh-ssh / dsh-task-board 的 DOM 级扩展约定（`data-*` 激活属性 + `dsh-panel-activate` 互斥事件），以便三个插件在同一侧边栏与中央列和平共存。
