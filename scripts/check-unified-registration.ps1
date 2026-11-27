# Invoke via a fresh powershell.exe -NoProfile -File process. Never starts an installer.
[CmdletBinding()]
param([Parameter(Mandatory)][string]$ControllerPath)
$ErrorActionPreference='Stop'
$controller=(Resolve-Path -LiteralPath $ControllerPath).Path
$lab=New-Item -ItemType Directory (Join-Path ([IO.Path]::GetTempPath()) ("FitBay-reg-" + [Guid]::NewGuid().ToString('N')))
$hive=Join-Path $lab.FullName 'test.dat'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class FitBayTestHives {
 [DllImport("offreg")] public static extern int ORCreateHive(out IntPtr key);
 [DllImport("offreg",CharSet=CharSet.Unicode,ExactSpelling=true)] public static extern int ORSaveHive(IntPtr key,string file,int major,int minor);
 [DllImport("offreg")] public static extern int ORSetKeySecurity(IntPtr key,int flags,byte[] sd);
 [DllImport("offreg")] public static extern int ORCloseHive(IntPtr key);
 [DllImport("advapi32",CharSet=CharSet.Unicode)] public static extern int RegLoadAppKey(string file,out IntPtr key,int access,int options,int reserved);
 [DllImport("advapi32")] public static extern int RegOverridePredefKey(IntPtr predefined,IntPtr instance);
 [DllImport("advapi32")] public static extern int RegCloseKey(IntPtr key);
}
"@
$handle=[IntPtr]::Zero
$rc=[FitBayTestHives]::ORCreateHive([ref]$handle)
if($rc){throw "create $rc"}
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$d=[Security.AccessControl.RawSecurityDescriptor]::new("O:${sid}G:${sid}D:(A;CI;KA;;;$sid)")
$bytes=New-Object byte[] $d.BinaryLength
$d.GetBinaryForm($bytes,0)
$rc=[FitBayTestHives]::ORSetKeySecurity($handle,7,$bytes)
if($rc){throw "set $rc"}
$rc=[FitBayTestHives]::ORSaveHive($handle,$hive,6,1)
if($rc){throw "save $rc"}
[void][FitBayTestHives]::ORCloseHive($handle)
$handle=[IntPtr]::Zero
$rc=[FitBayTestHives]::RegLoadAppKey($hive,[ref]$handle,0xf003f,1,0)
if($rc){throw "RegLoadAppKey $rc"}
$raw=[Microsoft.Win32.RegistryKey]::FromHandle([Microsoft.Win32.SafeHandles.SafeRegistryHandle]::new($handle,$false))
$mark=$raw.CreateSubKey('Software\FitBayTestHive');$mark.SetValue('token',$lab.Name);$mark.Dispose()
$raw.Dispose()
$desktop=[Environment]::GetFolderPath('DesktopDirectory')
$mockDesktop=(New-Item -ItemType Directory (Join-Path $lab.FullName 'Desktop')).FullName
function Get-ChildItem([string]$LiteralPath,[string]$Filter,[switch]$File) {
    if ($LiteralPath -ne $desktop -or $Filter -ne '*.lnk' -or !$File) {throw 'Unexpected shell enumeration'}
    Microsoft.PowerShell.Management\Get-ChildItem -LiteralPath $mockDesktop -Filter $Filter -File
}
function Remove-Item([string]$LiteralPath,[switch]$Force) {
    if ([IO.Path]::GetDirectoryName($LiteralPath) -ne $mockDesktop -or [IO.Path]::GetExtension($LiteralPath) -ne '.lnk') {throw 'Unexpected deletion'}
    Microsoft.PowerShell.Management\Remove-Item -LiteralPath $LiteralPath -Force:$Force
}
function Start-Process {throw 'Child process is forbidden in the private registry test'}
function Write-Reg($path,$name,$value) {
    $k=$private.CreateSubKey($path)
    try {$k.SetValue($name,$value)} finally {$k.Dispose()}
}
function Read-Reg($path,$name) {
    $k=$private.OpenSubKey($path)
    if($k){try {$k.GetValue($name)} finally {$k.Dispose()}}
}
function Expect($actual,$expected,$label) {
    if ($actual -cne $expected) {throw "Failed: $label (actual '$actual'; expected '$expected')"}
}
$ids=[ordered]@{Workbench='a3d9f08e-cfd9-505e-8281-e056f8da2e0c'; Music='c2a83bfc-454e-5ad0-b452-a6062a31088e'; Prompts='43f9a2f2-2dec-5fae-a451-dc6042be6b08'; Toolkit='791d7865-afa5-595d-8b8c-40674e68bc18'}
$arpPath='Software\Microsoft\Windows\CurrentVersion\Uninstall'
$slotsPath='Software\FitBay\Installations'
$rc=[FitBayTestHives]::RegOverridePredefKey([IntPtr](-2147483647),$handle)
if($rc){throw "RegOverridePredefKey $rc"}
try {
    $private=[Microsoft.Win32.RegistryKey]::OpenBaseKey('CurrentUser','Registry64')
    Expect (Read-Reg 'Software\FitBayTestHive' 'token') $lab.Name 'process-private hive'
    $locations=@{}
    $shell=New-Object -ComObject WScript.Shell
    foreach($id in $ids.Keys) {
        $root=Join-Path $lab.FullName "old $id"
        $locations[$id]=$root
        $app=(New-Item -Type Directory (Join-Path $root 'resources\app') -Force).FullName
        $title=if ($id -eq 'Workbench') {'FitBay'} else {"FitBay $id"}
        $exe=Join-Path $root "$title.exe"
        $remove=Join-Path $root "Uninstall $title.exe"
        [IO.File]::WriteAllText($exe,'fixture')
        [IO.File]::WriteAllText($remove,'fixture')
        $meta=@{fitbayProduct=$id.ToLowerInvariant();version='0.2.7'} | ConvertTo-Json
        [IO.File]::WriteAllText((Join-Path $app 'package.json'),$meta)
        $guid=$ids[$id]
        Write-Reg "Software\$guid" 'InstallLocation' $root
        Write-Reg "$arpPath\$guid" 'UninstallString' ('"'+$remove+'" /currentuser')
        Write-Reg "$arpPath\$guid" 'DisplayVersion' '0.2.7'
        $link=$shell.CreateShortcut((Join-Path $mockDesktop "$title.lnk"))
        $link.TargetPath=$exe
        $link.Save()
    }
    $other=$shell.CreateShortcut((Join-Path $mockDesktop 'FitBay Other.lnk'))
    $other.TargetPath=(Join-Path $lab.FullName 'unrelated.exe')
    $other.Save()
    # Missing/foreign old installer and a mismatched marker must block before any registry writes.
    function Expect-Refused([scriptblock]$check, [string]$pattern) {
        try { & $check } catch { if ($_.Exception.Message -like $pattern) { return }; throw }
        throw "Expected refusal: $pattern"
    }
    $hostKey="$arpPath\$($ids.Workbench)"
    $hostCommand=Read-Reg $hostKey 'UninstallString'
    Write-Reg $hostKey 'UninstallString' '"foreign.exe" /currentuser'
    Expect-Refused { & $controller -Operation Preflight -Slot Workbench -Directory $locations.Workbench } '*Incomplete installation*'
    Write-Reg $hostKey 'UninstallString' $hostCommand
    Write-Reg $hostKey 'DisplayVersion' '9.9.9'
    Expect-Refused { & $controller -Operation Preflight -Slot Workbench -Directory $locations.Workbench } '*identity differs*'
    Write-Reg $hostKey 'DisplayVersion' '0.2.7'
    Expect-Refused { & $controller -Operation Preflight -Slot Workbench -Directory $lab.FullName } '*registered Workbench directory*'
    Expect (Read-Reg "$arpPath\FitBay" 'DisplayName') $null 'preflight leaves no suite entry'
    # Overlapping individually valid legacy locations cannot be hidden or removed together.
    $musicKey="$arpPath\$($ids.Music)"
    $musicInstall="Software\$($ids.Music)"
    $musicCommand=Read-Reg $musicKey 'UninstallString'
    $nested=Join-Path $locations.Workbench 'wrong child'
    Microsoft.PowerShell.Management\Copy-Item -LiteralPath $locations.Music -Destination $nested -Recurse
    Write-Reg $musicInstall 'InstallLocation' $nested
    Write-Reg $musicKey 'UninstallString' ('"'+(Join-Path $nested 'Uninstall FitBay Music.exe')+'" /currentuser')
    foreach ($action in 'Preflight','Register','RemoveSuite') {
        Expect-Refused { & $controller -Operation $action -Slot Workbench -Directory $locations.Workbench } '*Overlapping installations*'
    }
    Expect (Read-Reg $musicKey 'SystemComponent') $null 'overlap never hidden'
    Expect (Read-Reg "$arpPath\FitBay" 'DisplayName') $null 'overlap leaves no suite entry'
    Write-Reg $musicInstall 'InstallLocation' $locations.Music
    Write-Reg $musicKey 'UninstallString' $musicCommand
    & $controller -Operation Preflight -Slot Workbench -Directory $locations.Workbench
    & $controller -Operation Register -Slot Workbench -Directory $locations.Workbench
    Expect (Read-Reg "$arpPath\FitBay" 'DisplayName') 'FitBay' 'single suite title'
    $expectQuiet='"'+(Join-Path $locations.Workbench 'Uninstall FitBay.exe')+'" /currentuser --fitbay-suite /S'
    Expect (Read-Reg "$arpPath\FitBay" 'QuietUninstallString') $expectQuiet 'suite uninstall target'
    foreach($id in $ids.Keys) {
        Expect (Read-Reg $slotsPath $id) $locations[$id] "original $id directory"
        Expect (Read-Reg "$arpPath\$($ids[$id])" 'SystemComponent') 1 "hidden old $id"
    }
    $links=@(Microsoft.PowerShell.Management\Get-ChildItem -LiteralPath $mockDesktop -Filter '*.lnk' | Sort-Object Name | ForEach-Object Name)
    Expect ($links -join '|') 'FitBay Other.lnk|FitBay.lnk' 'only foreign and host links remain'
    & $controller -Operation Detach -Slot Workbench -Directory $locations.Workbench
    Expect (Read-Reg 'Software\FitBay\PreviousInstallations' 'Workbench') $locations.Workbench 'host path remembered'
    Expect (Read-Reg "$arpPath\FitBay" 'DisplayName') $null 'suite listing removed'
    foreach($id in 'Music','Prompts','Toolkit') {
        Expect (Read-Reg "$arpPath\$($ids[$id])" 'SystemComponent') $null "legacy $id visible after host detach"
    }
    Write-Reg "$arpPath\$($ids.Prompts)" 'UninstallString' '"foreign.exe" /currentuser'
    & $controller -Operation Register -Slot Workbench -Directory $locations.Workbench
    Expect (Read-Reg "$arpPath\$($ids.Prompts)" 'SystemComponent') $null 'broken peer left visible'
    # A previously adopted peer subsequently breaks. The healthy controller must
    # release its hiding flag and continue without running the invalid command.
    Write-Reg "$arpPath\$($ids.Prompts)" 'UninstallString' ('"'+(Join-Path $locations.Prompts 'Uninstall FitBay Prompts.exe')+'" /currentuser')
    & $controller -Operation Register -Slot Workbench -Directory $locations.Workbench
    foreach($id in 'Music','Toolkit','Prompts') {
        Write-Reg "$arpPath\$($ids[$id])" 'UninstallString' '"foreign.exe" /currentuser'
    }
    & $controller -Operation RemoveSuite -Slot Workbench -Directory $locations.Workbench
    foreach($id in 'Music','Toolkit','Prompts') {
        Expect (Read-Reg "$arpPath\$($ids[$id])" 'SystemComponent') $null "broken adopted $id visible"
        Expect (Read-Reg "$arpPath\$($ids[$id])" 'FitBaySuiteManaged') $null "broken adopted $id released"
        Expect (Test-Path -LiteralPath (Join-Path $locations[$id] "FitBay $id.exe")) $true "broken $id untouched"
    }
    [ordered]@{result='PASS';controller=$controller;sha256=(Get-FileHash -LiteralPath $controller).Hash;fixtures=$lab.FullName;adopted=4;legacyFallback=3;unrelatedLinkPreserved=$true;untrustedPeerSkipped=$true;upgradeIdentityPreflight=$true;overlapRejected=3;damagedAdoptionsReleased=3;externalInstallersExecuted=0} | ConvertTo-Json
} finally {
    if($private){$private.Dispose()}
    [void][FitBayTestHives]::RegOverridePredefKey([IntPtr](-2147483647),[IntPtr]::Zero)
    [void][FitBayTestHives]::RegCloseKey($handle)
}
