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
        proc = subprocess.Popen(
            ["node", "scripts/check-toolkit-capture-colors.mjs", *sys.argv[1:]],
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
