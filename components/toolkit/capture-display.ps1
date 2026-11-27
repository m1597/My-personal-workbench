param([int]$Left,[int]$Top,[int]$Width,[int]$Height)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class FitBayCaptureDpi {
    [DllImport("user32")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
}
"@
if ($Width -lt 1 -or $Height -lt 1) { throw "Invalid monitor bounds" }
$previous=[FitBayCaptureDpi]::SetThreadDpiAwarenessContext([IntPtr](-4))
if ($previous -eq [IntPtr]::Zero) { throw "Cannot obtain physical pixel coordinates" }
try {
    $bitmap=[Drawing.Bitmap]::new($Width,$Height,[Drawing.Imaging.PixelFormat]::Format24bppRgb)
    try {
        $graphics=[Drawing.Graphics]::FromImage($bitmap)
        try { $graphics.CopyFromScreen($Left,$Top,0,0,$bitmap.Size) } finally { $graphics.Dispose() }
        $bitmap.Save([Console]::OpenStandardOutput(),[Drawing.Imaging.ImageFormat]::Png)
    } finally { $bitmap.Dispose() }
} finally { $null=[FitBayCaptureDpi]::SetThreadDpiAwarenessContext($previous) }
