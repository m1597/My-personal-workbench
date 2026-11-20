@echo off
setlocal
cd /d "%~dp0.."
set "ELECTRON_RUN_AS_NODE="
start "" "node_modules\electron\dist\electron.exe" "components\toolkit" "--workbench-profile=%CD%\local\desktop-profile"
