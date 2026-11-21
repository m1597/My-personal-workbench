# Run only in a disposable GitHub-hosted Windows runner.
param([Parameter(Mandatory)][string]$BaselineDir, [Parameter(Mandatory)][string]$Previous)
$ErrorActionPreference = 'Stop'
if ($env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows') {
  throw 'This acceptance test installs real products and requires a fresh Windows runner.'
}
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$setup = (Resolve-Path "dist/installers/FitBay-Offline-Setup-$version-x64.exe").Path
$root = Join-Path $env:RUNNER_TEMP 'FitBay suite acceptance'
$registration = 'HKCU:\Software\FitBay\Installations'
$exe = @{ Workbench='FitBay'; Music='FitBay Music'; Prompts='FitBay Prompts'; Toolkit='FitBay Toolkit' }
$components = @('Music','Prompts','Toolkit')
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
$shell = New-Object -ComObject WScript.Shell
$desktopFolder = (New-Object -ComObject Shell.Application).NameSpace($desktop)
$baselineLinks = @(Get-ChildItem -LiteralPath $desktop -Filter '*.lnk' -Force | ForEach-Object FullName)
function NewDesktopLinks {
  Get-ChildItem -LiteralPath $desktop -Filter '*.lnk' -Force | Where-Object { $_.FullName -notin $baselineLinks }
}
function ShortcutTarget($link) {
  $item = $desktopFolder.ParseName($link.Name)
  $target = $item.ExtendedProperty('System.Link.TargetParsingPath')
  if (!$target) {
    # WSH uses the system ANSI code page on some Windows images. Read the
    # same link bytes under an ASCII name when testing localized shortcuts.
    $copy = Join-Path $env:RUNNER_TEMP 'fitbay-target-inspection.lnk'
    Copy-Item -LiteralPath $link.FullName -Destination $copy -Force
    $target = $shell.CreateShortcut($copy).TargetPath
    if (!$target) { throw "Could not read $($link.FullName) ($($link.Length) bytes): $([Convert]::ToBase64String([IO.File]::ReadAllBytes($copy)))" }
  }
  Write-Host "$($link.Name) -> [$target]"
  if ($target) { return [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($target)) }
}
function Verify-Desktop($hostDir, $preserved) {
  $links = @(NewDesktopLinks | Where-Object { $_.FullName -ne $preserved })
  $expected = Join-Path $hostDir 'FitBay.exe'
  $targets = @($links | ForEach-Object { ShortcutTarget $_ })
  if ($links.Count -ne 1 -or $targets.Count -ne 1 -or $targets[0] -ne $expected) {
    throw "Expected one desktop link to [$expected], found: [$($targets -join ', ')]"
  }
}
function Run-Setup($file, $flags) {
  $result = Start-Process -FilePath $file -ArgumentList $flags -WindowStyle Hidden -PassThru -Wait
  if ($result.ExitCode) { throw "$file returned $($result.ExitCode) for $flags" }
}
function Location($product) {
  (Get-ItemProperty -LiteralPath $registration -ErrorAction SilentlyContinue).$product
}
function Verify($product, $expected, $v) {
  $actual = Location $product
  if ($actual -ne $expected) { throw "$product expected $expected, registered $actual" }
  if (!$expected) { return }
  $meta = Get-Content -LiteralPath "$actual/resources/app/package.json" -Raw | ConvertFrom-Json
  if ($meta.fitbayProduct -ne $product.ToLowerInvariant() -or $meta.version -ne $v -or
      !(Test-Path -LiteralPath (Join-Path $actual ($exe[$product]+'.exe')))) { throw "Invalid $product payload" }
}
function Remove-TestProduct($product, $expected) {
  if ((Location $product) -ne $expected) { throw "Unexpected uninstall location for $product" }
  $uninstaller = Join-Path $expected ('Uninstall ' + $exe[$product] + '.exe')
  Run-Setup $uninstaller '/S /currentuser'
  if (Location $product) { throw "Uninstall left registration for $product" }
}
foreach ($p in $exe.Keys) { if (Location $p) { throw "Pre-existing $p" } }
Run-Setup $setup "/S /D=$root"
Verify Workbench $root $version
foreach ($p in $components) { Verify $p $null $null }
Write-Host 'PASS default selection installs only Workbench'
foreach ($selected in $components) {
  Run-Setup $setup ("/S /WITH"+$selected.ToUpperInvariant()+" /D=$root")
  foreach ($p in $components) {
    $expected = if ($p -eq $selected) { Join-Path $root $p } else { $null }
    Verify $p $expected $version
  }
  Remove-TestProduct $selected (Join-Path $root $selected)
  Write-Host "PASS selecting $selected installs only that optional product"
}
$all = '/S /WITHMUSIC /WITHPROMPTS /WITHTOOLKIT'
Run-Setup $setup "$all /D=$root"
Verify Workbench $root $version
foreach ($p in $components) { Verify $p (Join-Path $root $p) $version }
Verify-Desktop $root
Write-Host 'PASS fresh installation with all three components creates only the host desktop shortcut'
Remove-TestProduct Workbench $root
foreach ($p in $components) { Verify $p (Join-Path $root $p) $version }
Run-Setup $setup "/S /D=$root"
foreach ($p in $components) { Remove-TestProduct $p (Join-Path $root $p) }
Remove-TestProduct Workbench $root
Write-Host 'PASS all selected, uninstall and reinstall parent without removing components'

