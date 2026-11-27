import { resultBounds } from './result-placement.mjs'
import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  clipboard,
  ClipboardItem,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  nativeTheme,
  safeStorage,
  screen,
} from 'electron'
import { watch, existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { writeFile, readFile, unlink, lstat } from 'node:fs/promises'
import path from 'node:path'
import { release } from 'node:os'
import koffi from 'koffi'
import { installLocalFiles, setToolInputs } from './local-files.mjs'
import { nativeImage } from 'electron'
import { translateImage } from './image-translation.mjs'
import { complete } from './model.mjs'
import { toolkitConnections } from './toolkit-connections.mjs'
import { readSelectionOrOcr } from './native.mjs'
const here = import.meta.dirname
const catalog = JSON.parse(readFileSync(path.join(here, 'catalog.json'), 'utf8'))
const shared =
  process.argv.find((x) => x.startsWith('--workbench-profile='))?.slice(20) ||
  (app.isPackaged
    ? path.join(app.getPath('appData'), 'FitBay', 'desktop-profile')
    : path.resolve(here, '../../local/desktop-profile'))
app.setAppUserModelId('io.github.m1597.fitbay.toolkit')
app.setPath('userData', path.join(shared, 'toolkit'))
mkdirSync(app.getPath('userData'), { recursive: true })
let dispatchIntent
const pendingIntents = []
if (!app.requestSingleInstanceLock()) {
  app.exit(0)
} else {
  app.on('second-instance', (_event, argv) => {
    if (dispatchIntent) dispatchIntent(argv)
    else pendingIntents.push(argv)
  })
  void app.whenReady().then(startToolkit)
}
async function startToolkit() {
  nativeTheme.themeSource = 'dark'
  const file = path.join(app.getPath('userData'), 'settings.json')
  const defaults = {
    capture: { enabled: true, key: 'Control+Alt+S' },
    translate: { enabled: true, key: 'Alt+S' },
    color: { enabled: true, key: 'Control+Alt+C' },
    selection: { enabled: true, key: 'Control+Alt+T' },
    endpoint: 'https://api.openai.com/v1',
    model: '',
    secret: '',
  }
  let cfg = structuredClone(defaults),
    notice = ''
  try {
    cfg = { ...cfg, ...JSON.parse(readFileSync(file, 'utf8')) }
  } catch (e) {
    if (e.code !== 'ENOENT') notice = '配置损坏，请重新设置'
  }
  const states = new Map(),
    bound = new Map()
  let tray,
    home,
    overlay,
    capturing = false
  const readerUrl = app.isPackaged
    ? new URL('./prompt-actions.mjs', import.meta.url)
    : new URL('../../examples/component-host/prompt-actions.mjs', import.meta.url)
  const reader = await import(readerUrl.href)
    .then(({ createPromptActionReader }) =>
      createPromptActionReader({
        profile: shared,
        installed: () => {
          if (!app.isPackaged) return existsSync(path.resolve(here, '../prompts/component.json'))
          return import('./installed-products.mjs').then(async (m) =>
            Boolean(await m.registeredProduct('prompts')),
          )
        },
      }),
    )
    .catch(() => undefined)
  function persist(next) {
    writeFileSync(`${file}.tmp`, JSON.stringify(next))
    renameSync(`${file}.tmp`, file)
    cfg = next
    if (tray) updateTrayMenu()
  }
  function material() {
    try {
      const m = JSON.parse(readFileSync(path.join(shared, 'workbench-material.json'), 'utf8'))
      if (
        ['transparency', 'brightness', 'frost'].every(
          (k) => Number.isInteger(m[k]) && m[k] >= 0 && m[k] <= 100,
        )
      )
        return m
    } catch {}
    return { transparency: 100, brightness: 100, frost: 100 }
  }
  const themedWindows = new Set(['home', 'result', 'color-result'])
  const materialWatcher = watch(shared, { persistent: false }, (_, name) => {
    if (name !== 'workbench-material.json') return
    const current = material()
    for (const { kind, win } of states.values())
      if (themedWindows.has(kind) && !win.isDestroyed())
        win.webContents.send('toolkit:material', current)
  })
  materialWatcher.on('error', () => materialWatcher.close())
  app.once('will-quit', () => materialWatcher.close())
  let hosted = process.argv.includes('--fitbay-hosted')
  const backgroundTest = process.env.WORKBENCH_TEST_BACKGROUND === '1'
  const hiddenSurfaces = backgroundTest && process.env.WORKBENCH_TEST_HIDDEN_SURFACES === '1'
  function show(data, options = {}, fromHost = hosted) {
    const win = new BrowserWindow({
      icon: path.join(here, 'toolkit.ico'),
      width: 550,
      height: 610,
      minWidth: 280,
      show: false,
      backgroundColor: '#202a35',
      ...(Number(release().split('.')[2]) >= 22621 &&
      ['home', 'result', 'message', 'color-result'].includes(data.kind)
        ? { backgroundColor: '#00000000', backgroundMaterial: 'acrylic' }
        : {}),
      autoHideMenuBar: true,
      ...options,
      skipTaskbar: fromHost || Boolean(options.skipTaskbar),
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        preload: path.join(here, 'preload.cjs'),
      },
    })
    if (process.platform === 'win32')
      win.setAppDetails({
        appId: 'io.github.m1597.fitbay.toolkit',
        relaunchIcon: path.join(here, 'toolkit.ico'),
        relaunchDisplayName: '工具集',
        relaunchCommand: app.isPackaged
          ? '"' + process.execPath + '"'
          : '"' + process.execPath + '" "' + here + '"',
      })
    const id = win.webContents.id
    states.set(id, {
      ...data,
      win,
      hosted: fromHost,
      abort: new AbortController(),
      history: [],
    })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    win.once('closed', () => {
      if (win === home) standaloneHome = false
      states.get(id)?.abort.abort()
      states.delete(id)
    })
    win.on('page-title-updated', (e) => e.preventDefault())
    const reveal = () => {
      if (hiddenSurfaces && ['pin', 'screen'].includes(data.kind)) return
      if (backgroundTest) {
        win.setPosition(-30000, -30000)
        win.showInactive()
        return
      }
      win.show()
      if (options.alwaysOnTop) win.setAlwaysOnTop(true, 'screen-saver')
    }
    if (data.kind === 'screen') {
      const deadline = setTimeout(() => {
        if (!win.isDestroyed()) {
          win.destroy()
          fail(Error('截图加载超时，请重试'))
        }
      }, 15000)
      win.once('closed', () => clearTimeout(deadline))
      states.get(id).reveal = () => {
        clearTimeout(deadline)
        reveal()
      }
      win.webContents.once('render-process-gone', () => {
        if (!win.isDestroyed()) win.destroy()
      })
    } else if (data.kind === 'pin') states.get(id).reveal = reveal
    else win.once('ready-to-show', reveal)
    void win.loadFile(path.join(here, 'index.html')).catch(() => {
      if (!win.isDestroyed()) win.destroy()
    })
    return win
  }
  let targetTool, targetRoute
  const connections = toolkitConnections({
    shared,
    packaged: app.isPackaged,
    safeStorage,
    legacy: cfg,
    onMigrated: () => {
      const next = { ...cfg }
      delete next.secret
      delete next.model
      delete next.endpoint
      persist(next)
    },
    onChange: () => {
      for (const state of states.values())
        if (['home', 'result'].includes(state.kind) && !state.win.isDestroyed())
          state.win.webContents.send('toolkit:connections-changed')
    },
  })
  if (process.argv.includes('--toolkit-migrate-connections')) {
    try {
      await connections.snapshot()
    } finally {
      connections.close()
      app.quit()
    }
    return
  }
  function settings(route, fromHost = hosted) {
    targetRoute = route === 'translation' || route === 'vision' ? route : undefined
    if (!home || home.isDestroyed())
      home = show({ kind: 'home' }, { title: 'FitBay 工具集' }, fromHost)
    else {
      const state = states.get(home.webContents.id)
      state.hosted = fromHost
      home.setSkipTaskbar(fromHost)
      if (!backgroundTest) {
        home.restore()
        home.show()
        home.focus()
      }
      if (targetRoute) home.webContents.send('toolkit:settings-target', targetRoute)
    }
  }
  function fail(e, fromHost = hosted) {
    show({ kind: 'message', text: e.message }, { height: 230 }, fromHost)
  }
  async function capture(intent, fromHost = hosted, displayId) {
    if (overlay && !overlay.isDestroyed()) {
      overlay.focus()
      return
    }
    if (capturing) return
    capturing = true
    try {
      const d =
        screen.getAllDisplays().find((display) => display.id === displayId) ??
        screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      const size = {
        width: Math.round(d.size.width * d.scaleFactor),
        height: Math.round(d.size.height * d.scaleFactor),
      }
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size })
      const source =
        sources.find((s) => s.display_id === String(d.id)) ||
        (sources.length === 1 ? sources[0] : null)
      if (!source || source.thumbnail.isEmpty()) throw Error('无法读取当前显示器')
      overlay = show(
        { kind: 'screen', full: source.thumbnail, intent, displayId: d.id },
        {
          ...d.bounds,
          minWidth: 1,
          frame: false,
          thickFrame: false,
          resizable: false,
          skipTaskbar: true,
          alwaysOnTop: true,
        },
        fromHost,
      )
      const currentOverlay = overlay
      currentOverlay.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown' && input.key === 'Escape') {
          event.preventDefault()
          currentOverlay.close()
        }
      })
      currentOverlay.once('close', () => {
        if (overlay === currentOverlay) overlay = undefined
      })
      overlay.setBounds(
        backgroundTest && !hiddenSurfaces ? { ...d.bounds, x: -30000, y: -30000 } : d.bounds,
      )
    } finally {
      capturing = false
    }
  }
  function displayFor(s) {
    return (
      screen.getAllDisplays().find((display) => display.id === s.displayId) ??
      screen.getDisplayMatching(s.win.getBounds())
    )
  }
  function showResult(data, display, fromHost) {
    const target =
      screen.getAllDisplays().find((d) => d.id === display.id) ??
      screen.getDisplayMatching(display.bounds)
    return show(
      { kind: 'result', ...data, displayId: target.id },
      resultBounds(target.workArea),
      fromHost,
    )
  }
  const user32 = koffi.load('user32.dll')
  const windowRect = user32.func('int __stdcall GetWindowRect(intptr_t hwnd, void *rect)')
  const foreground = user32.func('intptr_t __stdcall GetForegroundWindow()')
  async function select(fromHost = hosted) {
    const hwnd = foreground()
    const rect = Buffer.alloc(16)
    const hasRect = hwnd && windowRect(hwnd, rect)
    const [left, top, right, bottom] = [0, 4, 8, 12].map((i) => rect.readInt32LE(i))
    const display =
      hasRect && right > left && bottom > top
        ? screen.getDisplayMatching(
            screen.screenToDipRect(null, {
              x: left,
              y: top,
              width: right - left,
              height: bottom - top,
            }),
          )
        : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const text = await readSelectionOrOcr(undefined, String(hwnd))
    showResult({ text }, display, fromHost)
  }
  function bind(id, key) {
    if (
      typeof key !== 'string' ||
      key.length > 80 ||
      (!key.includes('+') &&
        !/^(F(?:[1-9]|1[0-9]|2[0-4])|MediaPlayPause|MediaNextTrack|MediaPreviousTrack)$/.test(key))
    )
      throw Error('请填写组合键，例如 Control+Alt+S')
    const old = bound.get(id)
    if (old === key) return
    if (
      [...bound.values()].some((k) => k.toLowerCase() === key.toLowerCase()) ||
      !globalShortcut.register(key, () => {
        const fromHost = hosted
        void (
          id === 'selection'
            ? select(fromHost)
            : capture(id === 'capture' ? undefined : id, fromHost)
        ).catch((error) => fail(error, fromHost))
      })
    )
      throw Error('快捷键已占用，请换一个组合键')
    if (old) globalShortcut.unregister(old)
    bound.set(id, key)
  }
  for (const id of ['capture', 'selection', 'color', 'translate'])
    if (cfg[id]?.enabled)
      try {
        bind(id, cfg[id].key)
      } catch (e) {
        notice += `${id === 'capture' ? '截图' : id === 'color' ? '取色' : id === 'translate' ? '截图翻译' : '划词'}快捷键：${e.message} `
      }
  function handle(name, kinds, fn) {
    ipcMain.handle(`toolkit:${name}`, (e, v) => {
      const s = states.get(e.sender.id)
      if (!s || e.senderFrame !== e.sender.mainFrame || !kinds.includes(s.kind))
        throw Error('无效窗口')
      return fn(s, v)
    })
  }
  const kinds = ['color-result', 'home', 'screen', 'result', 'pin', 'message']
  function shortcutSettings() {
    return {
      color: cfg.color,
      capture: cfg.capture,
      translate: cfg.translate,
      selection: { ...cfg.selection, activeKey: bound.get('selection') || '' },
      notice,
    }
  }
  handle('state', kinds, (s) => ({
    kind: s.kind,
    intent: s.intent,
    material: themedWindows.has(s.kind) ? material() : undefined,
    hex: s.hex,
    text: s.text,
    image: (s.full || s.image)?.toDataURL(),
    settings:
      s.kind === 'home'
        ? {
            material: material(),
            ...shortcutSettings(),
            catalog,
          }
        : undefined,
  }))
  handle('screenReady', ['screen'], (s) => {
    s.reveal?.()
    s.reveal = null
  })
  handle('dismiss', kinds, (s) => s.win.close())
  handle('settingsTarget', ['home'], () => targetRoute)
  handle('connections', ['home', 'result'], () => connections.snapshot())
  installLocalFiles(handle)
  handle('batchInputs', ['home'], async (s, request) => {
    if (!request || request.id !== targetTool?.id || request.tool !== targetTool.tool)
      throw Error('批次已过期')
    const { id, tool } = targetTool
    targetTool = undefined
    const requestFile = path.join(shared, 'toolkit', 'incoming', id + '.json')
    try {
      const stat = await lstat(requestFile)
      if (!stat.isFile() || stat.size > 1000000) throw Error('批次无效')
      const data = JSON.parse(await readFile(requestFile, 'utf8'))
      if (
        data.version !== 1 ||
        data.tool !== tool ||
        !Array.isArray(data.files) ||
        !data.files.length ||
        data.files.length > 100 ||
        !data.files.every((f) => typeof f === 'string' && path.isAbsolute(f))
      )
        throw Error('批次无效')
      if (
        tool === 'resize' &&
        !data.files.every((f) => /\.(png|jpe?g|bmp|webp|gif|avif)$/i.test(f))
      )
        throw Error('请选择图片')
      return await setToolInputs(s, data.files, tool === 'rename')
    } finally {
      await unlink(requestFile).catch(() => {})
    }
  })
  handle('toolTarget', ['home'], () => targetTool)
  handle('capture', ['home'], (s, intent) => {
    const tool = ['color', 'translate'].includes(intent) ? intent : 'capture'
    if (!cfg[tool].enabled) throw Error('请先启用该工具')
    return capture(tool === 'capture' ? undefined : tool, s.hosted)
  })
  function setShortcut(v) {
    if (v?.id === 'defaults') {
      const before = new Map(bound),
        next = { ...cfg }
      for (const key of bound.values()) globalShortcut.unregister(key)
      bound.clear()
      try {
        for (const id of ['capture', 'selection', 'color', 'translate']) {
          next[id] = { ...cfg[id], key: defaults[id].key }
          if (next[id].enabled) bind(id, next[id].key)
        }
        persist(next)
      } catch (error) {
        for (const key of bound.values()) globalShortcut.unregister(key)
        bound.clear()
        for (const [id, key] of before) bind(id, key)
        throw error
      }
      return
    }
    if (
      !['capture', 'selection', 'color', 'translate'].includes(v?.id) ||
      typeof v.enabled !== 'boolean' ||
      typeof v.key !== 'string'
    )
      throw Error('无效设置')
    if (v.field === 'enabled') v = { ...v, key: cfg[v.id].key }
    if (v.field === 'key') v = { ...v, enabled: cfg[v.id].enabled }
    if (
      !v.key ||
      Object.keys(defaults).some(
        (id) =>
          id !== v.id &&
          cfg[id]?.key?.replace(/^Ctrl\+/i, 'Control+').toLowerCase() ===
            v.key.replace(/^Ctrl\+/i, 'Control+').toLowerCase(),
      )
    )
      throw Error('快捷键已占用或为空')
    const previous = bound.get(v.id)
    if (v.enabled) bind(v.id, v.key)
    else if (bound.has(v.id)) {
      globalShortcut.unregister(bound.get(v.id))
      bound.delete(v.id)
    }
    try {
      persist({ ...cfg, [v.id]: { enabled: v.enabled, key: v.key } })
    } catch (error) {
      if (previous) bind(v.id, previous)
      else if (bound.has(v.id)) {
        globalShortcut.unregister(bound.get(v.id))
        bound.delete(v.id)
      }
      throw error
    }
  }
  handle('enable', ['home'], (_, v) => setShortcut(v))
  handle('configure', ['home', 'result'], (_s, value) => connections.save(value))
  handle('crop', ['screen'], (s, v) => {
    if (
      !Array.isArray(v) ||
      v.length !== 4 ||
      v.some((x) => !Number.isFinite(x) || x < 0 || x > 1) ||
      v[2] <= v[0] ||
      v[3] <= v[1]
    )
      throw Error('请重新框选')
    const { width, height } = s.full.getSize(),
      x = Math.floor(v[0] * width),
      y = Math.floor(v[1] * height)
    s.region = v
    s.image = s.full.crop({
      x,
      y,
      width: Math.ceil(v[2] * width) - x,
      height: Math.ceil(v[3] * height) - y,
    })
  })
  function selected(s) {
    if (!s.image) throw Error('请先框选')
    return s.image
  }
  handle('selectionImage', ['screen'], (s) => selected(s).toDataURL())
  handle('applyAnnotation', ['screen'], (s, data) => {
    if (
      typeof data !== 'string' ||
      data.length > 160000000 ||
      !data.startsWith('data:image/png;base64,')
    )
      throw Error('标注图像无效')
    const original = selected(s).getSize(),
      image = nativeImage.createFromDataURL(data),
      size = image.getSize()
    if (image.isEmpty() || size.width !== original.width || size.height !== original.height)
      throw Error('标注尺寸不匹配')
    s.image = image
  })
  handle('extractText', ['screen'], async (s) => {
    const text = await readSelectionOrOcr(selected(s).toPNG(), undefined, s.abort.signal)
    if (!s.win.isDestroyed() && !s.abort.signal.aborted) {
      showResult({ text }, displayFor(s), s.hosted)
      s.win.close()
    }
  })
  handle('copyMeasuredColor', ['screen'], (s, hex) => {
    if (!/^#[0-9A-F]{6}$/.test(hex)) throw Error('请先取色')
    clipboard.writeText(hex)
    const display = displayFor(s)
    show(
      { kind: 'color-result', hex, displayId: display.id },
      { title: 'FitBay 取色结果', ...resultBounds(display.workArea, 365, 245) },
      s.hosted,
    )
    s.win.close()
  })
  handle('copyColorResult', ['color-result'], (s, format) => {
    const channels = s.hex
      .slice(1)
      .match(/../g)
      .map((c) => parseInt(c, 16))
    return clipboard.writeText(format === 'rgb' ? 'rgb(' + channels.join(', ') + ')' : s.hex)
  })
  handle('repick', ['color-result'], async (s) => {
    s.win.hide()
    try {
      await capture('color', s.hosted, s.displayId)
      s.win.close()
    } catch (error) {
      if (!s.win.isDestroyed()) s.win.show()
      throw error
    }
  })
  handle('copy', ['screen'], async (s) => {
    const png = new Blob([selected(s).toPNG()], { type: 'image/png' })
    await clipboard.write([new ClipboardItem({ 'image/png': png })])
    s.win.close()
  })
  handle('save', ['screen'], async (s) => {
    const image = selected(s)
    s.win.setAlwaysOnTop(false)
    let dest
    try {
      dest = await dialog.showSaveDialog(s.win, {
        defaultPath: '截图.png',
        filters: [{ name: 'PNG', extensions: ['png'] }],
      })
    } finally {
      if (!s.win.isDestroyed()) s.win.setAlwaysOnTop(true, 'screen-saver')
    }
    if (!dest.canceled) {
      await writeFile(dest.filePath, image.toPNG())
      s.win.close()
    }
  })
  handle('pinFailed', ['pin'], (s) => s.win.destroy())
  handle('pinReady', ['pin'], (s) => s.finishPaint?.())
  handle('pinMove', ['pin'], (s, delta) => {
    if (
      !Array.isArray(delta) ||
      delta.length !== 2 ||
      !delta.every((n) => Number.isInteger(n) && Math.abs(n) < 32768)
    )
      throw Error('无效移动')
    const [x, y] = s.win.getPosition()
    s.win.setPosition(x + delta[0], y + delta[1])
  })
  handle('pinZoom', ['pin'], (s, step) => {
    if (step !== 1 && step !== -1) return
    const bounds = s.win.getBounds()
    const ratio = Math.min(8, Math.max(0.1, (s.zoom || 1) * Math.pow(1.2, step)))
    const width = Math.max(1, Math.round(s.originalSize.width * ratio)),
      height = Math.max(1, Math.round(s.originalSize.height * ratio))
    s.win.setBounds({
      x: bounds.x + Math.round((bounds.width - width) / 2),
      y: bounds.y + Math.round((bounds.height - height) / 2),
      width,
      height,
    })
    s.zoom = ratio
  })
  handle('pin', ['screen'], async (s) => {
    if (s.pinning) return
    const image = selected(s),
      display = displayFor(s)
    const [left, top, right, bottom] = s.region
    const { x, y, width, height } = display.bounds
    const size = {
      width: Math.max(1, Math.round(right * width) - Math.round(left * width)),
      height: Math.max(1, Math.round(bottom * height) - Math.round(top * height)),
    }
    s.pinning = true
    try {
      const pin = show(
        { kind: 'pin', image, originalSize: size },
        {
          title: 'FitBay 贴图',
          x: x + Math.round(left * width),
          y: y + Math.round(top * height),
          ...size,
          frame: false,
          thickFrame: false,
          hasShadow: false,
          roundedCorners: false,
          resizable: false,
          useContentSize: true,
          minWidth: 1,
          minHeight: 1,
          alwaysOnTop: true,
          skipTaskbar: true,
        },
        s.hosted,
      )
      pin.setBounds({ x: x + Math.round(left * width), y: y + Math.round(top * height), ...size })
      const contents = pin.webContents,
        state = states.get(contents.id)
      await new Promise((resolve, reject) => {
        const cancel = () => {
          if (!pin.isDestroyed()) pin.destroy()
        }
        const deadline = setTimeout(cancel, 12000)
        const failed = () => {
          cleanup()
          reject(Error('贴图未能显示，请重试'))
        }
        const cleanup = () => {
          clearTimeout(deadline)
          s.abort.signal.removeEventListener('abort', cancel)
          pin.removeListener('closed', failed)
          contents.removeListener('render-process-gone', cancel)
          state.finishPaint = undefined
        }
        pin.once('closed', failed)
        contents.once('render-process-gone', cancel)
        s.abort.signal.addEventListener('abort', cancel, { once: true })
        state.finishPaint = () => {
          cleanup()
          state.reveal()
          resolve()
        }
      })
      if (!s.win.isDestroyed()) s.win.close()
    } finally {
      s.pinning = false
    }
  })
  handle('top', ['result'], (s) => {
    s.win.setAlwaysOnTop(!s.win.isAlwaysOnTop(), 'screen-saver')
    return s.win.isAlwaysOnTop()
  })
  handle('copyAnswer', ['result'], (s) => {
    const last = s.history.at(-1)
    if (last?.role !== 'assistant') throw Error('没有可复制的结果')
    return clipboard.writeText(last.content)
  })
  handle('actions', ['screen', 'result'], async (s) => {
    const result = await reader?.listActions()
    if (result && !result.ok && result.error !== 'COMPONENT_ABSENT') throw Error(result.error)
    return (result?.actions || []).filter(
      (a) => s.kind === 'screen' || s.image || a.inputType === 'text',
    )
  })
  async function ask(s, v) {
    if (s.busy) throw Error('请等待当前回答')
    s.busy = true
    try {
      let prompt = v?.question?.trim(),
        mode = v?.mode
      if (!['translate', 'explain', 'question', 'follow', 'custom'].includes(mode))
        throw Error('无效动作')
      let image = !!s.image && mode !== 'translate'
      if (mode === 'custom') {
        const r = await reader?.resolveAction(v.id)
        if (!r?.ok) throw Error(r?.error || '提示词仓库未安装')
        prompt = r.action.template
        image = r.action.inputType === 'image'
        if (image && !s.image) throw Error('动作需要图片')
      }
      if (mode === 'translate') prompt = '请将选区原文翻译为简体中文。'
      if (mode === 'explain') prompt = '请用简体中文解释选区内容。'
      if (!prompt || prompt.length > 120000) throw Error('请输入问题或缩短提示词')
      const follow = mode === 'follow' && s.history.length
      const route = follow ? s.route : image ? 'vision' : 'translation'
      const service = await connections.resolve(route)
      if (mode === 'translate' && s.image) {
        let blocks
        try {
          blocks = await translateImage(selected(s), service, s.abort.signal)
        } catch (error) {
          if (/HTTP (401|403)\b/.test(error.message))
            throw Error('TOOLKIT_CONFIG_translation ' + error.message)
          throw error
        }
        const original = blocks.map((b) => b.text).join('\n')
        const translated = blocks.map((b) => b.zh).join('\n')
        s.history = [
          { role: 'user', content: original },
          { role: 'assistant', content: translated },
        ]
        s.route = 'translation'
        return { blocks }
      }
      const history = follow ? s.history : []
      let content = prompt
      if (!follow) {
        if (image)
          content = [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: selected(s).toDataURL() } },
          ]
        else {
          s.text ??= await readSelectionOrOcr(selected(s).toPNG(), undefined, s.abort.signal)
          content = `${prompt}\n\n${s.text}`
        }
      }
      const messages = [...history, { role: 'user', content }]
      const answer = await complete(service, service.key, messages, s.abort.signal).catch(
        (error) => {
          if (/HTTP (401|403)\b/.test(error.message))
            throw Error('TOOLKIT_CONFIG_' + route + ' ' + error.message)
          throw error
        },
      )
      s.route = route
      s.history = [...messages, { role: 'assistant', content: answer }]
      return answer
    } finally {
      s.busy = false
    }
  }
  handle('ask', ['screen', 'result'], async (s, v) => {
    if (s.kind === 'screen') {
      showResult({ image: selected(s), initial: v }, displayFor(s), s.hosted)
      s.win.close()
      return
    }
    return ask(s, v)
  })
  handle('initial', ['result'], (s) => {
    const value = s.initial
    s.initial = null
    return value
  })
  let ownerTimer
  let standaloneHome = false
  function watchOwner(argv) {
    clearInterval(ownerTimer)
    if (!hosted) return
    const arg = argv.find((value) => /^--fitbay-owner-pid=[1-9]\d*$/.test(value))
    if (!arg) return
    const pid = Number(arg.split('=')[1])
    ownerTimer = setInterval(() => {
      try {
        process.kill(pid, 0)
      } catch (error) {
        if (error.code !== 'ESRCH') return
        clearInterval(ownerTimer)
        if (!standaloneHome || !home || home.isDestroyed()) {
          app.quit()
          return
        }
        hosted = false
        states.get(home.webContents.id).hosted = false
        home.setSkipTaskbar(false)
        syncTray()
      }
    }, 1000)
    ownerTimer.unref()
  }
  app.on('will-quit', () => clearInterval(ownerTimer))
  function openIntent(argv) {
    if (argv.includes('--toolkit-migrate-connections')) {
      void connections.snapshot().catch(() => {})
      return
    }
    hosted = argv.includes('--fitbay-hosted')
    watchOwner(argv)
    if (hosted) {
      for (const state of states.values()) {
        state.hosted = true
        state.win.setSkipTaskbar(true)
      }
    }
    syncTray()
    const shortcutJob = argv.find((v) => /^--toolkit-page=shortcuts-[0-9a-f-]{36}$/.test(v))
    if (shortcutJob) {
      const file = path.join(shared, 'toolkit', shortcutJob.slice(15))
      let result
      try {
        const v = JSON.parse(readFileSync(file, 'utf8'))
        if (v) setShortcut(v)
        result = {
          settings: shortcutSettings(),
        }
      } catch (e) {
        result = { error: e.code ? '快捷键请求不可用' : e.message }
      }
      writeFileSync(file + '.tmp', JSON.stringify(result))
      renameSync(file + '.tmp', file + '.reply')
      return
    }
    if (argv.includes('--toolkit-page=translate')) {
      if (!cfg.translate.enabled) {
        fail(Error('请先启用截图翻译'))
        return
      }
      void capture('translate', hosted).catch(fail)
      return
    }
    if (argv.includes('--toolkit-page=color')) {
      if (!cfg.color.enabled) {
        fail(Error('请先启用屏幕取色'))
        return
      }
      void capture('color', hosted).catch(fail)
      return
    }
    if (argv.includes('--toolkit-capture')) {
      if (!cfg.capture.enabled) {
        fail(Error('请先在工具集设置中启用截图'))
        return
      }
      const fromHost = hosted
      void capture(undefined, fromHost).catch((error) => fail(error, fromHost))
    } else {
      targetTool = argv.find((v) => v.startsWith('--toolkit-page='))?.slice(15)
      const batch = argv.find((v) => v.startsWith('--toolkit-batch='))?.slice(16)
      if (batch) {
        if (
          !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(batch) ||
          !['rename', 'resize'].includes(targetTool)
        ) {
          fail(Error('批次无效'))
          return
        }
        targetTool = { id: batch, tool: targetTool }
      }
      if (!hosted) standaloneHome = true
      settings()
      home.webContents.send('toolkit:tool-target', targetTool)
    }
  }
  app.on('will-quit', () => globalShortcut.unregisterAll())
  function syncTray() {
    if (hosted) {
      tray?.destroy()
      tray = undefined
      return
    }
    if (tray) return
    tray = new Tray(path.join(here, 'toolkit.ico'))
    tray.setToolTip('工具集')
    updateTrayMenu()
    tray.on('click', () => settings())
  }
  function updateTrayMenu() {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: '屏幕截图',
          enabled: cfg.capture.enabled,
          click: () => void capture().catch(fail),
        },
        {
          label: '屏幕取色',
          enabled: cfg.color.enabled,
          click: () => void capture('color').catch(fail),
        },
        { type: 'separator' },
        { label: '工具集设置', click: () => settings() },
        { label: '退出工具集', click: () => app.quit() },
      ]),
    )
  }
  app.on('before-quit', () => {
    connections.close()
    tray?.destroy()
  })
  app.on('window-all-closed', () => {})
  dispatchIntent = openIntent
  openIntent(process.argv)
  for (const argv of pendingIntents.splice(0)) openIntent(argv)
}
