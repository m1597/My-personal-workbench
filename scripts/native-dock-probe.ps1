param([long]$WindowHandle, [int]$Message, [switch]$ReadExtendedStyle)
# Only the test-created HWND is supplied. No cursor, focus, or desktop input changes.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NativeDockProbe {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", EntryPoint="GetWindowLongW")] public static extern int GetWindowLong(IntPtr h, int index);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr h, uint m, IntPtr w, IntPtr l, uint f, uint t, out UIntPtr result);
  public static void Send(long handle, int message) {
    IntPtr memory = IntPtr.Zero;
    try {
      if(message == 0x216) {
        RECT rect; if(!GetWindowRect(new IntPtr(handle), out rect)) throw new Exception("Invalid test HWND");
        memory = Marshal.AllocHGlobal(Marshal.SizeOf<RECT>()); Marshal.StructureToPtr(rect, memory, false);
      }
      UIntPtr result;
      if(SendMessageTimeout(new IntPtr(handle), (uint)message, new IntPtr(message == 0x216 ? 1 : 0), memory, 2, 3000, out result) == IntPtr.Zero) throw new Exception("Native test message failed");
    } finally { if(memory != IntPtr.Zero) Marshal.FreeHGlobal(memory); }
  }
}
"@
if ($ReadExtendedStyle) {
  [NativeDockProbe]::GetWindowLong([IntPtr]::new($WindowHandle), -20)
} else {
  [NativeDockProbe]::Send($WindowHandle, $Message)
}
