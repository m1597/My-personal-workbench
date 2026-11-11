import { screen } from 'electron'
import { createRequire } from 'node:module'

let windows
function nativeWindows() {
  if (windows) return windows
  const ffi = createRequire(import.meta.url)('koffi')
  const user = ffi.load('user32.dll')
  const dwm = ffi.load('dwmapi.dll')
  const rect = ffi.struct({ left: 'int', top: 'int', right: 'int', bottom: 'int' })
  windows = {
    first: user.func('uintptr_t __stdcall GetTopWindow(uintptr_t)'),
    next: user.func('uintptr_t __stdcall GetWindow(uintptr_t, uint32_t)'),
    visible: user.func('int __stdcall IsWindowVisible(uintptr_t)'),
    rect: user.func('__stdcall', 'GetWindowRect', 'int', ['uintptr_t', ffi.out(ffi.pointer(rect))]),
    attribute: dwm.func(
      'int32_t __stdcall DwmGetWindowAttribute(uintptr_t, uint32_t, _Out_ uint32_t *, uint32_t)',
    ),
  }
  return windows
}

// Walk desktop Z order at the physical pointer, ignoring only the moving window.
export function shellExposed(point, source, shell) {
  const win = nativeWindows()
  const pixel = screen.dipToScreenPoint(point)
  const handle = (window) => Number(window.getNativeWindowHandle().readBigUInt64LE())
  const moving = handle(source)
  const destination = handle(shell)
  for (let hwnd = win.first(0); hwnd; hwnd = win.next(hwnd, 2)) {
    if (Number(hwnd) === moving || !win.visible(hwnd)) continue
    const bounds = {}
    if (
      !win.rect(hwnd, bounds) ||
      pixel.x < bounds.left ||
      pixel.x >= bounds.right ||
      pixel.y < bounds.top ||
      pixel.y >= bounds.bottom
    )
      continue
    const cloaked = [0]
    if (win.attribute(hwnd, 14, cloaked, 4) === 0 && cloaked[0]) continue
    return Number(hwnd) === destination
  }
  return false
}

export function snapTarget(point, regions) {
  const region = regions.find(
    ({ x, y, width, height }) =>
      point.x >= x && point.x < x + width && point.y >= y && point.y < y + height,
  )
  if (!region) return null
  const { id, x, y, width, height } = region
  const u = (point.x - x) / width
  const v = (point.y - y) / height
  const distances = [u, 1 - u, v, 1 - v]
  const edge = Math.min(...distances)
  const direction =
    id && edge < 0.23 ? ['left', 'right', 'above', 'below'][distances.indexOf(edge)] : 'within'
  const vertical = direction === 'above' || direction === 'below'
  const horizontal = direction === 'left' || direction === 'right'
  return {
    id,
    direction,
    x: direction === 'right' ? x + width / 2 : x,
    y: direction === 'below' ? y + height / 2 : y,
    width: horizontal ? width / 2 : width,
    height: vertical ? height / 2 : height,
  }
}

export function positionAtRelease(window, point, background) {
  const [width, height] = window.getSize()
  const area = screen.getDisplayNearestPoint(point).workArea
  let x = point.x - Math.min(width / 2, 120)
  let y = point.y - 16
  if (!background) {
    x = Math.max(area.x, Math.min(x, area.x + Math.max(0, area.width - width)))
    y = Math.max(area.y, Math.min(y, area.y + Math.max(0, area.height - height)))
  }
  if (background) x = Math.min(x, ...screen.getAllDisplays().map((d) => d.bounds.x - width - 80))
  window.setPosition(Math.round(x), Math.round(y))
}

export function outsideRelease(shell, release) {
  if (!Number.isFinite(release?.x) || !Number.isFinite(release?.y)) return
  const content = shell.getContentBounds()
  const frame = shell.getBounds()
  const x = Math.round(content.x + release.x)
  const y = Math.round(content.y + release.y)
  if (x < frame.x || y < frame.y || x >= frame.x + frame.width || y >= frame.y + frame.height)
    return { x, y }
}

export function watchNativeDock(window, { target, commit, preview }) {
  if (process.platform !== 'win32') return
  let start
  let moving = false
  let cancelled = false
  const reset = () => {
    start = undefined
    moving = false
    preview(null)
  }
  window.hookWindowMessage(0x0231, () => {
    start = window.getBounds()
    moving = false
    cancelled = false
  })
  window.hookWindowMessage(0x001f, () => {
    cancelled = true
    preview(null)
  })
  window.hookWindowMessage(0x0216, () => {
    moving = true
    if (!cancelled) preview(target(screen.getCursorScreenPoint()))
  })
  window.on('move', () => {
    if (moving && !cancelled) preview(target(screen.getCursorScreenPoint()))
  })
  window.hookWindowMessage(0x0232, () => {
    const end = window.getBounds()
    const hit =
      !cancelled && moving && start && (end.x !== start.x || end.y !== start.y)
        ? target(screen.getCursorScreenPoint())
        : null
    reset()
    setImmediate(() => {
      if (hit && !window.isDestroyed()) commit(hit)
    })
  })
}
