# Run from the repository with pwsh -NoProfile -File scripts/check-separate-installers.ps1.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not [Environment]::Is64BitProcess) { throw 'Run this check from a 64-bit PowerShell.' }
$repo = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -Raw -LiteralPath (Join-Path $repo 'package.json') -Encoding UTF8 | ConvertFrom-Json).version
$products = @(
  [pscustomobject]@{ Name='Workbench'; Guid='a3d9f08e-cfd9-505e-8281-e056f8da2e0c'; Shortcut='FitBay 工作台'; Exe='FitBay.exe'; Cache='fitbay-workbench-updater' }
  [pscustomobject]@{ Name='Music'; Guid='c2a83bfc-454e-5ad0-b452-a6062a31088e'; Shortcut='FitBay Music'; Exe='FitBay Music.exe'; Cache='fitbay-music-updater' }
)
$known = @{}
foreach ($name in 'Desktop','Programs','CommonDesktopDirectory','CommonPrograms') {
  $known[$name] = [Environment]::GetFolderPath($name)
}
$dailyLink = Join-Path $known['Desktop'] 'FitBay.lnk'
$registration = 'HKCU:\Software\FitBay\Installations'
$work = Join-Path (Join-Path $repo 'tmp') ('installed-products-' + [guid]::NewGuid().ToString('N'))
$mutex = [Threading.Mutex]::new($false,'Local\FitBayInstallAcceptance')
$owned = @{}
function LinkHash {
  if (Test-Path -LiteralPath $dailyLink) {return (Get-FileHash -LiteralPath $dailyLink -Algorithm SHA256).Hash}
  return '<absent>'
}
function SamePath($a,$b) {
  if (-not $a -or -not $b) {return $false}
  return [string]::Equals([IO.Path]::GetFullPath($a).TrimEnd('\'),[IO.Path]::GetFullPath($b).TrimEnd('\'),[StringComparison]::OrdinalIgnoreCase)
}
function ReadRegistration($p) {
  $key=Get-Item -LiteralPath $registration -ErrorAction SilentlyContinue
  if ($null -ne $key) {
    try {return $key.GetValue($p.Name,$null)} finally {$key.Dispose()}
  }
}
function EnsureAbsent($p) {
  foreach ($h in [Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryHive]::LocalMachine) {
    foreach ($v in [Microsoft.Win32.RegistryView]::Registry64,[Microsoft.Win32.RegistryView]::Registry32) {
      $registry=[Microsoft.Win32.RegistryKey]::OpenBaseKey($h,$v)
      try {
        foreach ($key in @("Software\$($p.Guid)","Software\Microsoft\Windows\CurrentVersion\Uninstall\$($p.Guid)")) {
          $k=$registry.OpenSubKey($key)
          if ($null -ne $k) { $k.Dispose(); throw "Existing $h/$v/$key. Use a clean Windows test account." }
        }
        $k=$registry.OpenSubKey('Software\FitBay\Installations')
        if ($null -ne $k) {
          try { if ($k.GetValueNames() -contains $p.Name) {throw "Existing installation discovery record for $($p.Name)."} }
          finally {$k.Dispose()}
        }
      } finally {$registry.Dispose()}
    }
  }
  foreach ($folder in $known.Values) {
    $link=Join-Path $folder ($p.Shortcut+'.lnk')
    if (Test-Path -LiteralPath $link) {throw "Existing shortcut: $link. Use a clean Windows test account."}
  }
  if (Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($p.Exe)) -ErrorAction SilentlyContinue) {
    throw "There is already a running $($p.Exe). Use a clean Windows test session."
  }
}
function InstallProduct($p, [switch]$discoverMusic) {
  EnsureAbsent $p
  $dst=Join-Path $work $p.Name
  $arguments="/S /currentuser /D="+$dst
  if ($discoverMusic) {
    if ($p.Name -ne 'Music' -or -not $owned.ContainsKey('Workbench')) {throw 'Install the isolated Workbench first.'}
    $dst=Join-Path $owned['Workbench'] 'Music'
    $arguments='/S /currentuser'
  }
  $setup=Join-Path $repo "dist/installers/FitBay-$($p.Name)-Setup-$version-x64.exe"
  $owned[$p.Name]=$dst
  # NSIS /D is the last argument and takes the entire unquoted remainder, including spaces.
  $r=Start-Process -FilePath $setup -ArgumentList $arguments -WindowStyle Hidden -PassThru -Wait
  if ($r.ExitCode -ne 0) {throw "$($p.Name) installer exited $($r.ExitCode)"}
  if (-not (SamePath (ReadRegistration $p) $dst)) {throw "Wrong installation registration for $($p.Name)."}
  $exe=Join-Path $dst $p.Exe
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {throw "Missing installed executable: $exe"}
  $peer = if ($p.Name -eq 'Music') {'workbench'} else {'music'}
  if (Test-Path -LiteralPath (Join-Path $dst "resources/app/$peer")) {throw "Installed payload bundles the other product: $peer"}
  if (Get-ChildItem -LiteralPath $dst -Recurse -File -Filter '*.fitbayplugin') {throw 'Optional plugin archive bundled inside the application.'}
  $shell = New-Object -ComObject WScript.Shell
  try {
    foreach ($folder in 'Desktop','Programs') {
      $link=Join-Path $known[$folder] ($p.Shortcut+'.lnk')
      if (-not (Test-Path -LiteralPath $link -PathType Leaf)) {throw "Missing shortcut: $link"}
      $sc=$shell.CreateShortcut($link)
      try {if (-not (SamePath $sc.TargetPath $exe)) {throw "Shortcut does not launch the installed program: $link"}}
      finally {[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($sc)}
    }
  } finally {[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)}
  Write-Host "PASS actual NSIS installation, HKCU and shortcuts: $($p.Name)"
}
function CheckDirectoryConflict($workbench,$music) {
  $dst = Join-Path $work $workbench.Name
  $exe = Join-Path $dst $workbench.Exe
  $hash = (Get-FileHash -LiteralPath $exe).Hash
  $setup = Join-Path $repo "dist/installers/FitBay-Music-Setup-$version-x64.exe"
  $unrelated = Join-Path $work 'existing-directory'
  [void][IO.Directory]::CreateDirectory($unrelated)
  $privateFile = Join-Path $unrelated 'original.txt'
  [IO.File]::WriteAllText($privateFile,'original test data')
  foreach ($candidate in $dst,$work,(Join-Path $dst 'nested-product'),$unrelated) {
    $r = Start-Process -FilePath $setup -ArgumentList ("/S /currentuser /D="+$candidate) -WindowStyle Hidden -Wait -PassThru
    if ($r.ExitCode -eq 0) {throw "Conflicting installation directory was accepted: $candidate"}
    EnsureAbsent $music
    if (-not (SamePath (ReadRegistration $workbench) $dst) -or (Get-FileHash -LiteralPath $exe).Hash -ne $hash) {
      throw 'Conflicting installation damaged the existing Workbench.'
    }
  }
  $attempt=Join-Path $dst 'nested-product'
  if (Test-Path -LiteralPath $attempt) {throw 'Refusing an overlapped directory still created a folder in the installed application.'}
  if ([IO.File]::ReadAllText($privateFile) -ne 'original test data') {throw 'Foreign directory was modified.'}
  $allUsers=Join-Path $work 'all-users'
  $r=Start-Process -FilePath $setup -ArgumentList ("/S /allusers /D="+$allUsers) -WindowStyle Hidden -PassThru -Wait
  if ($r.ExitCode -eq 0 -or (Test-Path -LiteralPath $allUsers)) {throw 'All-users installation was accepted or created a directory.'}
  EnsureAbsent $music
  $link=Join-Path $work 'redirected-workbench'
  [void](New-Item -ItemType Junction -Path $link -Target $dst)
  try {
    $redirected=Join-Path $link 'redirect-attempt'
    $r=Start-Process -FilePath $setup -ArgumentList ("/S /currentuser /D="+$redirected) -WindowStyle Hidden -Wait -PassThru
    if ($r.ExitCode -eq 0 -or (Test-Path -LiteralPath $redirected)) {throw 'Directory junction bypassed the installation boundary.'}
    EnsureAbsent $music
  } finally {[IO.Directory]::Delete($link)}
  Write-Host 'PASS refused overlapping, non-empty, redirected and all-users destinations without modifying them'
}
function RemoveProduct($p) {
  if (-not $owned.ContainsKey($p.Name)) {return}
  $dst=$owned[$p.Name]
  $entry="HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$($p.Guid)"
  $found = ReadRegistration $p
  if ($found -and -not (SamePath $found $dst)) {throw "Installation ownership changed; retaining $($p.Name)."}
  $here=Get-ItemPropertyValue -LiteralPath ("HKCU:\Software\"+$p.Guid) -Name InstallLocation -ErrorAction SilentlyContinue
  if ($here -and -not (SamePath $here $dst)) {throw "Uninstall registration ownership changed."}
  $cmd=Get-ItemPropertyValue -LiteralPath $entry -Name UninstallString -ErrorAction SilentlyContinue
  if ($cmd) {
    if ($cmd -notmatch '^"([^"]+\.exe)"') {throw "Unexpected uninstall registration for $($p.Name)"}
    $uninstall=[IO.Path]::GetFullPath($Matches[1])
    if (-not (SamePath ([IO.Path]::GetDirectoryName($uninstall)) $dst)) {throw "Refusing an uninstaller outside the isolated directory."}
    $sentinels=@((Join-Path $dst 'private-file.txt'),(Join-Path $dst 'resources/app/host/private-file.txt'))
    foreach ($file in $sentinels) {[IO.File]::WriteAllText($file,'private test document')}
    $r=Start-Process -FilePath $uninstall -ArgumentList '/S /currentuser' -WindowStyle Hidden -Wait -PassThru
    if ($r.ExitCode -ne 0) {throw "$($p.Name) uninstaller exited $($r.ExitCode)"}
    foreach ($file in $sentinels) {
      if ([IO.File]::ReadAllText($file) -ne 'private test document') {throw "Uninstall removed or changed an unowned file: $file"}
      Remove-Item -LiteralPath $file
    }
    foreach ($rel in 'resources/app/host','resources/app','resources','.') {
      $folder=Join-Path $dst $rel
      if ((Test-Path -LiteralPath $folder) -and -not @(Get-ChildItem -LiteralPath $folder -Force).Count) {
        [IO.Directory]::Delete($folder)
      }
    }
  }
  EnsureAbsent $p
  if (Test-Path -LiteralPath (Join-Path $dst $p.Exe)) {throw "Uninstall left the executable for $($p.Name)."}
  $owned.Remove($p.Name)
  foreach ($peer in $products) {
    if (-not $owned.ContainsKey($peer.Name)) {continue}
    $peerRoot=$owned[$peer.Name]
    if (-not (SamePath (ReadRegistration $peer) $peerRoot) -or -not (Test-Path -LiteralPath (Join-Path $peerRoot $peer.Exe))) {
      throw "Uninstalling $($p.Name) removed the other installed product or its registration."
    }
    foreach ($folder in 'Desktop','Programs') {
      if (-not (Test-Path -LiteralPath (Join-Path $known[$folder] ($peer.Shortcut+'.lnk')))) {throw 'Uninstall removed the other shortcut.'}
    }
  }
  Write-Host "PASS uninstall removed only the tested registration, shortcuts and program: $($p.Name)"
}
function TestUI($scenario) {
  & node (Join-Path $PSScriptRoot 'check-installed-fitbay.mjs') $scenario $work
  if ($LASTEXITCODE -ne 0) {throw "Installed UI scenario failed: $scenario"}
}
$locked=$false
Push-Location $repo
try {
  $locked=$mutex.WaitOne(0)
  if (-not $locked) {throw 'Another installer acceptance run is active.'}
  foreach ($product in $products) {
    EnsureAbsent $product
    $cache=Join-Path $env:LOCALAPPDATA $product.Cache
    if (Test-Path -LiteralPath $cache) {throw "Existing updater cache: $cache. Use a clean Windows test account."}
    $installer=Join-Path $repo "dist/installers/FitBay-$($product.Name)-Setup-$version-x64.exe"
    if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {throw "Build the installer first: $installer"}
  }
  $before=LinkHash
  New-Item -ItemType Directory -Path $work | Out-Null
  Write-Host "Installer evidence: $work"
  try {
    InstallProduct $products[0]
    TestUI 'workbench'
    CheckDirectoryConflict $products[0] $products[1]
    InstallProduct $products[1] -discoverMusic
    RemoveProduct $products[0]
    RemoveProduct $products[1]
    InstallProduct $products[1]
    TestUI 'music'
    InstallProduct $products[0]
    TestUI 'workbench-first'
    TestUI 'music-first'
    RemoveProduct $products[1]
    TestUI 'workbench'
    InstallProduct $products[1]
    RemoveProduct $products[0]
    TestUI 'music-survivor'
  } finally {
    try {RemoveProduct $products[1]} finally {RemoveProduct $products[0]}
    foreach ($p in $products) {
      $cache=Join-Path $env:LOCALAPPDATA $p.Cache
      $cached=Join-Path $cache 'installer.exe'
      if (Test-Path -LiteralPath $cached -PathType Leaf) {
        $setup=Join-Path $repo "dist/installers/FitBay-$($p.Name)-Setup-$version-x64.exe"
        if ((Get-FileHash -LiteralPath $cached).Hash -ne (Get-FileHash -LiteralPath $setup).Hash) {throw "Unexpected updater cache contents: $cached"}
        Remove-Item -LiteralPath $cached
      }
      if ((Test-Path -LiteralPath $cache) -and -not @(Get-ChildItem -LiteralPath $cache -Force).Count) {
        [IO.Directory]::Delete($cache)
      }
    }
    if ((LinkHash) -ne $before) {throw 'The original desktop FitBay shortcut changed.'}
  }
} finally {
  Pop-Location
  if ($locked) {$mutex.ReleaseMutex()}
  $mutex.Dispose()
}
