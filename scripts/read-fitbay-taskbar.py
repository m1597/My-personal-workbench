"""Count Explorer taskbar windows for FitBay processes without activating them."""
import json
import re

import win32gui
from pywinauto import Desktop

tray = win32gui.FindWindow("Shell_TrayWnd", None)
handles = []
win32gui.EnumChildWindows(tray, lambda handle, _: handles.append(handle) or True, None)
for name in ["Windows.UI.Composition.DesktopWindowContentBridge", "MSTaskListWClass"]:
    buttons = []
    for handle in handles:
        if win32gui.GetClassName(handle) == name:
            buttons.extend(Desktop(backend="uia").window(handle=handle).descendants(control_type="Button"))
    if buttons:
        break
else:
    raise RuntimeError("Explorer taskbar unavailable")

items = {}
for button in buttons:
    app_id = button.element_info.automation_id or ""
    title = button.window_text()
    if not (re.search(r"fitbay|electron",app_id,re.I) or re.match(r"FitBay|工具集",title,re.I)):
        continue
    count = re.search(r"(\d+)\s*(?:个运行窗口|running windows?)", title, re.I)
    if count:
        items[app_id] = {"id": app_id, "count": int(count.group(1))}
print(json.dumps(list(items.values())))