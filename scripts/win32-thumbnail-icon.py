"""Render the registered NativeImage through Windows HICON and compare its silhouette."""
import sys
from pathlib import Path
import win32con
import win32gui
import win32ui
from PIL import Image, ImageChops

hwnd, action, evidence = sys.argv[1:]
hwnd = int(hwnd)
assert not win32gui.IsWindowVisible(hwnd) and win32gui.GetWindowRect(hwnd)[2] < 0
icon = win32gui.SendMessage(hwnd, win32con.WM_GETICON, win32con.ICON_BIG, 0)
assert icon
screen_dc = win32gui.GetDC(0)
screen = win32ui.CreateDCFromHandle(screen_dc)
memory = screen.CreateCompatibleDC()
bitmap = win32ui.CreateBitmap()
bitmap.CreateCompatibleBitmap(screen, 32, 32)
old = memory.SelectObject(bitmap)
try:
    win32gui.PatBlt(memory.GetSafeHdc(), 0, 0, 32, 32, win32con.BLACKNESS)
    win32gui.DrawIconEx(memory.GetSafeHdc(), 0, 0, icon, 32, 32, 0, 0, win32con.DI_NORMAL)
    pixels = Image.frombytes('RGB', (32, 32), bitmap.GetBitmapBits(True), 'raw', 'BGRX')
finally:
    memory.SelectObject(old)
    memory.DeleteDC()
    win32gui.DeleteObject(bitmap.GetHandle())
    win32gui.ReleaseDC(0, screen_dc)

pixels.save(Path(evidence) / (action + '.png'))
sheet = Image.open('examples/component-host/transport-icons.png').convert('RGBA')
x = {'上一首': 0, '播放': 32, '暂停': 64, '下一首': 96}[action]
tile = sheet.crop((x, 0, x + 32, 32))
expected = Image.new('RGB', tile.size)
expected.paste(tile, mask=tile.getchannel('A'))

def mask(image):
    return image.convert('L').point(lambda value: 255 if value > 110 else 0)

mismatch = ImageChops.difference(mask(expected), mask(pixels)).histogram()[255]
assert mismatch <= 12, (action, mismatch, 'incorrect Windows HICON silhouette')
