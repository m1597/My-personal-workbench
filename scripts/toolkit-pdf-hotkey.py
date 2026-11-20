"""Activate the isolated PDF fixture and exercise its registered Windows shortcut."""
import time

import win32api
import win32con
import win32gui
from pywinauto import Desktop
from pywinauto.keyboard import send_keys

viewer = Desktop(backend="win32").window(title_re=".*FitBaySelectionTest.*Google Chrome.*")
handle = viewer.handle
flags = win32con.SWP_NOSIZE | win32con.SWP_NOMOVE
win32gui.SetWindowPos(handle, win32con.HWND_TOPMOST, 0, 0, 0, 0, flags)
try:
    left, top, _, _ = win32gui.GetWindowRect(handle)
    point = (left + 130, top + 20)
    assert win32gui.GetAncestor(win32gui.WindowFromPoint(point), 2) == handle
    win32api.SetCursorPos(point)
    win32api.mouse_event(win32con.MOUSEEVENTF_LEFTDOWN, 0, 0)
    win32api.mouse_event(win32con.MOUSEEVENTF_LEFTUP, 0, 0)
    time.sleep(0.2)
finally:
    win32gui.SetWindowPos(handle, win32con.HWND_NOTOPMOST, 0, 0, 0, 0, flags)
assert win32gui.GetForegroundWindow() == handle
send_keys("^%{F9}")
