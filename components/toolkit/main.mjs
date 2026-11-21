import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  clipboard,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  nativeTheme,
  safeStorage,
  screen,
} from 'electron'
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { release } from 'node:os'
import koffi from 'koffi'
import { installLocalFiles } from './local-files.mjs'
import { nativeImage } from 'electron'
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
if (!app.requestSingleInstanceLock()) {
  app.exit(0)
} else void app.whenReady().then(startToolkit)
async function startToolkit() {
  nativeTheme.themeSource = 'dark'
  const file = path.join(app.getPath('userData'), 'settings.json')
  const defaults = {
    capture: { enabled: true, key: 'Control+Alt+S' },
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
  let home,
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
  }
  let hosted = process.argv.includes('--fitbay-hosted')
  const backgroundTest = process.env.WORKBENCH_TEST_BACKGROUND === '1'
  function show(data, options = {}, fromHost = hosted) {
    const win = new BrowserWindow({
      icon: path.join(here, 'toolkit.ico'),
      width: 550,
      height: 610,
      minWidth: 280,
      show: false,
      backgroundColor: '#202227',
      ...(Number(release().split('.')[2]) >= 22621 &&
      ['home', 'result', 'message'].includes(data.kind)
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
      states.get(id)?.abort.abort()
      states.delete(id)
    })
    win.on('page-title-updated', (e) => e.preventDefault())
    win.once('ready-to-show', () => {
      if (backgroundTest) {
        win.setPosition(-30000, -30000)
        win.showInactive()
        return
      }
      win.show()
      if (options.alwaysOnTop) win.setAlwaysOnTop(true, 'screen-saver')
    })
    void win.loadFile(path.join(here, 'index.html'))
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
      if (home && !home.isDestroyed()) home.webContents.send('toolkit:connections-changed')
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
  async function capture(intent, fromHost = hosted) {
    if (overlay && !overlay.isDestroyed()) {
      overlay.focus()
      return
    }
    if (capturing) return
    capturing = true
    try {
      const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
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
        { kind: 'screen', full: source.thumbnail, intent },
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
      currentOverlay.once('close', () => {
        if (overlay === currentOverlay) overlay = undefined
      })
      overlay.setBounds(backgroundTest ? { ...d.bounds, x: -30000, y: -30000 } : d.bounds)
    } finally {
      capturing = false
    }
  }
  const foreground = koffi.load('user32.dll').func('intptr_t __stdcall GetForegroundWindow()')
  async function select(fromHost = hosted) {
    const hwnd = foreground()
    const text = await readSelectionOrOcr(undefined, String(hwnd))
    show({ kind: 'result', text }, {}, fromHost)
  }
  function bind(id, key) {
    if (typeof key !== 'string' || key.length > 80 || !key.includes('+'))
      throw Error('请填写组合键，例如 Control+Alt+S')
    const old = bound.get(id)
    if (old === key) return
    if (
      [...bound.values()].some((k) => k.toLowerCase() === key.toLowerCase()) ||
      !globalShortcut.register(key, () => {
        const fromHost = hosted
        void (id === 'capture' ? capture(undefined, fromHost) : select(fromHost)).catch((error) =>
          fail(error, fromHost),
        )
      })
    )
      throw Error('快捷键已占用，请换一个组合键')
    if (old) globalShortcut.unregister(old)
    bound.set(id, key)
  }
  for (const id of ['capture', 'selection'])
    if (cfg[id]?.enabled)
      try {
        bind(id, cfg[id].key)
      } catch (e) {
        notice += `${id === 'capture' ? '截图' : '划词'}快捷键：${e.message} `
      }
  function handle(name, kinds, fn) {
    ipcMain.handle(`toolkit:${name}`, (e, v) => {
      const s = states.get(e.sender.id)
      if (!s || e.senderFrame !== e.sender.mainFrame || !kinds.includes(s.kind))
        throw Error('无效窗口')
      return fn(s, v)
    })
  }
  const kinds = ['home', 'screen', 'result', 'pin', 'message']
  handle('state', kinds, (s) => ({
    kind: s.kind,
    intent: s.intent,
    text: s.text,
    image: (s.full || s.image)?.toDataURL(),
    settings:
      s.kind === 'home'
        ? {
            capture: { ...cfg.capture },
            selection: { ...cfg.selection, enabled: bound.has('selection') },
            notice,
            catalog,
          }
        : undefined,
  }))
  handle('dismiss', kinds, (s) => s.win.close())
  handle('settings', ['result'], (s, route) => settings(route, s.hosted))
  handle('settingsTarget', ['home'], () => targetRoute)
  handle('connections', ['home'], () => connections.snapshot())
  installLocalFiles(handle)
  handle('toolTarget', ['home'], () => targetTool)
  handle('capture', ['home'], (s, intent) => {
    if (!cfg.capture.enabled) throw Error('请先启用截图')
    return capture(['annotate', 'measure'].includes(intent) ? intent : undefined, s.hosted)
  })
  handle('enable', ['home'], (_, v) => {
    if (
      !['capture', 'selection'].includes(v?.id) ||
      typeof v.enabled !== 'boolean' ||
      typeof v.key !== 'string'
    )
      throw Error('无效设置')
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
  })
  handle('configure', ['home'], (_s, value) => connections.save(value))
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
      show({ kind: 'result', text }, {}, s.hosted)
      s.win.close()
    }
  })
  handle('copyMeasuredColor', ['screen'], (s, hex) => {
    if (s.intent !== 'measure' || !/^#[0-9A-F]{6}$/.test(hex)) throw Error('请先取色')
    clipboard.writeText(hex)
  })
  handle('copy', ['screen'], (s) => {
    clipboard.writeImage(selected(s))
    s.win.close()
  })
  handle('save', ['screen'], async (s) => {
    const image = selected(s)
    const dest = await dialog.showSaveDialog(s.win, {
      defaultPath: '截图.png',
      filters: [{ name: 'PNG', extensions: ['png'] }],
    })
    if (!dest.canceled) {
      await writeFile(dest.filePath, image.toPNG())
      s.win.close()
    }
  })
  handle('pin', ['screen'], (s) => {
    const image = selected(s)
    const { width, height } = image.getSize()
    const display = screen.getDisplayMatching(s.win.getBounds())
    const area = display.workArea
    const scale = Math.min(1 / display.scaleFactor, area.width / width, area.height / height)
    show(
      { kind: 'pin', image },
      {
        title: 'FitBay 贴图',
        x: area.x + Math.max(0, Math.round((area.width - width * scale) / 2)),
        y: area.y + Math.max(0, Math.round((area.height - height * scale) / 2)),
        alwaysOnTop: true,
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
        minWidth: 1,
        useContentSize: true,
      },
      s.hosted,
    )
    s.win.close()
  })
  handle('top', ['result'], (s) => {
    s.win.setAlwaysOnTop(!s.win.isAlwaysOnTop(), 'screen-saver')
    return s.win.isAlwaysOnTop()
  })
  handle('copyAnswer', ['result'], (s) => {
    const last = s.history.at(-1)
    if (last?.role === 'assistant') clipboard.writeText(last.content)
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
      show({ kind: 'result', image: selected(s), initial: v }, {}, s.hosted)
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
  function openIntent(argv) {
    if (argv.includes('--toolkit-migrate-connections')) {
      void connections.snapshot().catch(() => {})
      return
    }
    hosted = argv.includes('--fitbay-hosted')
    if (argv.includes('--toolkit-capture')) {
      if (!cfg.capture.enabled) {
        fail(Error('请先在工具集设置中启用截图'))
        return
      }
      const fromHost = hosted
      void capture(undefined, fromHost).catch((error) => fail(error, fromHost))
    } else {
      targetTool = argv.find((v) => v.startsWith('--toolkit-page='))?.slice(15)
      settings()
      home.webContents.send('toolkit:tool-target', targetTool)
    }
  }
  app.on('second-instance', (_event, argv) => openIntent(argv))
  app.on('will-quit', () => globalShortcut.unregisterAll())
  const tray = new Tray(path.join(here, 'toolkit.ico'))
  tray.setToolTip('工具集')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '工具集设置', click: settings },
      { label: '退出工具集', click: () => app.quit() },
    ]),
  )
  tray.on('click', settings)
  app.on('before-quit', () => {
    connections.close()
    tray.destroy()
  })
  app.on('window-all-closed', () => {})
  openIntent(process.argv)
}
