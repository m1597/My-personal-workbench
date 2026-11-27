import { importInstalledMusicConnection } from './music-connection.mjs'
import { openConnections, apiUses } from './api-connections.mjs'
import {
  toolkitShortcutRequest,
  toolkitLauncher,
  installedToolkitRoot,
} from './toolkit-launcher.mjs'
import { componentInstallation, executeInstaller } from './component-installation.mjs'
import { startSelfUpdate } from './self-update.mjs'
import { installMusic } from './music-installer.mjs'
import { updateCatalog, saveInstaller, productUpdater, supportsUpdate } from './product-updates.mjs'
import { windowsAppIds } from './window-identity.mjs'
import { installedProducts, registeredProduct } from './installed-products.mjs'
import { builtinWindows, isBuiltin } from './builtin-windows.mjs'
import { release } from 'node:os'
import { shellExposed, snapTarget } from './native-dock.mjs'
import {
  app,
  dialog,
  shell as systemShell,
  BrowserWindow,
  BaseWindow,
  ipcMain,
  protocol,
  screen,
  nativeTheme,
  safeStorage,
  net,
  systemPreferences,
  Menu,
  Tray,
  nativeImage,
} from 'electron'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { access, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { componentView } from './component-view.mjs'

protocol.registerSchemesAsPrivileged([
  { scheme: 'fitbay-plugin', privileges: { standard: true, secure: true } },
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
    skipTaskbar: Boolean(shell),
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
  if (process.platform === 'win32' && shell && window !== shell) window.setSkipTaskbar(true)
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
let tray
let hasWorkbench = false
const backgroundFile = path.join(profile, 'background-components.json')
let backgroundChoices = {}
try {
  const saved = JSON.parse(readFileSync(backgroundFile, 'utf8'))
  for (const id of ['music', 'sample']) backgroundChoices[id] = saved?.[id] === true
} catch {
  /* Older profiles close components by default. */
}
function setBackgroundChoice(id, enabled) {
  const next = { ...backgroundChoices, [id]: enabled }
  writeFileSync(backgroundFile + '.tmp', JSON.stringify(next))
  renameSync(backgroundFile + '.tmp', backgroundFile)
  backgroundChoices = next
}
async function revealWorkbench() {
  if (!shell || shell.isDestroyed()) await openWorkbench()
  if (shell.isMinimized()) shell.restore()
  show(shell)
}
let traySignature
let checkUpdates
function updateTray() {
  if (!tray || quitting) return
  const en = language === 'en'
  const menu = hasWorkbench
    ? [
        {
          label: en ? 'Show FitBay' : '显示 FitBay',
          click: () => void revealWorkbench().catch(console.error),
        },
      ]
    : []
  for (const [component, name] of [
    [music, 'Music'],
    [sample, en ? 'Sample component' : '示例组件'],
  ]) {
    if (component.inBackground())
      menu.push({
        label: (en ? 'Show ' : '显示 ') + name,
        click: () => void component.open().catch(console.error),
      })
  }
  if (checkUpdates)
    menu.push({
      label: en ? 'Check for updates' : '检查更新',
      click: () => void checkUpdates(true),
    })
  menu.push(
    { type: 'separator' },
    { label: en ? 'Quit FitBay' : '退出 FitBay', click: () => app.quit() },
  )
  const signature = menu.map((item) => item.label ?? '').join('|')
  if (signature === traySignature) return
  traySignature = signature
  tray.setContextMenu(Menu.buildFromTemplate(menu))
}
function ensureTray() {
  if (process.platform !== 'win32' || tray || quitting) return
  tray = new Tray(
    nativeImage.createFromPath(path.join(here, 'fitbay.png')).resize({ width: 32, height: 32 }),
  )
  tray.setToolTip('FitBay')
  tray.on(
    'click',
    () =>
      void (
        hasWorkbench
          ? revealWorkbench()
          : (intent === 'prompts' ? prompts : intent === 'component' ? sample : music).open()
      ).catch(console.error),
  )
  updateTray()
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
  if (!entry) throw new Error('NOT_INSTALLED：未安装 FitBay 工作台；当前组件仍可独立使用')
  const file = await realpath(entry)
  if (process.platform === 'win32') app.setAppUserModelId(windowsAppIds.workbench)
  shell = new BrowserWindow({
    ...options(1480, 960),
    minWidth: 900,
    minHeight: 640,
    title: 'FitBay',
    ...(process.platform === 'win32'
      ? {
          titleBarStyle: 'hidden',
          titleBarOverlay: { color: '#00000000', height: 40 },
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
    shell.setAppDetails({ appId: windowsAppIds.workbench })
    for (const win of BaseWindow.getAllWindows()) if (win !== shell) win.setSkipTaskbar(true)
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
  ensureTray()
  shell.on('show', updateTray)
  shell.on('hide', updateTray)
  secure(shell.webContents)
  shell.webContents.on('did-start-loading', builtins.shellClosed)
  shell.on('close', (event) => {
    if (quitting) return
    if (components.some((item) => item.retained())) {
      event.preventDefault()
      for (const item of components) item.closeWithWorkbench()
      shell.hide()
    } else for (const item of components) item.closeWithWorkbench()
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
  onStateChange: updateTray,
  background,
  supportsAcrylic,
  isQuitting: () => quitting,
}
const languageFile = path.join(profile, 'interface-language')
let language = 'zh-CN'
try {
  if (readFileSync(languageFile, 'utf8') === 'en') language = 'en'
} catch {
  /* A new profile uses Chinese. */
}
const sample = componentView({
  ...shared,
  keepRunning: () => backgroundChoices.sample === true,
  setKeepRunning: (value) => setBackgroundChoice('sample', value),
  componentRoot,
  music: false,
})
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
  keepRunning: () => backgroundChoices.music === true,
  setKeepRunning: (value) => setBackgroundChoice('music', value),
  language,
  configureSession: async (s, root) => {
    await startMusic(root)
    musicRuntime.register(s)
  },
  onDispose: (reason) => musicRuntime?.dispose(reason),
  ...shared,
  componentRoot: findMusicRoot,
  music: true,
})
let promptService
function disposePrompts() {
  const service = promptService
  promptService = undefined
  service?.dispose()
}
async function findPromptRoot() {
  if (!installation) return path.join(here, '../prompts')
  const appRoot = await installation.find('prompts')
  return appRoot && path.join(appRoot, 'prompts')
}
const prompts = componentView({
  ...shared,
  prompts: true,
  language,
  componentRoot: findPromptRoot,
  keepRunning: () => false,
  setKeepRunning: () => {},
  configureSession: async (_session, root) => {
    const { promptRuntime } = await import('./prompt-palette.mjs')
    promptService ??= await promptRuntime({
      profile,
      here,
      root,
      isEditor: prompts.isSender,
      options,
      secure,
      show,
    })
    promptService.start()
  },
  onDispose: disposePrompts,
})
const components = [sample, music, prompts]
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
  requestedMode === 'prompts' ||
  requestedMode === 'music' ||
  requestedMode === 'workbench' ||
  (fixturePanels && isBuiltin(requestedMode))
    ? requestedMode
    : 'component'
let requests = Promise.resolve()
async function openIntent(request) {
  if (fixturePanels && isBuiltin(request)) return builtins.open(request)
  if (['workbench', 'music', 'component', 'prompts'].includes(request)) {
    hasWorkbench = Boolean(await findWorkbenchFile())
    ensureTray()
    updateTray()
  }
  if (request === 'workbench') {
    if (!shell || shell.isDestroyed()) {
      await sample.discover()
      await openWorkbench()
    } else {
      if (shell.isMinimized()) shell.restore()
      show(shell)
    }
  } else {
    const component = request === 'prompts' ? prompts : request === 'music' ? music : sample
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
      data.intent === 'prompts' ||
      data.intent === 'music' ||
      data.intent === 'workbench' ||
      data.intent === 'component' ||
      (fixturePanels && isBuiltin(data.intent))
    )
      requests = requests.then(() => openIntent(data.intent)).catch(console.error)
  })
  app.on('before-quit', () => {
    quitting = true
    tray?.destroy()
    tray = undefined
    disposePrompts()
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
      const connections = openConnections(profile, safeStorage)
      app.once('will-quit', () => connections.close())
      let musicMigrationPending = false
      try {
        importInstalledMusicConnection(profile, connections)
      } catch {
        musicMigrationPending = true
      }
      async function installedUses() {
        const installed = {
          music: !!(await music.discover(false)),
          prompts: !!(await prompts.discover(false)),
          toolkit: !!(await toolkitLauncher(app.isPackaged, profile, installation)),
        }
        return Object.keys(apiUses).filter(
          (use) => use === 'default' || installed[use.split('.')[0]],
        )
      }
      ipcMain.handle('connections:snapshot', async (event) => {
        if (!isShell(event)) throw Error('DENIED')
        return {
          rows: (await installedUses()).map((use) => ({
            use,
            ...apiUses[use],
            component:
              use === 'prompts.model' && language === 'en'
                ? 'Prompt library'
                : apiUses[use].component,
            migrationPending:
              use === 'music.model' && musicMigrationPending && !connections.read(use),
            value: connections.read(use),
          })),
          choices: connections.choices(),
        }
      })
      ipcMain.handle('connections:plan', async (event, action, use, id, model) => {
        if (!isShell(event) || !(await installedUses()).includes(use)) throw Error('DENIED')
        if (action === 'authorize')
          return connections.authorizePlan(use, id, (url) => systemShell.openExternal(url))
        if (action === 'refresh') return connections.refreshPlanModels(use, id)
        if (action === 'model') return connections.selectPlanModel(use, id, model)
        if (action === 'revoke') return connections.revokePlan(use, id)
        throw Error('DENIED')
      })
      ipcMain.handle('connections:write', async (event, use, input) => {
        if (!isShell(event) || !(await installedUses()).includes(use)) throw Error('DENIED')
        return connections.write(use, input)
      })
      const componentSetup = componentInstallation(installation, app.getPath('temp'), (...args) =>
        net.fetch(...args),
      )
      ipcMain.handle('component-setup:list', (event) => {
        if (!isShell(event)) throw Error('DENIED')
        return componentSetup.list()
      })
      let modifyingProducts = false
      async function modifyProducts(action) {
        if (modifyingProducts) throw Error('已有安装操作正在进行')
        modifyingProducts = true
        try {
          return await action()
        } finally {
          modifyingProducts = false
        }
      }
      ipcMain.handle('component-setup:install', (event, id) => {
        if (!isShell(event)) throw Error('DENIED')
        return modifyProducts(() => componentSetup.install(id))
      })
      ipcMain.handle('component-setup:uninstall', async (event, id) => {
        if (!isShell(event)) throw Error('DENIED')
        return modifyProducts(() => componentSetup.uninstall(id))
      })
      let previousSelfUpdate
      try {
        const marker = path.join(profile, 'self-update-target')
        const target = readFileSync(marker, 'utf8')
        const installed = app.getVersion().split('.').map(Number)
        if (
          /^\d+\.\d+\.\d+$/.test(target) &&
          target
            .split('.')
            .map((part, i) => Number(part) - installed[i])
            .find((n) => n !== 0) > 0
        )
          previousSelfUpdate = target
        else await rm(marker, { force: true })
      } catch {
        /* First launch. */
      }
      const catalog = updateCatalog({
        previousSelfUpdate,
        request: (...args) => net.fetch(...args),
        inventory: async () => {
          const rows = []
          for (const [id, name] of [
            ['workbench', 'FitBay'],
            ['music', 'Music'],
            ['sample', '示例组件'],
            ['prompts', language === 'en' ? 'Prompt library' : '提示词库'],
            ['toolkit', '工具集'],
          ]) {
            const root =
              id === 'workbench'
                ? installation
                  ? await installation.find(id)
                  : here
                : id === 'toolkit'
                  ? await installedToolkitRoot(app.isPackaged, installation)
                  : await { music, sample, prompts }[id].discover(false)
            if (!root) continue
            const packaged = installation && id !== 'sample' && (await installation.find(id))
            const file =
              packaged || id === 'workbench' || id === 'toolkit' ? 'package.json' : 'component.json'
            const manifest = JSON.parse(readFileSync(path.join(packaged || root, file), 'utf8'))
            const development = id === 'workbench' && !app.isPackaged
            rows.push({
              id,
              name,
              version: manifest.version,
              installable: Boolean(packaged),
              ...(development && { development, revision: manifest.revision }),
            })
          }
          return rows
        },
        changed: (state) => shell?.webContents.send('updates:state', state),
        launch: async (update, id, report) => {
          const file = await saveInstaller(
            update,
            app.getPath('temp'),
            (...args) => net.fetch(...args),
            (percent) => void report('downloading', percent),
          )
          await report('installing')
          if (id === 'workbench') {
            try {
              if (
                path.relative(
                  await realpath(app.getAppPath()),
                  (await installation.registered(id)) || '',
                )
              )
                throw Error('Registration changed')
              await startSelfUpdate({
                file,
                digest: update.digest,
                version: update.version,
                executable: process.execPath,
                profile,
              })
            } catch (error) {
              await rm(path.dirname(file), { recursive: true, force: true, maxRetries: 3 })
              throw error
            }
            app.quit()
            return 'restarting'
          } else {
            try {
              await executeInstaller(file, ['/S', '/currentuser'], { windowsHide: true })
              const root = await installation.find(id)
              if (
                !root ||
                JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version !==
                  update.version
              )
                throw Error('Installation not detected')
            } finally {
              await rm(path.dirname(file), { recursive: true, force: true, maxRetries: 3 })
            }
          }
        },
      })
      for (const method of ['snapshot', 'check', 'install', 'installAll']) {
        ipcMain.handle('updates:' + method, (event, id) => {
          const valid =
            method === 'install'
              ? supportsUpdate(id)
              : method === 'check'
                ? id === undefined || supportsUpdate(id)
                : id === undefined
          if (!isShell(event) || !valid) throw Error('DENIED')
          return ['install', 'installAll'].includes(method)
            ? modifyProducts(() => catalog[method](id))
            : catalog[method](id)
        })
      }
      if (await findWorkbenchFile()) {
        checkUpdates = async () => {
          await revealWorkbench()
          shell.webContents.send('updates:open')
        }
        if (!background) {
          const poll = () => catalog.check().catch(console.error)
          setTimeout(poll, 10000).unref()
          setInterval(poll, 300000).unref()
        }
        updateTray()
      } else if (installation && !background) {
        checkUpdates = productUpdater({
          installation,
          app,
          dialog,
          shell: systemShell,
          english: () => language === 'en',
        })
        setTimeout(checkUpdates, 10_000).unref()
        setInterval(checkUpdates, 5 * 60_000).unref()
        updateTray()
      }
      ipcMain.handle('toolkit-launch:shortcuts', async (event, value) => {
        if (!isShell(event)) throw Error('DENIED')
        const launch = await toolkitLauncher(app.isPackaged, profile, installation)
        if (!launch) throw Error('未检测到工具集')
        return toolkitShortcutRequest(launch, profile, value)
      })
      let toolkitFileState
      const { installLocalFiles } = await import('./toolkit-local/local-files.mjs')
      installLocalFiles((name, _kinds, fn) => {
        ipcMain.handle('toolkit-local:' + name, async (event, v) => {
          if (!isShell(event) || !(await installedToolkitRoot(app.isPackaged, installation)))
            throw Error('工具集不可用')
          if (toolkitFileState?.win !== shell) toolkitFileState = { win: shell }
          return fn(toolkitFileState, v)
        })
      })
      for (const action of ['available', 'open', 'capture']) {
        ipcMain.handle('toolkit-launch:' + action, async (event, page) => {
          if (!isShell(event)) throw Error('DENIED')
          const launch = await toolkitLauncher(app.isPackaged, profile, installation)
          if (action === 'available') return Boolean(launch)
          if (!launch) throw Error('未检测到工具集')
          if (
            page !== undefined &&
            ![
              'translate',
              'files',
              'settings',
              'color',
              'translate',
              'compare',
              'album',
              'compress',
              'clipboard',
              'diff',
              'pairs',
              'convert',
            ].includes(page)
          )
            throw Error('未知工具')
          return launch(action === 'capture', page)
        })
      }
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
      ipcMain.on('workbench:language', (event, value) => {
        if (!isShell(event) || !['zh-CN', 'en'].includes(value) || language === value) return
        language = value
        music.setLanguage(value)
        updateTray()
        try {
          writeFileSync(languageFile + '.tmp', value)
          renameSync(languageFile + '.tmp', languageFile)
        } catch {
          /* The active session still uses the selected language. */
        }
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
        try {
          const file = path.join(profile, 'workbench-material.json')
          writeFileSync(file + '.tmp', JSON.stringify({ transparency, frost, brightness }))
          renameSync(file + '.tmp', file)
        } catch {
          // Embedded components still receive live updates when the profile is read-only.
        }
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
