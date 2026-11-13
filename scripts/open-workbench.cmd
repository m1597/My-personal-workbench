@echo off
setlocal
chcp 65001 >nul
pushd "%~dp0.." || exit /b 1
set "workbench_root=%CD%"
if not exist "node_modules\electron\dist\electron.exe" goto missing_runtime
if not exist "out\main\index.js" goto missing_build
if not exist "out\renderer\index.html" goto missing_build
set "prototype=%workbench_root%\dist\component-prototype"
set "mode=workbench"
set "profile=%workbench_root%\local\desktop-profile"
if /i "%~1"=="--manual" set "profile=%workbench_root%\tmp\manual-builtin-windows\profile"
set "ELECTRON_RUN_AS_NODE="
set "ELECTRON_RENDERER_URL="
set "WORKBENCH_TEST_BACKGROUND=0"
if /i "%~1"=="--check" goto check_component
if /i "%~1"=="--workbench" goto workbench
if /i "%~1"=="--music" goto music
choice /c 17 /n /t 5 /d 1 /m "1 工作台，7 Music（默认 1）："
if errorlevel 255 goto failed
if errorlevel 2 goto music
if not errorlevel 1 goto failed
goto workbench
:music
set "mode=music"
goto check_component
:workbench
set "mode=workbench"
:check_component
for %%F in (host\library-tools.mjs host\library-backup.mjs host\daily-lifecycle.mjs host\recycled-tracks.mjs) do if not exist "%prototype%\%%F" goto missing_component
for %%F in (host\package.json host\installed-products.mjs host\music-installer.mjs host\fitbay.png host\main.mjs host\component-view.mjs host\music-preload.cjs host\music-service.mjs host\music-model.mjs host\music-discovery.mjs host\music-download-diagnosis.mjs host\music-recording-identity.mjs host\music-thumbnails.mjs host\transport-icons.png host\lx-music.mjs host\lx-platform-search.mjs host\lx-source-catalog.mjs host\music-source-pipe.mjs host\music-source-private.ps1 host\lx-worker.mjs host\lx-net.mjs host\lx-runtime.mjs host\lx-guest.js host\lx-audio-check.mjs host\desktop-lyrics.mjs host\music-lyrics.mjs host\lyric-preload.cjs host\lyric-window.html host\flac-stream.mjs host\local-stream.mjs host\online-stream.mjs host\release-catalog.mjs host\music\local-files.mjs host\music\local-library.mjs host\music\albums.mjs host\music\library-worker.mjs host\music\store.mjs host\music\offline-source.mjs host\builtin-windows.mjs host\builtin-preload.cjs host\native-dock.mjs host\workbench-preload.cjs) do if not exist "%prototype%\%%F" goto missing_component
if /i "%~1"=="--check" (
  for %%F in (component.json index.html component.js component.css default-cover.png) do if not exist "%prototype%\music\%%F" goto missing_component
  echo OK: Workbench, component host and music are ready.
  goto launched
)
start "" "node_modules\electron\dist\electron.exe" "%prototype%\host" "--mode=%mode%" "--workbench=%workbench_root%\out\renderer\index.html" "--user-data-dir=%profile%"
:launched
popd
exit /b 0
:missing_component
echo 组件宿主或Music缺少构建文件。请在项目目录运行 npm run build:prototype。
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
