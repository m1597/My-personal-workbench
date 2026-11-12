import { BrowserWindow, screen } from 'electron'
import { fileURLToPath } from 'node:url'
export function desktopLyrics() {
  let win,
    line = ''
  const publish = () => {
    if (win && !win.isDestroyed()) win.webContents.send('lyric-line', line)
  }
  return {
    show(on) {
      if (!on) {
        win?.destroy()
        return
      }
      if (win) return
      win = new BrowserWindow({
        width: 660,
        height: 90,
        ...(process.env.WORKBENCH_TEST_BACKGROUND === '1'
          ? {
              x: Math.min(...screen.getAllDisplays().map((d) => d.bounds.x)) - 2200,
              y: 0,
              focusable: false,
            }
          : {}),
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
