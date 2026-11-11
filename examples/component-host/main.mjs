import { builtinWindows, isBuiltin } from './builtin-windows.mjs'
import { release } from 'node:os'
import {
  watchNativeDock,
  shellExposed,
  snapTarget,
  positionAtRelease,
  outsideRelease,
} from './native-dock.mjs'
import {
  app,
  BaseWindow,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  session,
  screen,
  nativeTheme,
  Menu,
} from 'electron'
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

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
let shell, standalone, view, parent
let mode = 'standalone'
let phase = 'stopped'
let error = ''
let entry
const sessionId = randomUUID()
let transferTimer
let pendingAttach
let quitting = false
let dropZone
let dragOver = null
let placement = null
const snapshot = () => ({ mode, phase, error, sessionId, dragOver, placement })
function broadcast() {
  if (shell && !shell.isDestroyed()) shell.webContents.send('prototype:state', snapshot())
  if (view && !view.webContents.isDestroyed() && !view.webContents.isCrashed())
    view.webContents.send('sample:state', snapshot())
}
function options(width, height) {
  return {
    width,
    height,
    show: false,
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
function isSample(event) {
  return (
    view && event.sender === view.webContents && event.senderFrame === view.webContents.mainFrame
  )
}
function moveTo(window) {
  if (parent && !parent.isDestroyed()) parent.contentView.removeChildView(view)
  window.contentView.addChildView(view)
  parent = window
}
function dockTarget(point, source) {
  if (!shell || shell.isDestroyed() || shell.isMinimized() || !shell.isVisible() || !dropZone)
    return null
  const content = shell.getContentBounds()
  const hit = snapTarget({ x: point.x - content.x, y: point.y - content.y }, dropZone)
  return hit && shellExposed(point, source, shell) ? hit : null
}
function preview(value) {
  if (JSON.stringify(dragOver) !== JSON.stringify(value)) {
    dragOver = value
    broadcast()
  }
}
function detach(point) {
  clearTimeout(transferTimer)
  if (!view || view.webContents.isDestroyed() || view.webContents.isCrashed()) return
  if (!standalone || standalone.isDestroyed()) {
    standalone = new BaseWindow({ ...options(660, 620), title: '示例组件 · 独立窗口' })
    watchNativeDock(standalone, {
      target: (point) => {
        return mode === 'standalone' && phase === 'ready' ? dockTarget(point, standalone) : null
      },
      commit: (hit) => void attach(hit),
      preview,
    })
    standalone.on('resize', () => {
      if (mode === 'standalone' && view) {
        const [width, height] = standalone.getContentSize()
        view.setBounds({ x: 0, y: 0, width, height })
      }
    })
    standalone.on('closed', () => {
      standalone = undefined
      if (!quitting && mode === 'standalone') {
        view?.webContents.close()
        view = undefined
        parent = undefined
        phase = 'stopped'
        broadcast()
      }
    })
  }
  if (point) positionAtRelease(standalone, point, background)
  moveTo(standalone)
  mode = 'standalone'
  phase = 'ready'
  const [width, height] = standalone.getContentSize()
  view.setBounds({ x: 0, y: 0, width, height })
  view.setVisible(true)
  show(standalone)
  broadcast()
}
async function discover() {
  try {
    if (!componentRoot) throw new Error('NOT_INSTALLED：未登记示例组件')
    const root = await realpath(componentRoot)
    const manifest = JSON.parse(await readFile(path.join(root, 'component.json'), 'utf8'))
    if (manifest.manifestVersion !== 1 || manifest.protocol !== '0.1' || manifest.hostApi !== '0.1')
      throw new Error('INCOMPATIBLE：需要 manifest 1、协议/宿主 API 0.1')
    if (
      manifest.id !== 'io.example.counter' ||
      manifest.uiEntry !== 'index.html' ||
      JSON.stringify(manifest.capabilities) !== '["view.transfer"]'
    )
      throw new Error('DENIED：原型仅允许指定示例及 view.transfer 能力')
    entry = await realpath(path.join(root, manifest.uiEntry))
    if (path.dirname(entry) !== root) throw new Error('DENIED：入口越界')
    return root
  } catch (failure) {
    error = failure.code === 'ENOENT' ? 'NOT_INSTALLED：组件清单或入口不存在' : failure.message
    phase = 'unavailable'
    broadcast()
  }
}
let pendingOpen
function openComponent(restoreWindow) {
  pendingOpen ??= loadComponent(restoreWindow).finally(() => {
    pendingOpen = undefined
  })
  return pendingOpen
}
async function loadComponent(restoreWindow) {
  if (view && !view.webContents.isDestroyed() && !view.webContents.isCrashed()) return true
  const root = await discover()
  if (!root || restoreWindow?.isDestroyed()) return false
  view?.webContents.close()
  const isolated = session.fromPartition(`component-${sessionId}`)
  isolated.setPermissionRequestHandler((_, __, callback) => callback(false))
  isolated.setPermissionCheckHandler(() => false)
  const allowed = new Set(
    ['index.html', 'component.js', 'component.css'].map(
      (file) => pathToFileURL(path.join(root, file)).href,
    ),
  )
  isolated.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: !allowed.has(details.url.split('?')[0]) }),
  )
  view = new WebContentsView({
    webPreferences: {
      session: isolated,
      preload: path.join(here, 'sample-preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })
  view.setBackgroundColor('#00000000')
  secure(view.webContents)
  view.webContents.on('render-process-gone', () => {
    clearTimeout(transferTimer)
    phase = 'crashed'
    error = 'CRASHED：示例组件退出，可重新打开；工作台仍可使用'
    view.setVisible(false)
    broadcast()
  })
  error = ''
  if (restoreWindow) {
    view.setVisible(false)
    moveTo(restoreWindow)
    mode = 'docked'
    phase = 'ready'
    broadcast()
  } else detach()
  await view.webContents.loadFile(entry, {
    query: supportsAcrylic ? { nativeBackdrop: 'acrylic' } : {},
  })
  return true
}
async function openWorkbench() {
  if (shell && !shell.isDestroyed()) return
  if (!workbenchFile) throw new Error('NOT_INSTALLED：未部署工作台界面；组件仍可独立使用')
  const file = await realpath(workbenchFile)
  shell = new BrowserWindow({
    ...options(1480, 960),
    minWidth: 900,
    minHeight: 640,
    title: '个人工作台',
    webPreferences: {
      preload: path.join(here, 'workbench-preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })
  secure(shell.webContents)
  shell.webContents.on('did-start-loading', builtins.shellClosed)
  shell.on('close', () => {
    if (!quitting && parent === shell) detach()
  })
  shell.on('closed', () => {
    builtins.shellClosed()
    shell = undefined
    dropZone = undefined
  })
  await shell.loadFile(file, { query: supportsAcrylic ? { nativeBackdrop: 'acrylic' } : {} })
  show(shell)
}
function attach(hit = null) {
  pendingAttach ??= startAttach(hit).finally(() => {
    pendingAttach = undefined
  })
  return pendingAttach
}
async function startAttach(hit) {
  if ((mode === 'docked' && phase === 'ready') || phase === 'attaching') return { ok: true }
  try {
    if (!(await openComponent())) return { ok: false, error }
    if (mode === 'docked' && phase === 'ready') return { ok: true }
    error = ''
    placement = hit
    phase = 'attaching'
    await openWorkbench()
    // The shell may already have acknowledged its bounds while loadFile was pending.
    if (mode === 'docked' && phase === 'ready') return { ok: true }
    broadcast()
    transferTimer = setTimeout(() => {
      error = 'TIMEOUT：目标面板未就绪，保留独立窗口'
      detach()
    }, 5000)
    return { ok: true }
  } catch (failure) {
    phase = 'ready'
    error = failure.message
    broadcast()
    return { ok: false, error }
  }
}

const builtins = builtinWindows({
  shell: () => shell,
  isShell,
  options,
  show,
  secure,
  preview,
  dockTarget,
  background,
  workbenchFile,
  preload: path.join(here, 'builtin-preload.cjs'),
  supportsAcrylic,
})
const requestedMode = argument('mode')
const intent =
  requestedMode === 'workbench' || isBuiltin(requestedMode) ? requestedMode : 'component'
let requests = Promise.resolve()
async function openIntent(request) {
  if (isBuiltin(request)) return builtins.open(request)
  if (request === 'workbench') {
    if (!shell || shell.isDestroyed()) {
      await discover()
      await openWorkbench()
    } else {
      if (shell.isMinimized()) shell.restore()
      show(shell)
    }
  } else if (await openComponent()) {
    const window = mode === 'docked' ? shell : standalone
    if (mode === 'docked') shell.webContents.send('prototype:activate')
    if (window.isMinimized()) window.restore()
    show(window)
  } else if (workbenchFile) await openWorkbench()
  else throw new Error(error)
}
if (!app.requestSingleInstanceLock({ intent })) app.quit()
else {
  app.on('second-instance', (_event, _argv, _cwd, data) => {
    if (data.intent === 'workbench' || data.intent === 'component' || isBuiltin(data.intent))
      requests = requests.then(() => openIntent(data.intent)).catch(console.error)
  })
  app.on('before-quit', () => {
    quitting = true
    clearTimeout(transferTimer)
    view?.webContents.close()
  })
  app.on('window-all-closed', () => {
    if (!quitting) app.quit()
  })
  requests = app
    .whenReady()
    .then(async () => {
      builtins.listen()
      Menu.setApplicationMenu(null)
      nativeTheme.themeSource = 'dark'
      ipcMain.handle('sample:hello', (event, payload) => {
        if (!isSample(event) || payload?.protocol !== '0.1') throw new Error('DENIED')
        return snapshot()
      })
      ipcMain.handle('sample:transfer', (event, action) => {
        if (!isSample(event) || !['attach', 'detach'].includes(action))
          return { ok: false, error: 'DENIED' }
        if (action === 'attach') return attach()
        detach()
        return { ok: true }
      })
      ipcMain.handle('prototype:status', (event) => {
        if (!isShell(event)) throw new Error('DENIED')
        return snapshot()
      })
      ipcMain.handle('prototype:restore', async (event) => {
        if (!isShell(event)) throw new Error('DENIED')
        if (phase === 'stopped') await openComponent(shell)
      })
      ipcMain.handle('prototype:open', (event) => {
        if (!isShell(event)) throw new Error('DENIED')
        return attach()
      })
      ipcMain.handle('prototype:detach', (event, release) => {
        if (!isShell(event)) throw new Error('DENIED')
        if (mode !== 'docked' || phase !== 'ready') return
        if (release === undefined) return detach()
        const point = outsideRelease(shell, release)
        if (point) detach(point)
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
      ipcMain.on('prototype:bounds', (event, bounds) => {
        if (!isShell(event) || !view || !['ready', 'attaching'].includes(phase)) return
        if (bounds === null) {
          if (parent === shell) view.setVisible(false)
          return
        }
        if (
          !bounds ||
          !['x', 'y', 'width', 'height'].every(
            (key) => Number.isFinite(bounds[key]) && bounds[key] >= 0,
          )
        )
          return
        const [width, height] = shell.getContentSize()
        if (
          bounds.width < 1 ||
          bounds.height < 1 ||
          bounds.x + bounds.width > width + 1 ||
          bounds.y + bounds.height > height + 1
        )
          return
        if (phase === 'attaching') {
          clearTimeout(transferTimer)
          moveTo(shell)
          mode = 'docked'
          phase = 'ready'
          standalone?.hide()
          broadcast()
        }
        if (mode === 'docked') {
          view.setBounds(
            Object.fromEntries(Object.entries(bounds).map(([k, v]) => [k, Math.round(v)])),
          )
          view.setVisible(true)
        }
      })
      await openIntent(intent)
    })
    .catch((failure) => {
      console.error(failure)
      app.exit(1)
    })
}
