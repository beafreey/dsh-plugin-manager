#!/usr/bin/env bash
# =============================================================================
# dsh-plugin-manager 一键安装脚本（GitHub 直装，macOS / Linux / Windows Git Bash）
#
# 通过 DSH 官方插件命令从 GitHub 安装并自动挂载：
#   dsh plugin --profile web add github:beafreey/dsh-plugin-manager
#
# 仓库已提交 lib/ 构建产物，git 安装无需执行任何构建脚本，
# 因此不触发 pnpm 11 的 build-script 审批（allowBuilds）。
# 包内声明了 dsh.bundle.patch（cordis.patch.yml）：CLI 的 bundle 协调会把
# 它自动加进 profile 的 dsh.profile.bundles，下次启动即挂载。
#
# 用法：
#   bash scripts/install.sh [--restart] [--dry-run] [-h|--help]
#
#   --restart   装完后尝试重启 DSH（探测 `pm2 restart dsh-web`，无 pm2 仅提示）
#   --dry-run   只打印将要执行的操作，不写任何文件
#   -h/--help   打印本帮助
#
# 环境（均可省略，脚本会自动探测）：
#   DSH_PROFILE  默认 web
#   DSH_CMD      默认优先 PATH 上的 `dsh`，缺省回退 npx -y --package @deepseek-ai/dsh
#                （DSH_CMD 需为不含空格的可执行名；若 dsh 位于带空格路径，
#                 请把该目录加入 PATH 后用默认探测）
#
# 卸载：dsh plugin --profile web remove dsh-plugin-manager
#       （或在插件面板里点「删除」）
# =============================================================================
set -euo pipefail

REPO="github:beafreey/dsh-plugin-manager"
PROFILE="${DSH_PROFILE:-web}"

for arg in "$@"; do
  case "$arg" in
    -h|--help)
      cat <<'EOF'
dsh-plugin-manager 一键安装脚本

用法：bash scripts/install.sh [--restart] [--dry-run]

  --restart   装完后尝试 `pm2 restart dsh-web`（无 pm2 时仅打印提示）
  --dry-run   只打印将要执行的操作，不写任何文件
  -h/--help   打印本帮助

环境变量：DSH_PROFILE（默认 web）、DSH_CMD（默认自动探测）
卸载：dsh plugin --profile web remove dsh-plugin-manager
EOF
      exit 0
      ;;
    --dry-run) DRY_RUN=1 ;;
    --restart) RESTART=1 ;;
    *) echo "未知参数：$arg（用 -h 查看帮助）" >&2; exit 2 ;;
  esac
done

if command -v dsh >/dev/null 2>&1; then
  DSH_CMD="dsh"
else
  DSH_CMD="npx -y --package @deepseek-ai/dsh dsh"
fi

CMD="$DSH_CMD plugin --profile $PROFILE add $REPO"

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "将执行：$CMD"
  exit 0
fi

echo "==> 安装 dsh-plugin-manager（profile: $PROFILE）"
if ! $CMD; then
  echo "安装失败。请确认：已安装 pnpm 与 Node.js ≥ 20，且 `dsh` 命令可用（或设置 DSH_CMD）。" >&2
  exit 1
fi

echo ""
echo "==> 安装完成。请完全退出并重新打开 DSH，侧边栏即出现「插件管理」入口。"
if [ "${RESTART:-0}" = "1" ]; then
  if command -v pm2 >/dev/null 2>&1; then
    pm2 restart dsh-web || true
  else
    echo "（未检测到 pm2，请手动重启 DSH）"
  fi
fi
