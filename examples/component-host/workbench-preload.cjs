const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('fitbayConnections', {
  snapshot: () => ipcRenderer.invoke('connections:snapshot'),
  write: (use, input) => ipcRenderer.invoke('connections:write', use, input),
})
let updatePageListener
let updatePagePending = false
ipcRenderer.on('updates:open', () => {
  if (updatePageListener) updatePageListener()
  else updatePagePending = true
})
contextBridge.exposeInMainWorld('fitbayUpdates', {
  snapshot: () => ipcRenderer.invoke('updates:snapshot'),
  check: (id) => ipcRenderer.invoke('updates:check', id),
  install: (id) => ipcRenderer.invoke('updates:install', id),
  onOpen: (callback) => {
    updatePageListener = callback
    if (updatePagePending) {
      updatePagePending = false
      callback()
    }
    return () => {
      if (updatePageListener === callback) updatePageListener = undefined
    }
  },
  onState: (callback) => {
    const listener = (_, state) => callback(state)
    ipcRenderer.on('updates:state', listener)
    return () => ipcRenderer.removeListener('updates:state', listener)
  },
})
if (process.argv.includes('--fixture-panels'))
  contextBridge.exposeInMainWorld('builtinDock', {
    status: () => ipcRenderer.invoke('builtin:status'),
    open: (id) => ipcRenderer.invoke('builtin:open', id),
    detach: (id, release, query) => ipcRenderer.invoke('builtin:detach', id, release, query),
    commit: (id, token) => ipcRenderer.sendSync('builtin:commit', id, token),
    workspace: (info) => ipcRenderer.send('builtin:workspace', info),
    onState(callback) {
      const listener = (_, value) => callback(value)
      ipcRenderer.on('builtin:state', listener)
      return () => ipcRenderer.removeListener('builtin:state', listener)
    },
    onDock(callback) {
      const listener = (_, value) => callback(value)
      ipcRenderer.on('builtin:dock', listener)
      return () => ipcRenderer.removeListener('builtin:dock', listener)
    },
    onActivate(callback) {
      const listener = (_, id) => callback(id)
      ipcRenderer.on('builtin:activate', listener)
      return () => ipcRenderer.removeListener('builtin:activate', listener)
    },
  })
contextBridge.exposeInMainWorld('fitbayToolkit', {
  local: Object.fromEntries(
    [
      'chooseFiles',
      'readImage',
      'readText',
      'chooseOutput',
      'finishOutput',
      'writeImage',
      'writeAlbumPdf',
      'clipboardSnapshot',
      'clipboardAction',
      'planRename',
      'applyRename',
      'convertDoc',
    ].map((name) => [name, (value) => ipcRenderer.invoke('toolkit-local:' + name, value)]),
  ),
  available: () => ipcRenderer.invoke('toolkit-launch:available'),
  capture: () => ipcRenderer.invoke('toolkit-launch:capture'),
  open: (tool) => ipcRenderer.invoke('toolkit-launch:open', tool),
})
function componentBridge(prefix) {
  return {
    show: (settings, target) => ipcRenderer.invoke(prefix + ':show', settings, target),
    stop: () => ipcRenderer.invoke(`${prefix}:stop`),
    close: () => ipcRenderer.invoke(`${prefix}:close`),
    keepRunning: (value) => ipcRenderer.invoke(`${prefix}:keep-running`, value),
    layout: (included) => ipcRenderer.invoke(`${prefix}:layout`, included),
    toggleVisibility: () => ipcRenderer.invoke(`${prefix}:toggle-visibility`),
    inventory: () => ipcRenderer.invoke(`${prefix}:inventory`),
    status: () => ipcRenderer.invoke(`${prefix}:status`),
    restore: () => ipcRenderer.invoke(`${prefix}:restore`),
    open: () => ipcRenderer.invoke(`${prefix}:open`),
    dropZone: (rect) => ipcRenderer.send('prototype:drop-zone', rect),
    confirmedTransfer: (id) => ipcRenderer.sendSync(`${prefix}:confirmed-transfer`, id),
    bounds: (bounds, id) => ipcRenderer.send(`${prefix}:bounds`, bounds, id),
    detach: (release) => ipcRenderer.invoke(`${prefix}:detach`, release),
    onActivate: (callback) => {
      const listener = () => callback()
      ipcRenderer.on(`${prefix}:activate`, listener)
      return () => ipcRenderer.removeListener(`${prefix}:activate`, listener)
    },
    subscribe: (callback) => {
      const listener = (_, state) => callback(state)
      ipcRenderer.on(`${prefix}:state`, listener)
      return () => ipcRenderer.removeListener(`${prefix}:state`, listener)
    },
  }
}
contextBridge.exposeInMainWorld('firstWorkspace', {
  musicInstalled: () => ipcRenderer.invoke('workbench:music-installed'),
  installMusic: () => ipcRenderer.invoke('workbench:install-music'),
})
contextBridge.exposeInMainWorld('componentHost', {
  ...componentBridge('prototype'),
  setLanguage: (language) => ipcRenderer.send('workbench:language', language),
  setMaterial: (value) => ipcRenderer.send('workbench:material', value),
  sampleEnabled: process.argv.includes('--enable-sample-component'),
})
contextBridge.exposeInMainWorld('promptDock', componentBridge('prompt-prototype'))
contextBridge.exposeInMainWorld('musicDock', componentBridge('music-prototype'))
