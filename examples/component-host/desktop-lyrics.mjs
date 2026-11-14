import { BrowserWindow, screen } from 'electron'
import { fileURLToPath } from 'node:url'

const width = 660
const height = 90
const positionKey = 'desktop-lyrics-position'
function fit(position, area, contentHeight = height) {
  const w = Math.min(width, area.width)
  const h = Math.min(contentHeight, area.height)
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

export function desktopLyrics(getStore, onLockChanged) {
  let win
  let groups = [],
    size = 24,
    contentHeight = height
  let locked = false
  function setLocked(value) {
    if (!win || win.isDestroyed() || locked === value) return
    win.setIgnoreMouseEvents(value)
    locked = value
    win.webContents.send('lyric-locked', value)
    onLockChanged(value)
  }
  const publish = () => {
    if (win && !win.isDestroyed()) win.webContents.send('lyric-line', groups, size)
  }
  return {
    unlock() {
      setLocked(false)
    },
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
      win.webContents.ipc.on('lyric-lock', (event) => {
        if (event.senderFrame === win.webContents.mainFrame) setLocked(true)
      })

      function constrain() {
        const bounds = win.getContentBounds()
        const target = fit(bounds, screen.getDisplayMatching(bounds).workArea, contentHeight)
        if (Object.keys(target).some((key) => bounds[key] !== target[key])) win.setBounds(target)
        return target
      }
      win.webContents.ipc.on('lyric-height', (event, measured) => {
        if (event.senderFrame !== win.webContents.mainFrame || !Number.isFinite(measured)) return
        contentHeight = Math.max(height, Math.ceil(measured))
        constrain()
      })
      function remember() {
        const { x, y } = constrain()
        getStore().set(positionKey, JSON.stringify({ x, y }))
      }
      // Pick the cursor's display during native drags so a seam can be crossed in either direction.
      win.on('will-move', (event, bounds) => {
        const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
        const target = fit(bounds, display.workArea, contentHeight)
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
        groups = []
        contentHeight = height
        if (locked) onLockChanged(false)
        locked = false
      })
      win.once('ready-to-show', () => {
        win.setBounds(initial)
        if (!background) win.showInactive()
        publish()
      })
      void win.loadFile(fileURLToPath(new URL('./lyric-window.html', import.meta.url)))
    },
    update(value, fontSize) {
      groups = value
      size = fontSize
      publish()
    },
  }
}
