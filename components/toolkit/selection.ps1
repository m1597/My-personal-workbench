param([long]$TargetWindow)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class SelectionWindow {
    [DllImport("user32")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32")] public static extern uint GetClipboardSequenceNumber();
    [DllImport("user32")] public static extern IntPtr GetClipboardOwner();
    [DllImport("user32")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
}
"@
function Has-Focus { [SelectionWindow]::GetForegroundWindow().ToInt64() -eq $TargetWindow }
# Some PDF viewers publish selected text only through Copy.
if (!(Has-Focus)) { exit 0 }
$before = [SelectionWindow]::GetClipboardSequenceNumber()
$previous = [System.Windows.Forms.Clipboard]::GetDataObject()
if (!(Has-Focus)) { exit 0 }
[System.Windows.Forms.SendKeys]::SendWait('^c')
for ($attempt=0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 40
    $after = [SelectionWindow]::GetClipboardSequenceNumber()
    if ($after -eq $before) { continue }
    [uint32]$ownerPid = 0
    [uint32]$targetPid = 0
    $null = [SelectionWindow]::GetWindowThreadProcessId([SelectionWindow]::GetClipboardOwner(), [ref]$ownerPid)
    $null = [SelectionWindow]::GetWindowThreadProcessId([IntPtr]$TargetWindow, [ref]$targetPid)
    if ($ownerPid -ne $targetPid -or !(Has-Focus)) { exit 0 }
    $selection = [System.Windows.Forms.Clipboard]::GetText()
    if ([SelectionWindow]::GetClipboardSequenceNumber() -eq $after) {
        if ($null -ne $previous) { [System.Windows.Forms.Clipboard]::SetDataObject($previous,$true) }
        else { [System.Windows.Forms.Clipboard]::Clear() }
    }
    [Console]::Write($selection)
    exit 0
}
