const { contextBridge, ipcRenderer } = require('electron')
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
contextBridge.exposeInMainWorld('componentHost', {
  status: () => ipcRenderer.invoke('prototype:status'),
  restore: () => ipcRenderer.invoke('prototype:restore'),
  open: () => ipcRenderer.invoke('prototype:open'),
  dropZone: (rect) => ipcRenderer.send('prototype:drop-zone', rect),
  confirmedTransfer: (id) => ipcRenderer.sendSync('prototype:confirmed-transfer', id),
  bounds: (bounds, id) => ipcRenderer.send('prototype:bounds', bounds, id),
  detach: (release) => ipcRenderer.invoke('prototype:detach', release),
  onActivate: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('prototype:activate', listener)
    return () => ipcRenderer.removeListener('prototype:activate', listener)
  },
  subscribe: (callback) => {
    const listener = (_, state) => callback(state)
    ipcRenderer.on('prototype:state', listener)
    return () => ipcRenderer.removeListener('prototype:state', listener)
  },
})
