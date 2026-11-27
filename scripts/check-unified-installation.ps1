# Actual NSIS lifecycle test for a clean, dedicated Windows guest/account.
# Pass the SID of the test account verified by its owner. Does not clean the lab after the run.
param(
    [Parameter(Mandatory)][string]$BaselineDir,
    [Parameter(Mandatory)][string]$CandidateDir,
    [Parameter(Mandatory)][string]$DisposableUserSid,
    [switch]$PreflightOnly
)
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$sid = $identity.User.Value
if ($sid -ne $DisposableUserSid -or !(Test-Path "Registry::HKEY_USERS\$sid")) {
    throw 'Requires the designated test user with its own loaded registry hive.'
}
$profile = [Environment]::GetFolderPath('UserProfile')
$owner = Get-ItemPropertyValue "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$sid" ProfileImagePath
if (!$profile -or [Environment]::ExpandEnvironmentVariables($owner) -ne $profile -or
    ![Environment]::Is64BitProcess) { throw 'Expected a loaded profile and a 64-bit Windows shell.' }
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
$roaming = [Environment]::GetFolderPath('ApplicationData')
foreach ($folder in @($roaming, $desktop, [Environment]::GetFolderPath('Programs'), $env:LOCALAPPDATA, $env:TEMP)) {
    if (!$folder -or ![IO.Path]::GetFullPath($folder).StartsWith("$profile\",[StringComparison]::OrdinalIgnoreCase)) {
        throw 'A shell folder does not belong to the disposable test account.'
    }
}
if ($env:APPDATA -ne $roaming -or (Test-Path "$roaming/FitBay") -or (Test-Path HKCU:\Software\FitBay)) {
    throw 'This account has an existing FitBay registration or application profile.'
}
$slots = @('Workbench','Music','Prompts','Toolkit')
$arpPath = 'Software\Microsoft\Windows\CurrentVersion\Uninstall'
$slotKey = 'HKCU:\Software\FitBay\Installations'
function VisibleApps {
    foreach ($hive in 'HKCU','HKLM') {
        foreach ($key in $arpPath,($arpPath.Replace('Software\','Software\WOW6432Node\'))) {
            foreach ($entry in (Get-ChildItem -LiteralPath ("${hive}:\$key") -ErrorAction SilentlyContinue)) {
                $values = Get-ItemProperty -LiteralPath $entry.PSPath
                if ($values.DisplayName -like 'FitBay*' -and $values.SystemComponent -ne 1) { $values }
            }
        }
    }
}
if (@(VisibleApps).Count -ne 0 -or @(Get-ChildItem -LiteralPath $desktop -Filter 'FitBay*.lnk').Count) {
    throw 'Pre-existing FitBay Programs and Features or desktop entry.'
}
function VerifiedPackages($dir, $version) {
    $manifest = Get-Content -LiteralPath (Join-Path $dir 'SHA256SUMS.txt')
    $result = @{}
    foreach ($name in @($slots) + 'Offline') {
        $filename = "FitBay-$name-Setup-$version-x64.exe"
        $file = (Resolve-Path -LiteralPath (Join-Path $dir $filename)).Path
        $digest = (Get-FileHash -LiteralPath $file).Hash.ToLowerInvariant()
        if ("$digest  $filename" -cnotin $manifest) { throw "Digest mismatch for $filename" }
        $result[$name] = $file
    }
    return $result
}
$version = (Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json).version
$old = VerifiedPackages $BaselineDir '0.2.7'
$new = VerifiedPackages $CandidateDir $version
if ($PreflightOnly) { Write-Output 'PASS disposable account, known folders, pristine registration and package digests'; return }
$lab = Join-Path $env:TEMP ('FitBay suite ' + [Guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $lab)
$locations = @{}
foreach ($slot in $slots) { $locations[$slot] = Join-Path $lab "Standalone $slot" }
function ProgramName($slot) {
    if ($slot -eq 'Workbench') { return 'FitBay.exe' }
    return "FitBay $slot.exe"
}
function Run-Setup($file, $flags) {
    $process = Start-Process -FilePath $file -ArgumentList $flags -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode) { throw "$file failed ($($process.ExitCode))" }
}
function Check-Product($slot, $expectedVersion) {
    $dir = $locations[$slot]
    $registered = Get-ItemPropertyValue $slotKey $slot
    $meta = Get-Content -LiteralPath "$dir/resources/app/package.json" -Raw | ConvertFrom-Json
    if ($registered -ne $dir -or $meta.version -ne $expectedVersion -or $meta.fitbayProduct -ne $slot.ToLowerInvariant() -or
        !(Test-Path -LiteralPath (Join-Path $dir (ProgramName $slot)) -PathType Leaf)) { throw "Incorrect $slot location or version" }
}
function Check-SuiteEntry {
    $entries = @(VisibleApps)
    if ($entries.Count -ne 1 -or $entries[0].DisplayName -cne 'FitBay' -or $entries[0].PSChildName -ne 'FitBay') {
        throw "Expected one visible FitBay suite registration, found $($entries.Count)"
    }
    $links = @(Get-ChildItem -LiteralPath $desktop -Filter '*.lnk' | Where-Object {
        $target = (New-Object -ComObject WScript.Shell).CreateShortcut($_.FullName).TargetPath
        $target -and $target.StartsWith("$lab\", [StringComparison]::OrdinalIgnoreCase)
    })
    $workbench = Join-Path $locations.Workbench 'FitBay.exe'
    if ($links.Count -ne 1 -or (New-Object -ComObject WScript.Shell).CreateShortcut($links[0].FullName).TargetPath -ne $workbench) {
        throw 'Expected one desktop shortcut to the registered workbench'
    }
}
function Music-Fixture($phase) {
    $env:FITBAY_DISPOSABLE_PROFILE = Join-Path $roaming 'FitBay\desktop-profile'
    $exe = Join-Path $locations.Music 'FitBay Music.exe'
    node scripts/check-music-installed-upgrade.mjs $phase (Join-Path $lab 'Data fixture') $exe --suite-default-profile
    if ($LASTEXITCODE) { throw "Music $phase failed" }
}
function Check-RetainedFiles {
    foreach ($slot in $slots) {
        if ([IO.File]::ReadAllText((Join-Path $locations[$slot] 'user-owned.txt')) -cne $slot) {
            throw "User-owned $slot document changed"
        }
    }
}
Write-Output "Test lab $lab"
foreach ($slot in 'Music','Prompts','Toolkit','Workbench') {
    Run-Setup $old[$slot] "/S /currentuser /D=$($locations[$slot])"
    Check-Product $slot '0.2.7'
    [IO.File]::WriteAllText((Join-Path $locations[$slot] 'user-owned.txt'), $slot)
}
if (@(VisibleApps).Count -ne 4) { throw 'Baseline must expose all four legacy uninstall entries' }
Music-Fixture seed
Run-Setup $new.Workbench '/S /currentuser'
Check-SuiteEntry
foreach ($slot in $slots) {
    if ($slot -ne 'Workbench') { Check-Product $slot '0.2.7'; Run-Setup $new[$slot] '/S /currentuser' }
    Check-Product $slot $version
}
Check-SuiteEntry
Check-RetainedFiles
Music-Fixture verify
Write-Output 'PASS four actual legacy paths adopted, one visible product, all components upgraded'

$entry = @(VisibleApps)[0]
$uninstaller = Join-Path $locations.Workbench 'Uninstall FitBay.exe'
$expectedQuiet = '"' + $uninstaller + '" /currentuser --fitbay-suite /S'
if ($entry.QuietUninstallString -ne $expectedQuiet) { throw 'Unexpected suite quiet uninstall command' }
Run-Setup $uninstaller '/currentuser --fitbay-suite /S'
if (@(VisibleApps).Count -or @(Get-ChildItem -LiteralPath $desktop -Filter 'FitBay*.lnk').Count) {
    throw 'Suite uninstall left a visible Windows entry'
}
foreach ($slot in $slots) {
    if ((Get-ItemPropertyValue $slotKey $slot -ErrorAction SilentlyContinue) -or
        (Test-Path -LiteralPath (Join-Path $locations[$slot] (ProgramName $slot)))) {
        throw "Suite removal left $slot installed"
    }
}
Check-RetainedFiles
Run-Setup $new.Offline '/S /WITHMUSIC /WITHPROMPTS /WITHTOOLKIT'
foreach ($slot in $slots) { Check-Product $slot $version }
Check-SuiteEntry
Check-RetainedFiles
Music-Fixture verify
Write-Output 'PASS complete suite removal, reinstall to original directories, retained playlist, favorite, followed artist, audio and authenticated model request'
