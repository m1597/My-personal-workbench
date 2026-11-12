import { startSourcePipe } from './music-source-pipe.mjs'
import { builtinWindows, isBuiltin } from './builtin-windows.mjs'
import { release } from 'node:os'
import { shellExposed, snapTarget } from './native-dock.mjs'
import { app, BrowserWindow, ipcMain, protocol, screen, nativeTheme, Menu } from 'electron'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { componentView } from './component-view.mjs'
import { musicService } from './music-service.mjs'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'fitbay-audio',
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true },
  },
])
const here = path.dirname(fileURLToPath(import.meta.url))
const argument = (name) =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
// The launcher selects a profile explicitly. Tests always supply a temporary directory.
const profile = argument('user-data-dir')
if (!profile || !path.isAbsolute(profile)) throw new Error('原型必须指定独立的绝对 --user-data-dir')
app.setPath('userData', profile)
const componentRoot = argument('component')
const workbenchFile = argument('workbench')
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
  if (!workbenchFile) throw new Error('NOT_INSTALLED：未部署工作台界面；组件仍可独立使用')
  const file = await realpath(workbenchFile)
  shell = new BrowserWindow({
    ...options(1480, 960),
    minWidth: 900,
    minHeight: 640,
    title: 'FitBay',
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
const music = componentView({
  configureSession: (s) => musicRuntime.register(s),
  onDispose: () => musicRuntime?.dispose(),
  ...shared,
  componentRoot: path.resolve(here, '../music'),
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
const requestedMode = argument('mode')
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
      if (workbenchFile) await openWorkbench()
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
      musicRuntime = musicService(profile, music.isSender)
      closeSourcePipe = await startSourcePipe(profile, (...args) =>
        musicRuntime.sourceTool(...args),
      ).catch(() => {
        console.warn('本地音源 MCP 未能连接')
      })
      await openIntent(intent)
    })
    .catch((failure) => {
      console.error(failure)
      app.exit(1)
    })
}
