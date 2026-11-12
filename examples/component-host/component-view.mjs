import { BaseWindow, WebContentsView, session, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { watchNativeDock, positionAtRelease, outsideRelease } from './native-dock.mjs'
import { musicThumbnails } from './music-thumbnails.mjs'
export function componentView({
  music,
  componentRoot,
  here,
  shell,
  isShell,
  options,
  show,
  secure,
  dockTarget,
  openWorkbench,
  background,
  supportsAcrylic,
  isQuitting,
  onDispose,
  configureSession,
}) {
  let standalone, view, parent
  let mode = 'standalone'
  let presentation = 'full'
  let fullWindowBounds
  let fullWindowMaximized = false
  let phase = 'stopped'
  let error = ''
  let entry
  const sessionId = randomUUID()
  let transfer = 0
  let confirmedTransfer = 0
  let transferTimer
  let pendingAttach
  const thumbnails =
    music && process.platform === 'win32'
      ? musicThumbnails((action) => {
          if (view && !view.webContents.isDestroyed())
            view.webContents.send('music:transport', action)
        })
      : undefined

  let dragOver = null
  let placement = null
  const snapshot = () => ({
    mode,
    presentation,
    phase,
    error,
    sessionId,
    dragOver,
    placement,
    transfer,
  })
  function broadcast() {
    if (phase === 'stopped' || phase === 'crashed') thumbnails?.reset()
    else thumbnails?.owner(parent)
    if (shell() && !shell().isDestroyed())
      shell().webContents.send(music ? 'music-prototype:state' : 'prototype:state', snapshot())
    if (view && !view.webContents.isDestroyed() && !view.webContents.isCrashed())
      view.webContents.send(music ? 'music-sample:state' : 'sample:state', snapshot())
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
  function preview(value) {
    if (JSON.stringify(dragOver) !== JSON.stringify(value)) {
      dragOver = value
      broadcast()
    }
  }
  function stopMusic() {
    if (!music) return
    clearTimeout(transferTimer)
    phase = 'stopped'
    mode = 'standalone'
    presentation = 'full'
    fullWindowBounds = undefined
    fullWindowMaximized = false
    const window = standalone
    standalone = undefined
    parent = undefined
    view?.webContents.close()
    view = undefined
    window?.close()
    broadcast()
  }
  function setPresentation(next) {
    if (!music || phase !== 'ready' || next === presentation) return
    presentation = next
    view.setVisible(false)
    if (mode === 'standalone' && standalone) {
      if (next === 'background') standalone.hide()
      else {
        if (next === 'bar') {
          fullWindowMaximized = standalone.isMaximized()
          fullWindowBounds = standalone.getNormalBounds()
          if (fullWindowMaximized) standalone.unmaximize()
          standalone.setContentSize(Math.max(560, standalone.getContentSize()[0]), 100)
        } else if (fullWindowBounds) {
          standalone.setBounds(fullWindowBounds)
          if (fullWindowMaximized) standalone.maximize()
          fullWindowBounds = undefined
        }
        view.setVisible(true)
        show(standalone)
      }
    }
    broadcast()
    if (next === 'full' && mode === 'docked') shell()?.webContents.send('music-prototype:activate')
  }
  function detach(point) {
    clearTimeout(transferTimer)
    if (!view || view.webContents.isDestroyed() || view.webContents.isCrashed()) return
    if (!standalone || standalone.isDestroyed()) {
      standalone = new BaseWindow({
        ...options(660, 620),
        title: music ? 'Music' : '示例组件 · 独立窗口',
      })
      watchNativeDock(standalone, {
        target: (point) => {
          return presentation === 'full' && mode === 'standalone' && phase === 'ready'
            ? dockTarget(point, standalone)
            : null
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
      const owner = standalone
      standalone.on('closed', () => {
        if (standalone !== owner) return
        presentation = 'full'
        fullWindowBounds = undefined
        standalone = undefined
        if (!isQuitting() && mode === 'standalone') {
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
      const folder = typeof componentRoot === 'function' ? await componentRoot() : componentRoot
      if (!folder)
        throw new Error(
          music ? 'NOT_INSTALLED：请先安装 FitBay Music' : 'NOT_INSTALLED：未登记组件',
        )
      const root = await realpath(folder)
      const manifest = JSON.parse(await readFile(path.join(root, 'component.json'), 'utf8'))
      if (
        manifest.manifestVersion !== 1 ||
        manifest.protocol !== '0.1' ||
        manifest.hostApi !== '0.1'
      )
        throw new Error('INCOMPATIBLE：需要 manifest 1、协议/宿主 API 0.1')
      if (
        manifest.id !== (music ? 'io.fitbay.music' : 'io.example.counter') ||
        manifest.uiEntry !== 'index.html' ||
        JSON.stringify(manifest.capabilities) !== '["view.transfer"]'
      )
        throw new Error('DENIED：组件标识、入口或权限与固定清单不符')
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
  function openComponent(restoreWindow, showDetached = true) {
    pendingOpen ??= loadComponent(restoreWindow, showDetached).finally(() => {
      pendingOpen = undefined
    })
    return pendingOpen
  }
  async function loadComponent(restoreWindow, showDetached) {
    if (view && !view.webContents.isDestroyed() && !view.webContents.isCrashed()) return true
    const root = await discover()
    if (!root || restoreWindow?.isDestroyed()) return false
    view?.webContents.close()
    const isolated = session.fromPartition(`component-${sessionId}`)
    await configureSession?.(isolated, root)
    isolated.setPermissionRequestHandler((_, __, callback) => callback(false))
    isolated.setPermissionCheckHandler(() => false)
    const allowed = new Set(
      ['index.html', 'component.js', 'component.css'].map(
        (file) => pathToFileURL(path.join(root, file)).href,
      ),
    )
    isolated.webRequest.onBeforeRequest((details, callback) =>
      callback({
        cancel:
          !allowed.has(details.url.split('?')[0]) &&
          !(
            music &&
            (details.url.startsWith('blob:') ||
              details.url.startsWith('fitbay-audio://track/') ||
              /^fitbay-plugin:\/\/(wave|tags|rules)\/panel\.(js|css)(\?|$)/.test(details.url))
          ),
      }),
    )
    view = new WebContentsView({
      webPreferences: {
        session: isolated,
        preload: music
          ? path.resolve(root, '../host/music-preload.cjs')
          : path.join(here, 'sample-preload.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    })
    const loadingView = view
    loadingView.setBackgroundColor(music ? '#202227' : '#00000000')
    secure(view.webContents)
    if (onDispose) {
      view.webContents.once('destroyed', onDispose)
      view.webContents.once('render-process-gone', onDispose)
    }
    view.webContents.on('render-process-gone', () => {
      clearTimeout(transferTimer)
      phase = 'crashed'
      error = `CRASHED：${music ? '音乐组件' : '示例组件'}退出，可重新打开；工作台仍可使用`
      view.setVisible(false)
      broadcast()
    })
    error = ''
    if (restoreWindow) restoreDockedView(restoreWindow)
    else if (showDetached) detach()
    await view.webContents.loadFile(entry, {
      query: supportsAcrylic ? { nativeBackdrop: 'acrylic' } : {},
    })
    if (music && view === loadingView && !loadingView.webContents.isDestroyed())
      loadingView.setBackgroundColor('#00000000')
    return true
  }
  function restoreDockedView(target) {
    view.setVisible(false)
    moveTo(target)
    mode = 'docked'
    phase = 'ready'
    standalone?.hide()
    broadcast()
  }
  function cancelAttach(reason) {
    clearTimeout(transferTimer)
    error = reason
    placement = null
    if (parent && parent === standalone && !parent.isDestroyed()) {
      phase = 'ready'
      broadcast()
    } else detach()
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
      if (!(await openComponent(undefined, false))) return { ok: false, error }
      if (mode === 'docked' && phase === 'ready') return { ok: true }
      error = ''
      placement = hit
      transfer++
      phase = 'attaching'
      const attachingView = view
      await openWorkbench()
      if (view !== attachingView || phase === 'stopped') return { ok: false }
      // The shell may already have acknowledged its bounds while loadFile was pending.
      if (mode === 'docked' && phase === 'ready') return { ok: true }
      broadcast()
      transferTimer = setTimeout(() => {
        cancelAttach('TIMEOUT：目标面板未就绪，保留独立窗口')
      }, 5000)
      return { ok: true }
    } catch (failure) {
      if (!parent && view && !view.webContents.isDestroyed()) detach()
      phase = 'ready'
      error = failure.message
      broadcast()
      return { ok: false, error }
    }
  }

  return {
    isSender: isSample,
    discover,
    preview,
    listen() {
      if (music)
        ipcMain.on('music-sample:thumbnail-state', (event, state) => {
          if (isSample(event)) thumbnails?.update(state)
        })
      ipcMain.handle(music ? 'music-sample:hello' : 'sample:hello', (event, payload) => {
        if (!isSample(event) || payload?.protocol !== '0.1') throw new Error('DENIED')
        return snapshot()
      })
      ipcMain.handle(music ? 'music-sample:transfer' : 'sample:transfer', (event, action) => {
        if (!isSample(event) || !['attach', 'detach'].includes(action))
          return { ok: false, error: 'DENIED' }
        setPresentation('full')
        if (action === 'attach') return attach()
        detach()
        return { ok: true }
      })
      ipcMain.handle(music ? 'music-prototype:status' : 'prototype:status', (event) => {
        if (!isShell(event)) throw new Error('DENIED')
        return snapshot()
      })
      ipcMain.handle(music ? 'music-prototype:restore' : 'prototype:restore', async (event) => {
        if (!isShell(event)) throw new Error('DENIED')
        if (presentation !== 'full') {
          broadcast()
          return
        }
        if (phase === 'stopped') await openComponent(shell())
        else if (music && phase === 'ready' && mode === 'standalone') {
          // The saved slot can be an inactive tab. Its renderer will report bounds
          // when visible; adopting the live player now preserves the active tab.
          error = ''
          restoreDockedView(shell())
        }
      })
      if (music)
        ipcMain.handle('music-sample:presentation', (event, next) => {
          if (!isSample(event) || !['full', 'bar', 'background'].includes(next))
            throw Error('DENIED')
          setPresentation(next)
        })
      if (music) {
        ipcMain.handle('music-prototype:reveal', (event) => {
          if (!isShell(event)) throw Error('DENIED')
          if (presentation === 'background') setPresentation('full')
        })
        ipcMain.handle('music-prototype:close', (event) => {
          if (!isShell(event)) throw Error('DENIED')
          stopMusic()
        })
      }
      ipcMain.handle(music ? 'music-prototype:open' : 'prototype:open', (event) => {
        if (!isShell(event)) throw new Error('DENIED')
        return attach()
      })
      ipcMain.handle(music ? 'music-prototype:detach' : 'prototype:detach', (event, release) => {
        if (!isShell(event)) throw new Error('DENIED')
        if (mode !== 'docked' || phase !== 'ready') return
        if (release === undefined) return detach()
        const point = outsideRelease(shell(), release)
        if (point) detach(point)
      })
      ipcMain.on(
        music ? 'music-prototype:confirmed-transfer' : 'prototype:confirmed-transfer',
        (event, id) => {
          event.returnValue = Boolean(isShell(event) && id > 0 && id === confirmedTransfer)
        },
      )
      ipcMain.on(music ? 'music-prototype:bounds' : 'prototype:bounds', (event, bounds, id) => {
        if (!isShell(event) || !view || !['ready', 'attaching'].includes(phase)) return
        if (presentation === 'background' || (presentation === 'bar') !== (id === 'bar')) return
        if (phase === 'attaching' && id !== transfer) return
        if (bounds === null) {
          if (parent === shell()) view.setVisible(false)
          return
        }
        if (
          !bounds ||
          !['x', 'y', 'width', 'height'].every(
            (key) => Number.isFinite(bounds[key]) && bounds[key] >= 0,
          )
        )
          return
        const [width, height] = shell().getContentSize()
        if (
          bounds.width < 1 ||
          bounds.height < 1 ||
          bounds.x + bounds.width > width + 1 ||
          bounds.y + bounds.height > height + 1
        )
          return
        if (phase === 'attaching') {
          clearTimeout(transferTimer)
          const transferFocus = !background && standalone?.isFocused()
          moveTo(shell())
          if (transferFocus) shell().focus()
          mode = 'docked'
          confirmedTransfer = transfer
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
    },
    closing() {
      if (phase === 'attaching') cancelAttach('目标工作台已关闭')
      else if (parent === shell()) {
        if (!music) detach()
        else stopMusic()
      }
    },
    reloading() {
      if (phase === 'attaching') cancelAttach('目标工作台已重新加载')
    },
    quit() {
      clearTimeout(transferTimer)
      view?.webContents.close()
    },
    async open() {
      if (!(await openComponent())) return false
      setPresentation('full')
      const window = parent ?? shell()
      if (mode === 'docked')
        shell().webContents.send(music ? 'music-prototype:activate' : 'prototype:activate')
      if (window.isMinimized()) window.restore()
      show(window)
      return true
    },
    failure: () => error,
  }
}
