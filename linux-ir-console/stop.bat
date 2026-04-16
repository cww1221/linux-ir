@echo off
setlocal EnableExtensions

cd /d "%~dp0"

set "PROC=linux-ir-console.exe"

echo [*] 结束进程: %PROC% （含子进程 /T）

REM /F 强制 /T 结束进程树（WebView2 等子进程一并清理）
taskkill /F /T /IM "%PROC%" >nul 2>&1
if errorlevel 1 (
  echo [!] 未发现运行中的进程，或权限不足。
  exit /b 0
)

echo [+] 已结束。
exit /b 0
