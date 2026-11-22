$ErrorActionPreference = 'Stop'
$installer = $env:FITBAY_UPDATE_FILE
$workbench = $env:FITBAY_UPDATE_APP
$arguments = '--user-data-dir="' + $env:FITBAY_UPDATE_PROFILE + '"'
$parentProcess = Get-Process -Id ([int]$env:FITBAY_UPDATE_PARENT) -ErrorAction Stop
$null = $parentProcess.Handle
[IO.File]::WriteAllText($env:FITBAY_UPDATE_READY, 'ready')
if (-not $parentProcess.WaitForExit(90000)) { exit 1 }
try {
    $sha = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($installer)
    try { $digest = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '') } finally { $stream.Dispose(); $sha.Dispose() }
    if ($digest -ine $env:FITBAY_UPDATE_SHA256) { throw 'Invalid installer digest' }
    $process = Start-Process -FilePath $installer -ArgumentList @('/S', '/currentuser') -PassThru -Wait -WindowStyle Hidden
    if ($process.ExitCode -ne 0) { throw 'Installer failed' }
} finally {
    Remove-Item -Force -LiteralPath $installer -ErrorAction SilentlyContinue
    Start-Process -FilePath $workbench -ArgumentList $arguments
    Remove-Item -LiteralPath ([IO.Path]::ChangeExtension($PSCommandPath,'vbs')) -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $env:FITBAY_UPDATE_READY -Force -ErrorAction SilentlyContinue
    try { [IO.Directory]::Delete([IO.Path]::GetDirectoryName($installer)) } catch [IO.IOException] {}
}
