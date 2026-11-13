import { installMusic } from './music-installer.mjs'
import { installedProducts, registeredProduct } from './installed-products.mjs'
import { builtinWindows, isBuiltin } from './builtin-windows.mjs'
import { release } from 'node:os'
import { shellExposed, snapTarget } from './native-dock.mjs'
import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  screen,
  nativeTheme,
  systemPreferences,
  Menu,
} from 'electron'
import { access, realpath } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { componentView } from './component-view.mjs'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'fitbay-audio',
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true },
  },
])
const here = path.dirname(fileURLToPath(import.meta.url))
const argument = (name) =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
const installation = app.isPackaged ? await installedProducts(app.getAppPath()) : undefined
if (installation) app.setName('FitBay')
const profile =
  argument('user-data-dir') ||
  (installation && path.join(app.getPath('appData'), 'FitBay', 'desktop-profile'))
if (!profile || !path.isAbsolute(profile)) throw new Error('原型必须指定独立的绝对 --user-data-dir')
app.setPath('userData', profile)
const componentRoot = installation ? undefined : argument('component')
const workbenchFile = installation ? undefined : argument('workbench')
async function findWorkbenchFile() {
  if (!installation) return workbenchFile
  const root = await installation.find('workbench')
  return root && path.join(root, 'workbench', 'index.html')
}
async function findMusicRoot() {
  if (!installation) {
    const local = path.join(here, '../music')
    try {
      await access(path.join(local, 'component.json'))
      return local
    } catch (failure) {
      if (failure.code !== 'ENOENT') throw failure
    }
  }
  const root = installation ? await installation.find('music') : await registeredProduct('music')
  return root && path.join(root, 'music')
}
const supportsAcrylic = process.platform === 'win32' && Number(release().split('.')[2]) >= 22621
const background = process.env.WORKBENCH_TEST_BACKGROUND === '1'
if (background) app.commandLine.appendSwitch('mute-audio')
const fixturePanels = process.env.FITBAY_TEST_PANELS === '1' && background
let shell, dropZone
let quitting = false
function options(width, height) {
  return {
    width,
    height,
    show: false,
    icon: path.join(here, 'fitbay.png'),
    backgroundColor: supportsAcrylic ? '#00000000' : '#202227',
    ...(supportsAcrylic ? { backgroundMaterial: 'acrylic' } : {}),
    ...(background
      ? {
          x: Math.min(...screen.getAllDisplays().map((d) => d.bounds.x)) - 2200,
          y: 0,
          skipTaskbar: true,
          focusable: false,
        }
      : {}),
  }
}
function show(window) {
  if (background) window.showInactive()
  else window.show()
}
function secure(contents) {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event) => event.preventDefault())
  contents.on('will-attach-webview', (event) => event.preventDefault())
}
function isShell(event) {
  return (
    shell && event.sender === shell.webContents && event.senderFrame === shell.webContents.mainFrame
  )
}
function dockTarget(point, source) {
  if (!shell || shell.isDestroyed() || shell.isMinimized() || !shell.isVisible() || !dropZone)
    return null
  const content = shell.getContentBounds()
  const hit = snapTarget({ x: point.x - content.x, y: point.y - content.y }, dropZone)
  return hit && shellExposed(point, source, shell) ? hit : null
}
let openingWorkbench
function openWorkbench() {
  openingWorkbench ??= createWorkbench().finally(() => {
    openingWorkbench = undefined
  })
  return openingWorkbench
}
async function createWorkbench() {
  if (shell && !shell.isDestroyed()) return
  const entry = await findWorkbenchFile()
  if (!entry) throw new Error('NOT_INSTALLED：未安装 FitBay 工作台；Music 仍可独立使用')
  const file = await realpath(entry)
  shell = new BrowserWindow({
    ...options(1480, 960),
    minWidth: 900,
    minHeight: 640,
    title: 'FitBay',
    ...(process.platform === 'win32'
      ? {
          titleBarStyle: 'hidden',
          titleBarOverlay: { color: '#00000000', height: 32 },
        }
      : {}),
    webPreferences: {
      preload: path.join(here, 'workbench-preload.cjs'),
      additionalArguments: [
        ...(componentRoot ? ['--enable-sample-component'] : []),
        ...(fixturePanels ? ['--fixture-panels'] : []),
      ],
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })
  if (process.platform === 'win32') {
    const workbench = shell
    const updateSymbols = () =>
      workbench.setTitleBarOverlay({
        symbolColor: nativeTheme.shouldUseHighContrastColors
          ? systemPreferences.getColor('window-text')
          : '#e7e9ee',
      })
    updateSymbols()
    nativeTheme.on('updated', updateSymbols)
    workbench.once('closed', () => nativeTheme.off('updated', updateSymbols))
  }
  secure(shell.webContents)
  shell.webContents.on('did-start-loading', builtins.shellClosed)
  shell.on('close', () => {
    if (!quitting) for (const item of components) item.closing()
  })
  shell.on('closed', () => {
    builtins.shellClosed()
    shell = undefined
    dropZone = undefined
  })
  await shell.loadFile(file, {
    query: {
      ...(supportsAcrylic ? { nativeBackdrop: 'acrylic' } : {}),
      ...(fixturePanels ? { fixturePanels: '1' } : {}),
    },
  })
  shell.webContents.on('did-start-loading', () => {
    for (const item of components) item.reloading()
  })
  show(shell)
}
const shared = {
  here,
  shell: () => shell,
  isShell,
  options,
  show,
  secure,
  dockTarget,
  openWorkbench,
  background,
  supportsAcrylic,
  isQuitting: () => quitting,
}
const sample = componentView({ ...shared, componentRoot, music: false })
let closeSourcePipe
let musicRuntime
let startingMusic
function startMusic(root) {
  startingMusic ??= loadMusic(root).catch((error) => {
    startingMusic = undefined
    throw error
  })
  return startingMusic
}
async function loadMusic(root) {
  const hostRoot = path.join(root, '../host')
  const [{ musicService }, { startSourcePipe }] = await Promise.all(
    ['music-service.mjs', 'music-source-pipe.mjs'].map(
      (name) => import(pathToFileURL(path.join(hostRoot, name)).href),
    ),
  )
  const script = installation ? path.join(root, '../scripts/music-source-mcp.mjs') : undefined
  musicRuntime = musicService(profile, music.isSender, script)
  closeSourcePipe = await startSourcePipe(profile, (...args) =>
    musicRuntime.sourceTool(...args),
  ).catch(() => {
    console.warn('本地音源 MCP 未能连接')
  })
}
const music = componentView({
  configureSession: async (s, root) => {
    await startMusic(root)
    musicRuntime.register(s)
  },
  onDispose: () => musicRuntime?.dispose(),
  ...shared,
  componentRoot: findMusicRoot,
  music: true,
})
const components = [sample, music]
const builtins = builtinWindows({
  shell: () => shell,
  isShell,
  options,
  show,
  secure,
  preview: sample.preview,
  dockTarget,
  background,
  workbenchFile,
  preload: path.join(here, 'builtin-preload.cjs'),
  supportsAcrylic,
})
const requestedMode = installation?.product || argument('mode')
const intent =
  requestedMode === 'music' ||
  requestedMode === 'workbench' ||
  (fixturePanels && isBuiltin(requestedMode))
    ? requestedMode
    : 'component'
let requests = Promise.resolve()
async function openIntent(request) {
  if (fixturePanels && isBuiltin(request)) return builtins.open(request)
  if (request === 'workbench') {
    if (!shell || shell.isDestroyed()) {
      await sample.discover()
      await openWorkbench()
    } else {
      if (shell.isMinimized()) shell.restore()
      show(shell)
    }
  } else {
    const component = request === 'music' ? music : sample
    if (!(await component.open())) {
      if (await findWorkbenchFile()) await openWorkbench()
      else throw new Error(component.failure())
    }
  }
}
if (!app.requestSingleInstanceLock({ intent })) app.quit()
else {
  app.on('second-instance', (_event, _argv, _cwd, data) => {
    if (
      data.intent === 'music' ||
      data.intent === 'workbench' ||
      data.intent === 'component' ||
      (fixturePanels && isBuiltin(data.intent))
    )
      requests = requests.then(() => openIntent(data.intent)).catch(console.error)
  })
  app.on('before-quit', () => {
    quitting = true
    closeSourcePipe?.()
    for (const item of components) item.quit()
  })
  app.on('window-all-closed', () => {
    if (!quitting) app.quit()
  })
  requests = app
    .whenReady()
    .then(async () => {
      if (fixturePanels) builtins.listen()
      Menu.setApplicationMenu(null)
      nativeTheme.themeSource = 'dark'
      ipcMain.handle('workbench:music-installed', async (event) => {
        if (!isShell(event)) throw Error('DENIED')
        return Boolean(await music.discover())
      })
      let pendingInstall
      ipcMain.handle('workbench:install-music', (event) => {
        if (!isShell(event)) throw Error('DENIED')
        pendingInstall ??= installMusic(shell, here)
          .catch(() => 'failed')
          .finally(() => {
            pendingInstall = undefined
          })
        return pendingInstall
      })
      ipcMain.on('workbench:material', (event, value) => {
        if (
          !isShell(event) ||
          !value ||
          !['transparency', 'frost', 'brightness'].every(
            (key) => Number.isInteger(value[key]) && value[key] >= 0 && value[key] <= 100,
          )
        )
          return
        const { transparency, frost, brightness } = value
        for (const item of components) item.setMaterial({ transparency, frost, brightness })
      })
      ipcMain.on('prototype:drop-zone', (event, regions) => {
        if (!isShell(event)) return
        dropZone = null
        const [width, height] = shell.getContentSize()
        if (
          Array.isArray(regions) &&
          regions.length <= 16 &&
          regions.every(
            (rect) =>
              rect &&
              typeof rect.id === 'string' &&
              ['x', 'y', 'width', 'height'].every(
                (k) => Number.isFinite(rect[k]) && rect[k] >= 0,
              ) &&
              rect.width > 0 &&
              rect.height > 0 &&
              rect.x + rect.width <= width + 1 &&
              rect.y + rect.height <= height + 1,
          )
        )
          dropZone = regions
      })
      for (const item of components) item.listen()
      const musicRoot = await music.discover()
      if (musicRoot) await startMusic(musicRoot)
      await openIntent(intent)
    })
    .catch((failure) => {
      console.error(failure)
      app.exit(1)
    })
}
