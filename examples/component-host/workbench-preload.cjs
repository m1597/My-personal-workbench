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
          reveal: () => ipcRenderer.invoke('music-prototype:reveal'),
        }
      : {}),
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
contextBridge.exposeInMainWorld('componentHost', {
  ...componentBridge('prototype'),
  sampleEnabled: process.argv.includes('--enable-sample-component'),
})
contextBridge.exposeInMainWorld('musicDock', componentBridge('music-prototype'))
