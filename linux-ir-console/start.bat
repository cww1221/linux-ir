@echo off
setlocal EnableExtensions

cd /d "%~dp0"

set "EXE=%~dp0build\bin\linux-ir-console.exe"
set "WAILS="

REM 优先使用 PATH 中的 wails，其次 %USERPROFILE%\go\bin\wails.exe
where wails.exe >nul 2>&1 && set "WAILS=wails.exe"
if not defined WAILS if exist "%USERPROFILE%\go\bin\wails.exe" set "WAILS=%USERPROFILE%\go\bin\wails.exe"

if exist "%EXE%" (
  echo [+] 启动: "%EXE%"
  start "" "%EXE%"
  exit /b 0
)

echo [!] 未找到可执行文件: "%EXE%"
echo [*] 正在使用 Wails 编译（请使用与 go.mod 一致的 wails CLI，建议 v2.9.3）...

if not defined WAILS (
  echo [-] 未找到 wails.exe。
  echo     请安装: go install github.com/wailsapp/wails/v2/cmd/wails@v2.9.3
  echo     并将 %%USERPROFILE%%\go\bin 加入 PATH 后重试。
  exit /b 1
)

call "%WAILS%" build
if errorlevel 1 (
  echo [-] 编译失败。
  exit /b 1
)

if not exist "%EXE%" (
  echo [-] 编译完成但仍未找到: "%EXE%"
  exit /b 1
)

echo [+] 启动: "%EXE%"
start "" "%EXE%"
exit /b 0
