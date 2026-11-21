param([long]$WindowHandle,[string]$Executable,[string]$Evidence)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class ToolkitIconProbe {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
 public struct Info { public IntPtr icon; public int index; public uint flags; [MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)] public string display; [MarshalAs(UnmanagedType.ByValTStr,SizeConst=80)] public string type; }
 [DllImport("shell32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr SHGetFileInfo(string path,uint attrs,out Info info,uint size,uint flags);
 [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hwnd,uint msg,IntPtr wp,IntPtr lp);
 [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr icon);
}
"@
$shortcutPath=Join-Path $Evidence 'Toolkit-probe.lnk'
$shell=New-Object -ComObject WScript.Shell
$shortcut=$shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath=$Executable
$shortcut.Save()
function Save-Handle([IntPtr]$Handle,[string]$Name) {
 if ($Handle -eq [IntPtr]::Zero) {throw "Icon missing: $Name"}
 $icon=[Drawing.Icon]::FromHandle($Handle)
 $bitmap=$icon.ToBitmap()
 try { $bitmap.Save((Join-Path $Evidence $Name),[Drawing.Imaging.ImageFormat]::Png) } finally {$bitmap.Dispose()}
}
$handle=[ToolkitIconProbe]::SendMessage([IntPtr]$WindowHandle,0x7f,[IntPtr]1,[IntPtr]0)
Save-Handle $handle 'window-icon.png'
foreach ($item in @(@($shortcutPath,'shortcut-icon.png'),@($Executable,'exe-icon.png'))) {
 $info=New-Object ToolkitIconProbe+Info
 [void][ToolkitIconProbe]::SHGetFileInfo($item[0],0,[ref]$info,[Runtime.InteropServices.Marshal]::SizeOf($info),0x100)
 try {Save-Handle $info.icon $item[1]} finally {if($info.icon -ne [IntPtr]::Zero){[void][ToolkitIconProbe]::DestroyIcon($info.icon)}}
}
