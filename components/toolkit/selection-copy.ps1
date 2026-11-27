Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class SelectionWindow {
    [DllImport("user32")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32")] public static extern short GetAsyncKeyState(int key);
    [DllImport("user32")] public static extern uint GetClipboardSequenceNumber();
    [DllImport("user32")] public static extern IntPtr GetClipboardOwner();
    [DllImport("user32")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
}
"@
function Read-FitBayClipboardSelection([long]$TargetWindow,[scriptblock]$isFocused,[scriptblock]$sendCopy) {
    $before = [SelectionWindow]::GetClipboardSequenceNumber()
    $clipboard = [System.Windows.Forms.Clipboard]
    $previous = $clipboard::GetDataObject()
    $snapshot = New-Object System.Windows.Forms.DataObject
    if ($null -ne $previous) {
        $formats=@($previous.GetFormats($false))
        $safe=@('Text','UnicodeText','System.String','Locale','OEMText','HTML Format','Rich Text Format','Csv','Bitmap','DeviceIndependentBitmap','PNG','FileDrop','FileName','FileNameW','Preferred DropEffect')
        if (@($formats | Where-Object {$_ -notin $safe}).Count) { return }
        foreach ($format in $formats) {
            $value=$previous.GetData($format,$false)
            if ($value -is [IO.MemoryStream]) { $value = [IO.MemoryStream]::new($value.ToArray()) }
            elseif ($value -is [Drawing.Image] -or $value -is [Array]) { $value=$value.Clone() }
            elseif ($value -isnot [string] -and $value -isnot [ValueType]) { return }
            $snapshot.SetData($format,$false,$value)
        }
    }
    if (!(& $isFocused) -or [SelectionWindow]::GetClipboardSequenceNumber() -ne $before) { return }
    & $sendCopy
    for ($attempt=0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 40
        $after = [SelectionWindow]::GetClipboardSequenceNumber()
        if ($after -eq $before) { continue }
        [uint32]$ownerPid = 0
        [uint32]$targetPid = 0
        $null = [SelectionWindow]::GetWindowThreadProcessId([SelectionWindow]::GetClipboardOwner(), [ref]$ownerPid)
        $null = [SelectionWindow]::GetWindowThreadProcessId([IntPtr]$TargetWindow, [ref]$targetPid)
        if (!$ownerPid -or $ownerPid -ne $targetPid) { return }
        try {
            $selection = $clipboard::GetText()
            if (!(& $isFocused) -or [SelectionWindow]::GetClipboardSequenceNumber() -ne $after) { return }
            $result=$selection
        } finally {
            if ([SelectionWindow]::GetClipboardSequenceNumber() -eq $after) {
                if ($null -ne $previous) { $clipboard::SetDataObject($snapshot,$true,5,30) }
                else { $clipboard::Clear() }
            }
        }
        return $result
    }
}
