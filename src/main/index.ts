import { app, BrowserWindow, Menu, nativeTheme } from 'electron'
import { fileURLToPath } from 'node:url'
import { release } from 'node:os'

const supportsAcrylic = process.platform === 'win32' && Number(release().split('.')[2]) >= 22621

function createWindow() {
  const window = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 900,
    minHeight: 640,
    title: '个人工作台',
    backgroundColor: supportsAcrylic ? '#00000000' : '#eef2fa',
    ...(supportsAcrylic ? { backgroundMaterial: 'acrylic' as const } : {}),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    if (supportsAcrylic) url.searchParams.set('nativeBackdrop', 'acrylic')
    void window.loadURL(url.toString())
  } else {
    void window.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)), {
      query: supportsAcrylic ? { nativeBackdrop: 'acrylic' } : {}
    })
  }
}

void app.whenReady().then(() => {
  nativeTheme.themeSource = 'light'
  Menu.setApplicationMenu(null)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
