import { BrowserWindow, screen } from 'electron'
import { fileURLToPath } from 'node:url'
const width = 660
const height = 90

export function desktopLyrics() {
  let win,
    line = '',
    lastPosition
  const publish = () => {
    if (win && !win.isDestroyed()) win.webContents.send('lyric-line', line)
  }
  return {
    show(on) {
      if (!on) {
        if (win) {
          const [x, y] = win.getPosition()
          lastPosition = { x, y }
          win.destroy()
        }
        return
      }
      if (win) return
      const background = process.env.WORKBENCH_TEST_BACKGROUND === '1'
      const displays = screen.getAllDisplays()
      const positionAvailable =
        lastPosition &&
        (background ||
          displays.some(
            ({ workArea: a }) =>
              lastPosition.x + width > a.x &&
              lastPosition.x < a.x + a.width &&
              lastPosition.y + height > a.y &&
              lastPosition.y < a.y + a.height,
          ))
      win = new BrowserWindow({
        width,
        height,
        ...(background
          ? {
              x: Math.min(...displays.map((d) => d.bounds.x)) - 2200,
              y: 0,
              focusable: false,
            }
          : {}),
        ...(positionAvailable ? lastPosition : {}),
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        show: false,
        skipTaskbar: true,
        resizable: false,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          preload: fileURLToPath(new URL('./lyric-preload.cjs', import.meta.url)),
        },
      })
      win.once('closed', () => {
        win = undefined
        line = ''
      })
      win.once('ready-to-show', () => {
        win?.showInactive()
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
