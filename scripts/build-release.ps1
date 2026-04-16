# 正式打包：请用 Wails CLI（自动带 production 标签与前端嵌入）
Set-Location $PSScriptRoot\..
if (-not (Get-Command wails -ErrorAction SilentlyContinue)) {
    Write-Error "未找到 wails 命令，请先安装: go install github.com/wailsapp/wails/v2/cmd/wails@latest"
    exit 1
}
wails build
