import ctypes
import subprocess
import time
import sys
from pathlib import Path

import pythoncom
import win32gui
import win32process
from win32com.client import Dispatch


def restore_clipboard(original):
    for attempt in range(20):
        try:
            pythoncom.OleSetClipboard(original)
            pythoncom.OleFlushClipboard()
            return
        except pythoncom.com_error:
            if attempt == 19:
                raise
            pythoncom.PumpWaitingMessages()
            time.sleep(0.05)


def run():
    pythoncom.OleInitialize()
    prior = win32gui.GetForegroundWindow()
    original = pythoncom.OleGetClipboard()
    sequence = ctypes.windll.user32.GetClipboardSequenceNumber()
    try:
        assistant_test = any(flag in sys.argv[1:] for flag in ("--pdf", "--absent"))
        entry = "scripts/check-toolkit.mjs" if assistant_test else "scripts/check-toolkit-capture-colors.mjs"
        if "--candidate" in sys.argv[1:] or "--diagram" in sys.argv[1:]:
            entry = "scripts/check-toolkit-diagram.mjs"
        command = ["node", entry, *sys.argv[1:]]
        if "--selection-private" in sys.argv[1:]:
            command = [sys.executable, "scripts/toolkit-private-desktop.py", "powershell.exe", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", "scripts/check-toolkit-selection-range.ps1"]
        proc = subprocess.Popen(
            command,
            cwd=Path(__file__).resolve().parents[1],
        )
        while proc.poll() is None:
            pythoncom.PumpWaitingMessages()
            time.sleep(0.02)
        return proc.returncode
    finally:
        try:
            if sequence != ctypes.windll.user32.GetClipboardSequenceNumber():
                restore_clipboard(original)
        finally:
            if prior and win32gui.IsWindow(prior) and win32gui.GetForegroundWindow() != prior:
                Dispatch("WScript.Shell").AppActivate(win32process.GetWindowThreadProcessId(prior)[1])
                time.sleep(0.1)
                if win32gui.GetForegroundWindow() != prior:
                    user32 = ctypes.windll.user32
                    current_thread = ctypes.windll.kernel32.GetCurrentThreadId()
                    foreground_thread = user32.GetWindowThreadProcessId(user32.GetForegroundWindow(), None)
                    attached = user32.AttachThreadInput(current_thread, foreground_thread, True)
                    try:
                        user32.SetForegroundWindow(prior)
                    finally:
                        if attached:
                            user32.AttachThreadInput(current_thread, foreground_thread, False)
            print("Original focus restored", win32gui.GetForegroundWindow() == prior)


if __name__ == "__main__":
    raise SystemExit(run())
