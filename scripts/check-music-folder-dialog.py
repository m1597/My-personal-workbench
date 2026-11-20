"""Drive the real Music picker on an isolated Windows desktop. Requires pywin32."""
import ctypes
from ctypes import wintypes
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import uuid

import win32con
import win32event
import win32gui
import win32process


user32 = ctypes.WinDLL("user32", use_last_error=True)
callback = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
user32.OpenDesktopW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
user32.OpenDesktopW.restype = wintypes.HANDLE
user32.CreateDesktopW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, ctypes.c_void_p,
                                  wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p]
user32.CreateDesktopW.restype = wintypes.HANDLE
user32.EnumDesktopWindows.argtypes = [wintypes.HANDLE, callback, wintypes.LPARAM]
user32.CloseDesktop.argtypes = [wintypes.HANDLE]


def drive_dialog(pid, phase, paths):
    name = os.environ["FITBAY_DESKTOP"]
    assert name.startswith("FitBayWatch")
    desktop = user32.OpenDesktopW(name, 0, False, 0x1ff)
    if not desktop:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        for _ in range(90):
            dialogs = []

            @callback
            def visit(handle, _):
                if (win32gui.IsWindowVisible(handle) and win32gui.GetClassName(handle) == "#32770"
                        and win32process.GetWindowThreadProcessId(handle)[1] == pid):
                    dialogs.append(handle)
                return True

            user32.EnumDesktopWindows(desktop, visit, 0)
            for dialog in dialogs:
                controls = []

                def child(handle, _):
                    if win32gui.IsWindowVisible(handle):
                        controls.append((handle, win32gui.GetClassName(handle),
                                         win32gui.GetDlgCtrlID(handle), win32gui.GetWindowText(handle)))
                    return True

                win32gui.EnumChildWindows(dialog, child, None)
                if phase == "check":
                    add = next((h for h, kind, _, label in controls
                                if kind == "Button" and label == "添加"), None)
                    if add:
                        # TDM_CLICK_VERIFICATION toggles the real Task Dialog checkbox.
                        win32gui.SendMessage(dialog, 0x400 + 113, 1, 0)
                        win32gui.PostMessage(add, win32con.BM_CLICK, 0, 0)
                        return
                else:
                    edit = next((h for h, kind, cid, _ in controls if kind == "Edit" and cid == 1148), None)
                    if edit is None:
                        edit = next((h for h, kind, _, _ in controls if kind == "Edit"), None)
                    ok = next((h for h, kind, cid, _ in controls if kind == "Button" and cid == 1), None)
                    if edit and ok:
                        win32gui.SendMessage(edit, win32con.WM_SETTEXT, 0, " ".join(f'"{p}"' for p in paths))
                        time.sleep(0.15)
                        win32gui.PostMessage(ok, win32con.BM_CLICK, 0, 0)
                        return
            time.sleep(0.15)
        raise TimeoutError(f"Music dialog did not appear ({phase})")
    finally:
        user32.CloseDesktop(desktop)


def launch():
    name = "FitBayWatch" + uuid.uuid4().hex
    desktop = user32.CreateDesktopW(name, None, None, 0, 0x1ff, None)
    if not desktop:
        raise ctypes.WinError(ctypes.get_last_error())
    startup = win32process.STARTUPINFO()
    startup.lpDesktop = "WinSta0\\" + name
    used = ctypes.windll.kernel32.GetLogicalDrives()
    drive = next(c + ":" for c in "ZYXWVUTSRQPONM" if not used & (1 << (ord(c) - 65)))
    log = Path("tmp", name + ".log").resolve()
    log.parent.mkdir(exist_ok=True)
    cmd = subprocess.list2cmdline([shutil.which("node"), "scripts/check-music-folder-watch.mjs"])
    try:
        proc, thread, _, _ = win32process.CreateProcess(
            None, 'cmd.exe /d /s /c "' + cmd + ' > "' + str(log) + '" 2>&1"',
            None, None, False, win32con.CREATE_NO_WINDOW,
            dict(os.environ, FITBAY_DESKTOP=name, FITBAY_WATCH_DRIVE=drive), None, startup)
        try:
            win32event.WaitForSingleObject(proc, win32event.INFINITE)
            print(log.read_text(encoding="utf-8", errors="replace"))
            return win32process.GetExitCodeProcess(proc)
        finally:
            proc.Close()
            thread.Close()
    finally:
        user32.CloseDesktop(desktop)


if __name__ == "__main__":
    if sys.argv[1:2] == ["dialog"]:
        drive_dialog(int(sys.argv[2]), sys.argv[3], sys.argv[4:])
    else:
        sys.exit(launch())