$oldRoot = Join-Path $env:RUNNER_TEMP 'Original FitBay'
$locations = @{Workbench=$oldRoot}
foreach ($p in $components) { $locations[$p] = Join-Path $env:RUNNER_TEMP "Existing standalone $p" }
foreach ($p in @('Workbench')+$components) {
  $dest = $locations[$p]
  Run-Setup (Join-Path $BaselineDir "FitBay-$p-Setup-$Previous-x64.exe") "/S /currentuser /D=$dest"
  Verify $p $dest $Previous
  Set-Content -LiteralPath (Join-Path $dest 'existing-file.txt') -Value $p
}
$foreign = $null
if ([version]$Previous -lt [version]'0.2.2') {
  $legacy = @(NewDesktopLinks)
  if ($legacy.Count -ne 4) { throw "Expected four desktop shortcuts from legacy installers" }
  $musicLink = @($legacy | Where-Object { (ShortcutTarget $_) -eq (Join-Path $locations.Music 'FitBay Music.exe') })
  if ($musicLink.Count -ne 1) { throw 'Missing legacy Music desktop shortcut' }
  $foreign = $musicLink[0].FullName
  Copy-Item -LiteralPath $foreign -Destination (Join-Path $desktop 'Renamed legacy Music.lnk')
  $replacement = $shell.CreateShortcut($foreign)
  $replacement.TargetPath = Join-Path $env:WINDIR 'notepad.exe'
  $replacement.Save()
}
Run-Setup $setup $all
Verify-Desktop $oldRoot $foreign
if ($foreign -and (!(Test-Path -LiteralPath $foreign) -or $shell.CreateShortcut($foreign).TargetPath -ne $replacement.TargetPath)) {
  throw 'Upgrade removed or replaced the unrelated same-name shortcut'
}
Write-Host 'PASS upgrade leaves one FitBay desktop shortcut and preserves unrelated targets'
foreach ($p in @('Workbench')+$components) {
  Verify $p $locations[$p] $version
  if ((Get-Content -LiteralPath (Join-Path $locations[$p] 'existing-file.txt')) -ne $p) { throw "$p lost its marker" }
}
Write-Host "PASS $Previous to ${version}: four existing directories and markers preserved"
foreach ($p in $components + @('Workbench')) { Remove-TestProduct $p $locations[$p] }
