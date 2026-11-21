"""Activate only the isolated Chrome PDF fixture, without moving the mouse."""
import time
import ctypes
import win32api

import win32gui
import win32process
from win32com.client import Dispatch
from pywinauto import Desktop
from pywinauto.keyboard import send_keys

viewer = Desktop(backend="win32").window(title_re=".*FitBaySelectionTest.*Google Chrome.*")
handle = viewer.handle
if win32gui.GetForegroundWindow() != handle:
    Dispatch("WScript.Shell").AppActivate(win32process.GetWindowThreadProcessId(handle)[1])
    time.sleep(0.15)
    if win32gui.GetForegroundWindow() != handle:
        user32 = ctypes.windll.user32
        caller = win32api.GetCurrentThreadId()
        foreground = win32gui.GetForegroundWindow()
        threads = {win32process.GetWindowThreadProcessId(w)[0] for w in [handle, foreground] if w}
        attached = [t for t in threads if t != caller and user32.AttachThreadInput(caller,t,True)]
        try:
            user32.BringWindowToTop(handle)
            user32.SetForegroundWindow(handle)
        finally:
            for t in attached: user32.AttachThreadInput(caller,t,False)
assert win32gui.GetForegroundWindow() == handle
send_keys("^%{F9}")
