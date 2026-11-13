const { contextBridge, ipcRenderer } = require('electron')
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
function componentBridge(prefix) {
  return {
    ...(prefix === 'music-prototype'
      ? {
          close: () => ipcRenderer.invoke('music-prototype:close'),
          toggleVisibility: () => ipcRenderer.invoke('music-prototype:toggle-visibility'),
        }
      : {}),
    overlayFrame: () => ipcRenderer.invoke(`${prefix}:overlay-frame`),
    status: () => ipcRenderer.invoke(`${prefix}:status`),
    restore: () => ipcRenderer.invoke(`${prefix}:restore`),
    open: () => ipcRenderer.invoke(`${prefix}:open`),
    dropZone: (rect) => ipcRenderer.send('prototype:drop-zone', rect),
    confirmedTransfer: (id) => ipcRenderer.sendSync(`${prefix}:confirmed-transfer`, id),
    bounds: (bounds, id, composited) =>
      ipcRenderer.send(`${prefix}:bounds`, bounds, id, composited),
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
  setMaterial: (value) => ipcRenderer.send('workbench:material', value),
  sampleEnabled: process.argv.includes('--enable-sample-component'),
})
contextBridge.exposeInMainWorld('musicDock', componentBridge('music-prototype'))
