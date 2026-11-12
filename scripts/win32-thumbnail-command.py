"""Deliver a thumbnail WM_COMMAND only to the offscreen test window."""
import ctypes
import re
import sys
from ctypes import wintypes

identity, action = sys.argv[1:]
if not re.fullmatch(r"FitBay\.ThumbnailTest\.\d+\.(standalone|docked)", identity):
    raise ValueError("Expected an isolated FitBay test window")
u = ctypes.windll.user32
u.FindWindowW.restype = wintypes.HWND
u.GetForegroundWindow.restype = wintypes.HWND
target = u.FindWindowW("Chrome_WidgetWin_1", identity)
foreground = u.GetForegroundWindow()
bounds = wintypes.RECT()
if not target or not u.GetWindowRect(target, ctypes.byref(bounds)) or bounds.right > 0:
    raise RuntimeError("Test window must be offscreen")
if not foreground or target == foreground:
    raise RuntimeError("An external foreground window is required")
index = {"上一首": 0, "暂停": 1, "播放": 1, "下一首": 2}[action]
u.SendMessageW(target, 0x111, (0x1800 << 16) | (40001 + index), 0)
if u.GetForegroundWindow() != foreground:
    raise RuntimeError("Foreground changed during WM_COMMAND")
print("foreground", foreground, "→", u.GetForegroundWindow())
