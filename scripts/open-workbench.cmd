@echo off
setlocal
chcp 65001 >nul
pushd "%~dp0.." || exit /b 1
set "workbench_root=%CD%"
if not exist "node_modules\electron\dist\electron.exe" goto missing_runtime
if not exist "out\main\index.js" goto missing_build
if not exist "out\renderer\index.html" goto missing_build
set "prototype=%workbench_root%\dist\component-prototype"
set "mode=standalone"
set "ELECTRON_RUN_AS_NODE="
set "ELECTRON_RENDERER_URL="
set "WORKBENCH_TEST_BACKGROUND=0"
if /i "%~1"=="--check" goto check_component
if /i "%~1"=="--component" goto check_component
if /i "%~1"=="--workbench" goto workbench
choice /c 12 /n /t 5 /d 1 /m "按 1 打开日常工作台，按 2 打开示例组件（5 秒后默认 1）："
if errorlevel 255 goto failed
if errorlevel 2 goto check_component
if not errorlevel 1 goto failed
:workbench
set "mode=workbench"
:check_component
for %%F in (host\package.json host\main.mjs host\native-dock.mjs host\sample-preload.cjs host\workbench-preload.cjs) do if not exist "%prototype%\%%F" goto missing_component
if /i "%mode%"=="standalone" for %%F in (component.json index.html component.js component.css) do if not exist "%prototype%\component\%%F" goto missing_component
if /i "%~1"=="--check" (
  echo OK: Workbench, component host and sample are ready.
  goto launched
)
start "" "node_modules\electron\dist\electron.exe" "%prototype%\host" "--mode=%mode%" "--component=%prototype%\component" "--workbench=%workbench_root%\out\renderer\index.html" "--user-data-dir=%workbench_root%\local\desktop-profile"
:launched
popd
exit /b 0
:missing_component
echo 示例组件缺少构建文件。请在项目目录运行 npm run build:prototype。
goto failed
:missing_runtime
echo Electron is missing. Run npm ci in the project folder, then try again.
goto failed
:missing_build
echo Build output is missing. Run npm run build in the project folder, then try again.
:failed
if /i not "%~1"=="--check" pause
popd
exit /b 1
