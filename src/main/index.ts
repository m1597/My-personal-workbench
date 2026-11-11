import { app, BrowserWindow, Menu, nativeTheme, screen } from 'electron'
import { fileURLToPath } from 'node:url'
import { release } from 'node:os'

const supportsAcrylic = process.platform === 'win32' && Number(release().split('.')[2]) >= 22621

function createWindow() {
  const backgroundTest =
    process.env.WORKBENCH_TEST_BACKGROUND === '1' &&
    (!app.isPackaged || process.argv.some((arg) => arg.startsWith('--user-data-dir=')))
  const testX = backgroundTest
    ? Math.min(...screen.getAllDisplays().map((display) => display.bounds.x)) - 2000
    : undefined
  const window = new BrowserWindow({
    ...(backgroundTest ? { x: testX, y: 0, skipTaskbar: true } : {}),
    width: 1480,
    height: 960,
    minWidth: 900,
    minHeight: 640,
    title: 'FitBay',
    icon: fileURLToPath(new URL('../renderer/fitbay.png', import.meta.url)),
    backgroundColor: supportsAcrylic ? '#00000000' : '#202227',
    ...(supportsAcrylic ? { backgroundMaterial: 'acrylic' as const } : {}),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      backgroundThrottling: !backgroundTest,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.once('ready-to-show', () => {
    if (backgroundTest) window.showInactive()
    else window.show()
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    if (supportsAcrylic) url.searchParams.set('nativeBackdrop', 'acrylic')
    void window.loadURL(url.toString())
  } else {
    void window.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)), {
      query: supportsAcrylic ? { nativeBackdrop: 'acrylic' } : {},
    })
  }
}

void app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark'
  Menu.setApplicationMenu(null)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
