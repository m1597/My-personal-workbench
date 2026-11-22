import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, unlink } from 'node:fs/promises'
import { atomicWrite } from './prompt-actions.mjs'
import { toolkitLauncher } from './toolkit-launcher.mjs'
import { watch } from 'node:fs'
import { openConnections, apiUses } from './api-connections.mjs'
import { BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, safeStorage } from 'electron'
import { promptLibrary } from './prompt-library.mjs'

function windowsTarget() {
  const user = createRequire(import.meta.url)('koffi').load('user32.dll')
  const foreground = user.func('intptr_t __stdcall GetForegroundWindow()')
  const restore = user.func('int __stdcall SetForegroundWindow(intptr_t)')
  const owner = user.func('uint32_t __stdcall GetWindowThreadProcessId(intptr_t,_Out_ uint32_t *)')
  const send = user.func('uint32_t __stdcall SendInput(uint32_t,void *,int)')
  return {
    capture() {
      const hwnd = foreground(),
        pid = [0]
      owner(hwnd, pid)
      return { hwnd, pid: pid[0] }
    },
    async paste(target) {
      const pid = [0]
      if (!target?.hwnd || !owner(target.hwnd, pid) || pid[0] !== target.pid) return false
      restore(target.hwnd)
      await delay(90)
      if (foreground() !== target.hwnd) return false
      // x64 Windows INPUT includes an aligned 32-byte union at offset 8.
      const keys = [
        [17, 0],
        [86, 0],
        [86, 2],
        [17, 2],
      ]
      const events = Buffer.alloc(40 * keys.length)
      keys.forEach(([key, flags], i) => {
        events.writeUInt32LE(1, i * 40)
        events.writeUInt16LE(key, i * 40 + 8)
        events.writeUInt32LE(flags, i * 40 + 12)
      })
      return send(keys.length, events, 40) === keys.length
    },
  }
}
export async function promptRuntime({ profile, here, root, isEditor, options, secure, show }) {
  let editor,
    panel,
    target,
    native,
    active = '',
    registrationError = '',
    generation = 0
  const library = await promptLibrary(profile, () => {
    if (editor && !editor.isDestroyed()) editor.send('prompt:changed')
  })
  async function summon() {
    if (panel?.isVisible()) {
      panel.focus()
      return
    }
    target = native?.capture()
    const call = ++generation
    if (!panel) {
      panel = new BrowserWindow({
        ...options(560, 450),
        title: '搜索提示词',
        autoHideMenuBar: true,
        backgroundColor: '#202227',
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          preload: path.join(here, 'prompt-preload.cjs'),
        },
      })
      secure(panel.webContents)
      panel.on('closed', () => {
        panel = undefined
      })
      await panel.loadFile(path.join(root, 'index.html'), { query: { palette: '1' } })
    }
    if (call !== generation || !panel) return
    show(panel)
    panel.webContents.send('prompt:focus')
  }
  function register(value) {
    if (
      typeof value !== 'string' ||
      !/^(?:(?:Control|Alt|Shift|Super|CommandOrControl)\+){1,3}(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space)$/i.test(
        value,
      )
    )
      throw Error('请输入带修饰键的快捷键，例如 Control+Alt+P')
    if (active === value) return
    if (!globalShortcut.register(value, () => void summon().catch(console.error)))
      throw Error('快捷键已被占用，请换一个组合')
    if (active) globalShortcut.unregister(active)
    active = value
    registrationError = ''
  }
  function start() {
    if (process.platform === 'win32' && !native) {
      try {
        native = windowsTarget()
      } catch {
        /* Clipboard fallback remains available. */
      }
    }
    try {
      register(library.state().shortcut)
    } catch (e) {
      registrationError = e.message
    }
  }
  const handlers = []
  function handle(name, scope, fn) {
    const channel = 'prompt:' + name
    handlers.push(channel)
    ipcMain.handle(channel, (e, ...args) => {
      const palette =
        panel && e.sender === panel.webContents && e.senderFrame === panel.webContents.mainFrame
      if (!(scope === 'panel' ? palette : isEditor(e))) throw Error('DENIED')
      if (!palette) editor = e.sender
      return fn(...args)
    })
  }
  let connections, connectionWatcher, notifyTimer
  let disposed = false
  function notifyConnectionChange() {
    clearTimeout(notifyTimer)
    notifyTimer = setTimeout(() => {
      if (editor && !editor.isDestroyed()) editor.send('prompt:connections-changed')
    }, 35)
  }
  function settingsStore() {
    connections ??= openConnections(profile, safeStorage)
    if (!connectionWatcher) {
      connectionWatcher = watch(profile, { persistent: false }, (_, file) => {
        if (!file || file.startsWith('api-connections.sqlite')) notifyConnectionChange()
      })
      connectionWatcher.on('error', () => {
        connectionWatcher?.close()
        connectionWatcher = undefined
        notifyConnectionChange()
      })
    }
    return connections
  }
  handle('connections', 'editor', () => {
    try {
      const store = settingsStore()
      const own = store.read('prompts.model')
      const text = store.read('toolkit.translation'),
        image = store.read('toolkit.vision')
      const bindings = Object.entries(apiUses).map(([use, label]) => ({
        id: store.read(use)?.id,
        name: [label.component, label.purpose].join(' · '),
      }))
      const owners = (id) => bindings.filter((b) => b.id === id).map((b) => b.name)
      const reused = !!own && owners(own.id).length > 1
      return {
        own,
        reused,
        text,
        image,
        choices: store
          .choices()
          .filter((c) => c.id !== own?.id || reused)
          .map((c) => ({ ...c, owners: owners(c.id).join(' / ') })),
      }
    } catch {
      throw Error('连接设置暂不可用')
    }
  })
  handle('save-connection', 'editor', (value) => {
    try {
      const store = settingsStore()
      if (value?.mode === 'reuse' && typeof value.connectionId === 'string') {
        store.write('prompts.model', { reuse: value.connectionId })
      } else if (
        value?.mode === 'own' &&
        typeof value.endpoint === 'string' &&
        typeof value.model === 'string' &&
        (value.key === undefined || typeof value.key === 'string') &&
        typeof value.protocol === 'string'
      ) {
        store.write('prompts.model', {
          separate: true,
          endpoint: value.endpoint,
          model: value.model,
          key: value.key,
          protocol: value.protocol,
        })
      } else throw Error()
      notifyConnectionChange()
    } catch {
      throw Error('无法保存连接设置')
    }
  })
  handle('state', 'editor', () => ({
    ...library.state(),
    registrationError: registrationError || library.state().preferenceError,
  }))
  handle('organize', 'editor', async (root, name) => {
    const connection = settingsStore().resolve('prompts.model')
    if (!connection) throw Error('请先配置 API 与模型')
    const source = await library.read(root, name)
    const { complete } = await import('./prompt-model.mjs')
    const organized = await complete(
      connection,
      connection.key,
      [
        {
          role: 'user',
          content:
            '请将以下提示词整理为清晰的 Markdown，保留模板变量和相对引用，直接返回整理后的内容。\n' +
            source.text,
        },
      ],
      new AbortController().signal,
    )
    // The confirmed copy lives at the catalogue root. Keep local Markdown links
    // relative to their original assets even when the source was nested.
    const base = path.dirname(name).replaceAll('\\', '/')
    if (base === '.') return organized
    let fence = ''
    const relocate = (target) => {
      const angled = target.startsWith('<')
      const value = angled ? target.slice(1, -1) : target
      if (!value || /^(?:[a-z][a-z0-9+.-]*:|[/#?])/i.test(value)) return target
      const next = path.posix.join(base, value)
      return angled || /\s/.test(next) ? '<' + next + '>' : next
    }
    return organized
      .split('\n')
      .map((line) => {
        const marker = line.match(/^\s*(`{3,}|~{3,})/)
        if (marker) {
          if (!fence) fence = marker[1]
          else if (marker[1].startsWith(fence)) fence = ''
          return line
        }
        if (fence) return line
        return line.replace(
          /(\]\(\s*|^\s*\[[^\]]+\]:\s*)(<[^>]*>|[^\s)]+)/g,
          (_, prefix, target) => prefix + relocate(target),
        )
      })
      .join('\n')
  })
  handle('saveOrganized', 'editor', (root, text) => library.saveOrganized(root, text))
  handle('catalogue', 'editor', (query) => library.catalogue(query))
  handle('choose', 'editor', async (remember) => {
    if (typeof remember !== 'boolean') throw Error('DENIED')
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!result.canceled) await library.select(result.filePaths[0], remember)
  })
  handle('default', 'editor', () => library.select(library.state().defaultRoot, false))
  handle('shortcut', 'editor', async (value) => {
    const old = active
    register(value)
    try {
      await library.shortcut(value)
    } catch (e) {
      globalShortcut.unregister(value)
      active = ''
      if (old) register(old)
      throw e
    }
  })
  handle('batch', 'editor', async (tool, items) => {
    if (!['rename', 'resize'].includes(tool)) throw Error('未知批量工具')
    const files = await library.selectedPaths(items)
    const launch = await toolkitLauncher(app.isPackaged, profile)
    if (!launch) throw Error('请先安装工具集')
    const id = randomUUID(),
      folder = path.join(profile, 'toolkit', 'incoming'),
      request = path.join(folder, id + '.json')
    await mkdir(folder, { recursive: true })
    await atomicWrite(request, JSON.stringify({ version: 1, tool, files }))
    try {
      await launch(false, tool, id)
    } catch {
      await unlink(request).catch(() => {})
      throw Error('无法启动工具集')
    }
  })
  handle('choosePalette', 'editor', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!result.canceled) await library.paletteFolder(result.filePaths[0])
  })
  handle('copy', 'editor', (text) => {
    if (typeof text !== 'string' || Buffer.byteLength(text) > 4 * 1024 * 1024)
      throw Error('文本过大')
    clipboard.writeText(text)
  })
  for (const method of [
    'identity',
    'locate',
    'browse',
    'image',
    'companion',
    'favorite',
    'activate',
    'files',
    'read',
    'save',
    'pin',
  ])
    handle(method, 'editor', library[method])
  handle('search', 'panel', library.search)
  handle('dismiss', 'panel', () => panel.hide())
  handle('use', 'panel', async (folder, name, insert) => {
    const text = await library.selection(folder, name)
    clipboard.writeText(text)
    if (!insert) return '已复制'
    const previous = target
    panel.hide()
    if (await native?.paste(previous)) return '已发送粘贴，提示词也已复制'
    if (panel) show(panel)
    return '无法恢复输入窗口，提示词已复制'
  })
  return {
    start,
    stop() {
      generation++
      panel?.destroy()
      if (active) globalShortcut.unregister(active)
      active = ''
    },
    dispose() {
      if (disposed) return
      disposed = true
      this.stop()
      clearTimeout(notifyTimer)
      connectionWatcher?.close()
      connections?.close()
      library.close()
      for (const name of handlers) ipcMain.removeHandler(name)
    },
  }
}
