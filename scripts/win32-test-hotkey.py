"""Deliver WM_HOTKEY only to Chromium's hidden window in the supplied test process."""
import ctypes
import sys
from ctypes import wintypes

user32 = ctypes.WinDLL("user32", use_last_error=True)
user32.GetForegroundWindow.restype = wintypes.HWND
user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user32.FindWindowExW.argtypes = [wintypes.HWND, wintypes.HWND, wintypes.LPCWSTR, wintypes.LPCWSTR]
user32.FindWindowExW.restype = wintypes.HWND
user32.SendMessageTimeoutW.argtypes = [
    wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM,
    wintypes.UINT, wintypes.UINT, ctypes.POINTER(ctypes.c_size_t),
]


def owner(hwnd):
    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    return pid.value


def check_foreground(pid):
    hwnd = user32.GetForegroundWindow()
    if hwnd and owner(hwnd) == pid:
        raise RuntimeError("An external foreground window is required")
    return hwnd or 0


def notify(pid, registration, function_key):
    target = None
    while True:
        target = user32.FindWindowExW(None, target, "Chrome_WidgetWin_0", None)
        if not target:
            raise RuntimeError("Cannot find the test process's Chromium message window")
        if owner(target) == pid:
            break
    response = ctypes.c_size_t()
    # MOD_ALT | MOD_CONTROL | MOD_SHIFT, VK_F1 = 0x70.
    chord = ((0x6F + function_key) << 16) | 7
    if not user32.SendMessageTimeoutW(target, 0x0312, registration, chord, 2, 1500, ctypes.byref(response)):
        raise ctypes.WinError(ctypes.get_last_error())


if __name__ == "__main__":
    test_pid = int(sys.argv[1])
    foreground = check_foreground(test_pid)
    if len(sys.argv) == 4:
        notify(test_pid, int(sys.argv[2]), int(sys.argv[3]))
        if check_foreground(test_pid) != foreground:
            raise RuntimeError("Foreground window changed during message delivery")
    print(foreground)
