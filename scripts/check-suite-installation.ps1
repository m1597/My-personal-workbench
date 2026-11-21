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
Run-Setup $setup $all
foreach ($p in @('Workbench')+$components) {
  Verify $p $locations[$p] $version
  if ((Get-Content -LiteralPath (Join-Path $locations[$p] 'existing-file.txt')) -ne $p) { throw "$p lost its marker" }
}
Write-Host "PASS $Previous to ${version}: four existing directories and markers preserved"
foreach ($p in $components + @('Workbench')) { Remove-TestProduct $p $locations[$p] }
