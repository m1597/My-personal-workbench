@echo off
setlocal
pushd "%~dp0.." || exit /b 1
set "ELECTRON_RUN_AS_NODE="
set "ELECTRON_RENDERER_URL="
set "prompt_profile=%CD%\local\desktop-profile"
if /i "%~1"=="--verify" set "prompt_profile=%CD%\tmp\prompt-desktop-check-%RANDOM%-%RANDOM%"
if /i "%~1"=="--verify" set "WORKBENCH_TEST_BACKGROUND=1"
set "prototype=%CD%\dist\component-prototype"
if not exist "%prototype%\prompts\component.js" goto missing
if not exist "%prototype%\host\main.mjs" goto missing
if not exist "node_modules\electron\dist\electron.exe" goto missing
start "" "node_modules\electron\dist\electron.exe" "%prototype%\host" "--mode=prompts" "--workbench=%CD%\out\renderer\index.html" "--user-data-dir=%prompt_profile%"
popd
exit /b 0
:missing
echo Run npm run build:prototype first.
popd
exit /b 1
