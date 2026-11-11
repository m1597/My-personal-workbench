import { BrowserWindow, ipcMain, session } from 'electron'
import { randomUUID } from 'node:crypto'
import { watchNativeDock, outsideRelease, positionAtRelease } from './native-dock.mjs'

const ids = ['module-1', 'module-2', 'module-3', 'module-4']
export const isBuiltin = (id) => ids.includes(id)

export function builtinWindows(host) {
  const records = new Map()
  let firstReport = Promise.withResolvers()
  let workspace
  let revision = 0
  const snapshot = () => ({
    revision,
    detached: [...records].filter(([, record]) => record.ready).map(([id]) => id),
    workspace,
  })
  function notify() {
    revision++
    const state = snapshot()
    const shell = host.shell()
    if (shell && !shell.isDestroyed()) shell.webContents.send('builtin:state', state)
    for (const { window } of records.values())
      if (!window.isDestroyed()) window.webContents.send('builtin:state', state)
  }
  function owner(event) {
    if (event.senderFrame !== event.sender.mainFrame) return
    for (const [id, record] of records) if (record.window.webContents === event.sender) return id
  }
  function raise(window) {
    if (window.isMinimized()) window.restore()
    host.show(window)
  }
  function cancel(record) {
    clearTimeout(record.timer)
    record.token = undefined
  }
  function offer(id, record, target) {
    const shell = host.shell()
    if (!record.ready || record.token || !shell || shell.isDestroyed()) return
    record.token = randomUUID()
    record.timer = setTimeout(() => cancel(record), 5000)
    shell.webContents.send('builtin:dock', { id, target, token: record.token })
  }
  async function create(id, point, query = '') {
    const current = records.get(id)
    if (current) {
      if (current.ready) raise(current.window)
      return current.loading
    }
    if (!host.workbenchFile) throw new Error('未部署内置模块界面')
    const isolated = session.fromPartition('builtin-' + id)
    isolated.setPermissionRequestHandler((_, __, callback) => callback(false))
    isolated.setPermissionCheckHandler(() => false)
    const window = new BrowserWindow({
      ...host.options(680, 550),
      title: '模块 ' + id.slice(-1) + ' · 独立窗口',
      webPreferences: {
        session: isolated,
        preload: host.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    })
    const mounted = Promise.withResolvers()
    const stopped = Promise.withResolvers()
    const startupTimer = setTimeout(() => stopped.resolve(false), 8000)
    const record = { window, ready: false, query, mounted }
    records.set(id, record)
    host.secure(window.webContents)
    window.on('page-title-updated', (event) => event.preventDefault())
    window.once('closed', () => {
      clearTimeout(startupTimer)
      stopped.resolve(false)
      cancel(record)
      if (records.get(id) === record) records.delete(id)
      notify()
    })
    window.webContents.on('render-process-gone', () => {
      if (!window.isDestroyed()) window.destroy()
    })
    watchNativeDock(window, {
      target: (point) => host.dockTarget(point, window),
      preview: host.preview,
      commit: (target) => offer(id, record, target),
    })
    if (point) positionAtRelease(window, point, host.background)
    const loaded = window.loadFile(host.workbenchFile, {
      query: {
        builtin: id,
        ...(host.supportsAcrylic ? { nativeBackdrop: 'acrylic' } : {}),
      },
    })
    record.loading = Promise.race([Promise.all([loaded, mounted.promise]), stopped.promise])
      .then((ready) => {
        if (!ready || window.isDestroyed()) {
          if (!window.isDestroyed()) window.destroy()
          return false
        }
        clearTimeout(startupTimer)
        record.ready = true
        host.show(window)
        notify()
        return true
      })
      .catch((error) => {
        clearTimeout(startupTimer)
        if (!window.isDestroyed()) window.destroy()
        throw error
      })
    return record.loading
  }
  async function open(id) {
    const record = records.get(id)
    if (record) return create(id)
    const shell = host.shell()
    if (shell && !workspace) {
      let timer
      const ready = await Promise.race([
        firstReport.promise,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), 8000)
        }),
      ]).finally(() => clearTimeout(timer))
      if (!ready || host.shell() !== shell || shell.isDestroyed()) return false
      if (records.has(id)) return create(id)
    }
    if (shell && workspace?.visible.includes(id)) {
      raise(shell)
      shell.webContents.send('builtin:activate', id)
      return true
    }
    return create(id)
  }
  function listen() {
    ipcMain.on('builtin:mounted', (event) => records.get(owner(event))?.mounted.resolve(true))
    ipcMain.handle('builtin:status', (event) => {
      const id = owner(event)
      if (!host.isShell(event) && !id) throw new Error('DENIED')
      return { ...snapshot(), query: id ? records.get(id).query : undefined }
    })
    ipcMain.handle('builtin:open', (event, id) => {
      if (!isBuiltin(id) || (!host.isShell(event) && owner(event) !== 'module-1'))
        throw new Error('DENIED')
      if (records.has(id) || !host.shell()) return open(id)
      raise(host.shell())
      host.shell().webContents.send('builtin:activate', id)
      return true
    })
    ipcMain.handle('builtin:detach', (event, id, release, query) => {
      if (!host.isShell(event) || !isBuiltin(id) || typeof query !== 'string')
        throw new Error('DENIED')
      const point = outsideRelease(host.shell(), release)
      return point ? create(id, point, id === 'module-1' ? query : '') : false
    })
    ipcMain.on('builtin:query', (event, value) => {
      if (owner(event) === 'module-1' && typeof value === 'string')
        records.get('module-1').query = value
    })
    ipcMain.on('builtin:commit', (event, id, token) => {
      if (!host.isShell(event) || !isBuiltin(id) || typeof token !== 'string') {
        event.returnValue = null
        return
      }
      const record = records.get(id)
      if (!record || record.token !== token) {
        event.returnValue = null
        return
      }
      cancel(record)
      event.returnValue = { query: record.query }
      record.window.destroy()
    })
    ipcMain.on('builtin:workspace', (event, info) => {
      if (
        !host.isShell(event) ||
        !Array.isArray(info?.visible) ||
        info.visible.length > 4 ||
        !info.visible.every(isBuiltin) ||
        (info.active !== undefined && !isBuiltin(info.active)) ||
        ![info.width, info.height].every((value) => Number.isFinite(value) && value >= 0)
      )
        return
      workspace = {
        visible: info.visible,
        active: info.active,
        width: info.width,
        height: info.height,
      }
      firstReport.resolve(true)
      notify()
    })
  }
  function shellClosed() {
    firstReport.resolve(false)
    firstReport = Promise.withResolvers()
    workspace = undefined
    for (const record of records.values()) cancel(record)
    // The shell's closed event fires after its webContents has been destroyed.
    revision++
    for (const { window } of records.values())
      if (!window.isDestroyed()) window.webContents.send('builtin:state', snapshot())
  }
  return { listen, open, shellClosed }
}
