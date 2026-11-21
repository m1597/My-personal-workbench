# Creates a clean host installation for the settings-page acceptance test.
param([Parameter(Mandatory)][string]$Installer, [Parameter(Mandatory)][string]$Root)
$ErrorActionPreference = 'Stop'
if ($env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows') {
  throw 'Real installation requires a disposable Windows runner.'
}
$registration = 'HKCU:\Software\FitBay\Installations'
foreach ($name in 'Workbench','Music','Prompts','Toolkit') {
  if ((Get-ItemProperty $registration -ErrorAction SilentlyContinue).$name) { throw "Pre-existing $name" }
}
$p = Start-Process -FilePath $Installer -ArgumentList "/S /currentuser /D=$Root" -WindowStyle Hidden -PassThru -Wait
if ($p.ExitCode) { throw "Primary installer exited $($p.ExitCode)" }
if ((Get-ItemPropertyValue $registration Workbench) -ne $Root) { throw 'Unexpected host destination' }
foreach ($name in 'Music','Prompts','Toolkit') {
  if ((Get-ItemProperty $registration).$name -or (Test-Path -LiteralPath (Join-Path $Root $name))) {
    throw "Primary installer also installed $name"
  }
}
if (Test-Path -LiteralPath "$Root/resources/app/music-offline-setup.exe") { throw 'Bundled Music installer in primary download' }
Write-Host 'PASS primary download installs only the workbench'
