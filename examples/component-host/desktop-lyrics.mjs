import { BrowserWindow, screen } from 'electron'
import { fileURLToPath } from 'node:url'

const width = 660
const height = 90
const positionKey = 'desktop-lyrics-position'
function fit(position, area) {
  const w = Math.min(width, area.width)
  const h = Math.min(height, area.height)
  return {
    x: Math.max(area.x, Math.min(position.x, area.x + area.width - w)),
    y: Math.max(area.y, Math.min(position.y, area.y + area.height - h)),
    width: w,
    height: h,
  }
}
function restoredBounds(saved) {
  let position
  try {
    position = JSON.parse(saved)
  } catch {
    // First launch or an invalid saved position.
  }
  if (Number.isSafeInteger(position?.x) && Number.isSafeInteger(position?.y))
    return fit(position, screen.getDisplayMatching({ ...position, width, height }).workArea)
  const area = screen.getPrimaryDisplay().workArea
  return fit(
    {
      x: area.x + Math.round((area.width - width) / 2),
      y: area.y + area.height,
    },
    area,
  )
}

export function desktopLyrics(getStore) {
  let win
  let line = ''
  const publish = () => {
    if (win && !win.isDestroyed()) win.webContents.send('lyric-line', line)
  }
  return {
    show(on) {
      if (!on) {
        win?.close()
        return
      }
      if (win) return
      const background = process.env.WORKBENCH_TEST_BACKGROUND === '1'
      const initial = restoredBounds(getStore().get(positionKey))
      win = new BrowserWindow({
        ...initial,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        alwaysOnTop: true,
        show: false,
        focusable: !background,
        skipTaskbar: true,
        resizable: false,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          preload: fileURLToPath(new URL('./lyric-preload.cjs', import.meta.url)),
        },
      })

      function constrain() {
        const bounds = win.getContentBounds()
        const target = fit(bounds, screen.getDisplayMatching(bounds).workArea)
        if (Object.keys(target).some((key) => bounds[key] !== target[key])) win.setBounds(target)
        return target
      }
      function remember() {
        const { x, y } = constrain()
        getStore().set(positionKey, JSON.stringify({ x, y }))
      }
      // Pick the cursor's display during native drags so a seam can be crossed in either direction.
      win.on('will-move', (event, bounds) => {
        const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
        const target = fit(bounds, display.workArea)
        if (Object.keys(target).some((key) => bounds[key] !== target[key])) {
          event.preventDefault()
          win.setBounds(target)
        }
      })
      // Native drag regions and fully transparent pixels do not deliver DOM hover events on Windows.
      let pointerInside = false
      const hoverTimer = background
        ? undefined
        : setInterval(() => {
            const point = screen.getCursorScreenPoint()
            const frame = win.getContentBounds()
            const inside =
              point.x >= frame.x &&
              point.x < frame.x + frame.width &&
              point.y >= frame.y &&
              point.y < frame.y + frame.height
            if (inside !== pointerInside) {
              pointerInside = inside
              win.webContents.send('lyric-controls', inside)
            }
          }, 180)
      win.on('moved', remember)
      win.on('close', remember)
      screen.on('display-metrics-changed', remember)
      screen.on('display-removed', remember)
      win.once('closed', () => {
        clearInterval(hoverTimer)
        screen.off('display-metrics-changed', remember)
        screen.off('display-removed', remember)
        win = undefined
        line = ''
      })
      win.once('ready-to-show', () => {
        win.setBounds(initial)
        if (!background) win.showInactive()
        publish()
      })
      void win.loadFile(fileURLToPath(new URL('./lyric-window.html', import.meta.url)))
    },
    update(value) {
      if (value !== line) {
        line = value
        publish()
      }
    },
  }
}
