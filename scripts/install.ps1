# =============================================================================
# dsh-plugin-manager 一键安装脚本（GitHub 直装，Windows PowerShell 5.1+ / pwsh）
#
# 通过 DSH 官方插件命令从 GitHub 安装并自动挂载：
#   dsh plugin --profile web add github:beafreey/dsh-plugin-manager
#
# 仓库已提交 lib/ 构建产物，git 安装无需执行任何构建脚本，
# 因此不触发 pnpm 11 的 build-script 审批（allowBuilds）。
#
# 用法（任选其一）：
#   irm https://raw.githubusercontent.com/beafreey/dsh-plugin-manager/main/scripts/install.ps1 | iex
#   & ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/beafreey/dsh-plugin-manager/main/scripts/install.ps1'))) -Restart
#   powershell -ExecutionPolicy Bypass -File install.ps1 -DryRun
#
# 参数：
#   -Profile     profile 名，默认 web
#   -Restart     装完后尝试 `pm2 restart dsh-web`（无 pm2 仅提示）
#   -DryRun      只打印将要执行的操作，不写任何文件
#
# 环境变量：
#   DSH_CMD      默认优先 PATH 上的 dsh，缺省回退 npx -y --package @deepseek-ai/dsh
#                （DSH_CMD 需为不含空格的可执行名；若 dsh 位于带空格路径，
#                 请把该目录加入 PATH 后用默认探测）
#
# 卸载：dsh plugin --profile web remove dsh-plugin-manager
#       （或在插件面板里点「删除」）
# =============================================================================
param(
  [string]$Profile = $env:DSH_PROFILE,
  [switch]$Restart,
  [switch]$DryRun
)

if (-not $Profile) { $Profile = "web" }

$Repo = "github:beafreey/dsh-plugin-manager"

$dsh = Get-Command dsh -ErrorAction SilentlyContinue
if ($dsh) {
  $DSH_CMD = "dsh"
} else {
  $DSH_CMD = "npx -y --package @deepseek-ai/dsh dsh"
}

$CMD = "$DSH_CMD plugin --profile $Profile add $Repo"

if ($DryRun) {
  Write-Host "将执行：$CMD"
  exit 0
}

Write-Host "==> 安装 dsh-plugin-manager（profile: $Profile）"
Invoke-Expression $CMD
if ($LASTEXITCODE -ne 0) {
  Write-Error "安装失败。请确认：已安装 pnpm 与 Node.js >= 20，且 dsh 命令可用（或设置 DSH_CMD）。"
  exit 1
}

Write-Host ""
Write-Host "==> 安装完成。请完全退出并重新打开 DSH，侧边栏即出现「插件管理」入口。"
if ($Restart) {
  $pm2 = Get-Command pm2 -ErrorAction SilentlyContinue
  if ($pm2) {
    pm2 restart dsh-web
  } else {
    Write-Host "（未检测到 pm2，请手动重启 DSH）"
  }
}
