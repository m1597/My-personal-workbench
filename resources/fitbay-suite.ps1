# Called only by the per-user NSIS installer/uninstaller. The GUIDs are the
# original electron-builder v5 app IDs and must also match older installers.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Preflight','Register','RemoveSuite','Detach')][string]$Operation,
    [Parameter(Mandatory)][ValidateSet('Workbench','Music','Prompts','Toolkit')][string]$Slot,
    [Parameter(Mandatory)][string]$Directory
)
$ErrorActionPreference = 'Stop'
$current = [Microsoft.Win32.RegistryKey]::OpenBaseKey('CurrentUser','Registry64')
$arp = 'Software\Microsoft\Windows\CurrentVersion\Uninstall'
$slots = 'Software\FitBay\Installations'
$history = 'Software\FitBay\PreviousInstallations'
$suiteKey = "$arp\FitBay"
$guids = [ordered]@{
    Workbench = 'a3d9f08e-cfd9-505e-8281-e056f8da2e0c'
    Music = 'c2a83bfc-454e-5ad0-b452-a6062a31088e'
    Prompts = '43f9a2f2-2dec-5fae-a451-dc6042be6b08'
    Toolkit = '791d7865-afa5-595d-8b8c-40674e68bc18'
}

function Get-Value($key, $name) {
    $handle = $current.OpenSubKey($key)
    if ($handle) {
        try { $handle.GetValue($name) } finally { $handle.Dispose() }
    }
}
function Set-Value($key, $name, $value, $kind = 'String') {
    $handle = $current.CreateSubKey($key)
    try { $handle.SetValue($name,$value,$kind) } finally { $handle.Dispose() }
}
function Remove-Value($key,$name) {
    $handle = $current.OpenSubKey($key,$true)
    if ($handle) {
        try { $handle.DeleteValue($name,$false) } finally { $handle.Dispose() }
    }
}
function Test-PlainPath([string]$path,[bool]$directory) {
    $item = Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    if (!$item -or $item.PSIsContainer -ne $directory) { return $false }
    while ($item) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { return $false }
        if ($item.PSIsContainer) { $item = $item.Parent } else { $item = $item.Directory }
    }
    return $true
}
function Get-Product($id) {
    $guid = $guids[$id]
    $root = Get-Value "Software\$guid" 'InstallLocation'
    $registered = Get-Value $slots $id
    $key = "$arp\$guid"
    $command = Get-Value $key 'UninstallString'
    if (!$root -and !$registered -and !$command) {
        if ((Get-Value $key 'FitBaySuiteManaged') -eq 1) { throw "Missing installation: $id" }
        return
    }
    if (!$root -or $root -notmatch '^(?:[a-z]:\\|\\\\[^\\]+\\[^\\]+\\)' -or
        [IO.Path]::GetFullPath($root) -ne $root -or !$root.TrimEnd('\') -or
        $root.TrimEnd('\') -eq [IO.Path]::GetPathRoot($root).TrimEnd('\') -or
        ($registered -and $registered -ne $root)) { throw "Inconsistent installation directory: $id" }
    $root = $root.TrimEnd('\')
    $profile = [IO.Path]::Combine([Environment]::GetFolderPath('ApplicationData'),'FitBay','desktop-profile')
    if (($root+'\').StartsWith($profile+'\',[StringComparison]::OrdinalIgnoreCase) -or
        ($profile+'\').StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)) { throw "Data directory overlap: $id" }
    $title = if ($id -eq 'Workbench') { 'FitBay' } else { "FitBay $id" }
    $exe = Join-Path $root "$title.exe"
    $uninstall = Join-Path $root "Uninstall $title.exe"
    $manifest = Join-Path $root 'resources\app\package.json'
    if ($command -ne ('"'+$uninstall+'" /currentuser') -or
        !(Test-PlainPath $exe $false) -or !(Test-PlainPath $uninstall $false) -or
        !(Test-PlainPath $manifest $false)) { throw "Incomplete installation: $id" }
    $meta = [IO.File]::ReadAllText($manifest) | ConvertFrom-Json
    $version = Get-Value $key 'DisplayVersion'
    if ($meta.fitbayProduct -ne $id.ToLowerInvariant() -or !$version -or $version -ne $meta.version) {
        throw "Product identity differs from registration: $id"
    }
    [pscustomobject]@{ Slot=$id; Root=$root; Key=$key; Exe=$exe; Uninstall=$uninstall; Version=$version }
}
function Remove-ProductLinks($product, $paths) {
    $shell = New-Object -ComObject WScript.Shell
    foreach ($path in $paths) {
        if (!(Test-Path -LiteralPath $path -PathType Container)) { continue }
        foreach ($link in (Get-ChildItem -LiteralPath $path -Filter '*.lnk' -File)) {
            try { $target = $shell.CreateShortcut($link.FullName).TargetPath } catch { continue }
            if ($target -eq $product.Exe) { Remove-Item -LiteralPath $link.FullName -Force }
        }
    }
}
function Assert-DisjointProducts($products) {
    foreach ($peer in $products) {
        foreach ($other in $products | Where-Object Slot -ne $peer.Slot) {
            if ($peer.Root -eq $other.Root -or (($peer.Root+'\').StartsWith($other.Root+'\',[StringComparison]::OrdinalIgnoreCase) -and
                !($other.Slot -eq 'Workbench' -and $peer.Root -eq (Join-Path $other.Root $peer.Slot)))) {
                throw "Overlapping installations: $($peer.Slot), $($other.Slot)"
            }
        }
    }
}
function Restore-Listing($key) {
    if ((Get-Value $key 'FitBaySuiteManaged') -eq 1) {
        Remove-Value $key 'SystemComponent'
        Remove-Value $key 'FitBaySuiteManaged'
    }
}
function Sync-Listing($products) {
    $controller = $products | Where-Object { (Get-Value $_.Key 'FitBaySuiteController') -eq 1 } | Select-Object -First 1
    $existing = $current.OpenSubKey($suiteKey)
    if ($existing) {
        try {
            if ($existing.GetValue('FitBaySuite') -ne 1) { throw 'Unrelated suite registry key already exists' }
        } finally { $existing.Dispose() }
    }
    if ($controller) {
        Set-Value $suiteKey 'FitBaySuite' 1 'DWord'
        $command = '"' + $controller.Uninstall + '" /currentuser --fitbay-suite'
        Set-Value $suiteKey 'UninstallString' $command
        Set-Value $suiteKey 'QuietUninstallString' ($command + ' /S')
        Set-Value $suiteKey 'InstallLocation' $controller.Root
        Set-Value $suiteKey 'DisplayVersion' $controller.Version
        Set-Value $suiteKey 'DisplayIcon' ($controller.Exe + ',0')
        Set-Value $suiteKey 'Publisher' 'MON.'
        Set-Value $suiteKey 'NoModify' 1 'DWord'
        Set-Value $suiteKey 'NoRepair' 1 'DWord'
        Set-Value $suiteKey 'DisplayName' 'FitBay'
        foreach ($product in $products) {
            Set-Value $slots $product.Slot $product.Root
            Set-Value $product.Key 'FitBaySuiteManaged' 1 'DWord'
            Set-Value $product.Key 'SystemComponent' 1 'DWord'
        }
    } else {
        # The last suite-aware standalone component can be removed while a
        # legacy product remains. Restore its original working Apps entry.
        foreach ($product in $products) { Restore-Listing $product.Key }
        $current.DeleteSubKeyTree($suiteKey,$false)
    }
}
try {
    $products = @()
    $invalidKeys = @()
    foreach ($id in $guids.Keys) {
        if ($Operation -eq 'Detach' -and $id -eq $Slot) { continue }
        try {
            $product = Get-Product $id
            if ($product) { $products += $product }
        } catch {
            if ($id -eq $Slot) { throw }
            $invalidKeys += "$arp\$($guids[$id])"
            # A stale or unrelated record is not eligible for adoption.
            Write-Warning $_
        }
    }
    $own = $products | Where-Object Slot -eq $Slot
    if ($Operation -eq 'Preflight') {
        if ($own -and $own.Root -ne $Directory) { throw "Upgrade must use the registered $Slot directory" }
        if (!$own) { $products += [pscustomobject]@{ Slot=$Slot; Root=$Directory } }
        Assert-DisjointProducts $products
        return
    }
    foreach ($key in $invalidKeys) { Restore-Listing $key }
    Assert-DisjointProducts $products
    if ($Operation -ne 'Detach' -and (!$own -or $own.Root -ne $Directory)) { throw "Unexpected active $Slot directory" }
    if ($Operation -eq 'Register') {
        Set-Value $own.Key 'FitBaySuiteController' 1 'DWord'
        Sync-Listing $products
        foreach ($peer in $products | Where-Object Slot -ne 'Workbench') {
            Remove-ProductLinks $peer @([Environment]::GetFolderPath('DesktopDirectory'))
        }
    } elseif ($Operation -eq 'Detach') {
        $root = Get-Value $slots $Slot
        if ($root -eq $Directory) {
            Set-Value $history $Slot $root
            Remove-Value $slots $Slot
        }
        Sync-Listing $products
    } else {
        # All paths and identities are checked before the first file operation.
        if ((Get-Value $suiteKey 'InstallLocation') -ne $own.Root -or
            (Get-Value $own.Key 'FitBaySuiteController') -ne 1) { throw 'Stale suite entry' }
        foreach ($peer in $products | Where-Object Slot -ne $Slot) {
            Set-Value $history $peer.Slot $peer.Root
            # NSIS _?= must be last and unquoted. A private copy permits the
            # child to delete its installed uninstaller without a mapped image.
            $copy = Join-Path $PSScriptRoot ("remove-" + $peer.Slot + ".exe")
            Copy-Item -LiteralPath $peer.Uninstall -Destination $copy
            $flags = '/S /currentuser --keep-shortcuts --fitbay-suite-child _?=' + $peer.Root
            $process = Start-Process -FilePath $copy -ArgumentList $flags -WindowStyle Hidden -PassThru -Wait
            if ($process.ExitCode -ne 0 -or [IO.File]::Exists($peer.Exe) -or
                [IO.File]::Exists((Join-Path $peer.Root 'resources\app\package.json'))) {
                throw "Component removal incomplete: $($peer.Slot)"
            }
            Remove-ProductLinks $peer @([Environment]::GetFolderPath('DesktopDirectory'),[Environment]::GetFolderPath('Programs'))
            if ((Get-Value $slots $peer.Slot) -eq $peer.Root) { Remove-Value $slots $peer.Slot }
            if (Test-Path -LiteralPath $peer.Root -PathType Container) {
                if ([IO.Directory]::GetFileSystemEntries($peer.Root).Count -eq 0) { [IO.Directory]::Delete($peer.Root) }
            }
        }
    }
} finally { $current.Dispose() }
