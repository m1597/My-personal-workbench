@echo off
setlocal
pushd "%~dp0.." || exit /b 1
set "workbench_root=%CD%"
if not exist "node_modules\electron\dist\electron.exe" goto missing_runtime
if not exist "out\main\index.js" goto missing_build
if not exist "out\renderer\index.html" goto missing_build
if /i "%~1"=="--check" (
  echo OK: Electron and built workbench are ready.
  popd
  exit /b 0
)
set "ELECTRON_RUN_AS_NODE="
set "ELECTRON_RENDERER_URL="
set "WORKBENCH_TEST_BACKGROUND=0"
start "" "node_modules\electron\dist\electron.exe" "%workbench_root%" "--user-data-dir=%workbench_root%\local\desktop-profile"
popd
exit /b 0
:missing_runtime
echo Electron is missing. Run npm ci in the project folder, then try again.
goto failed
:missing_build
echo Build output is missing. Run npm run build in the project folder, then try again.
:failed
if /i not "%~1"=="--check" pause
popd
exit /b 1
