import { app, BrowserWindow, Menu, nativeTheme, ipcMain, screen } from 'electron'
import { fileURLToPath } from 'node:url'
import { release } from 'node:os'

const supportsAcrylic = process.platform === 'win32' && Number(release().split('.')[2]) >= 22621

function createWindow() {
  const backgroundTest = !app.isPackaged && process.env.WORKBENCH_TEST_BACKGROUND === '1'
  const testX = backgroundTest
    ? Math.min(...screen.getAllDisplays().map((display) => display.bounds.x)) - 2000
    : undefined
  const window = new BrowserWindow({
    ...(backgroundTest ? { x: testX, y: 0, skipTaskbar: true } : {}),
    width: 1480,
    height: 960,
    minWidth: 900,
    minHeight: 640,
    title: '个人工作台',
    backgroundColor: supportsAcrylic ? '#00000000' : '#202227',
    ...(supportsAcrylic ? { backgroundMaterial: 'acrylic' as const } : {}),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      backgroundThrottling: !backgroundTest,
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
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
  ipcMain.handle('theme:set', (event, theme: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (
      !window ||
      event.senderFrame !== event.sender.mainFrame ||
      (theme !== 'dark' && theme !== 'light')
    )
      return
    nativeTheme.themeSource = theme
    if (!supportsAcrylic) window.setBackgroundColor(theme === 'dark' ? '#202227' : '#eef2fa')
  })
  Menu.setApplicationMenu(null)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
