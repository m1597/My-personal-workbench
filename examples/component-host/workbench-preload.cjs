const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('componentHost', {
  status: () => ipcRenderer.invoke('prototype:status'),
  restore: () => ipcRenderer.invoke('prototype:restore'),
  open: () => ipcRenderer.invoke('prototype:open'),
  dropZone: (rect) => ipcRenderer.send('prototype:drop-zone', rect),
  bounds: (bounds) => ipcRenderer.send('prototype:bounds', bounds),
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
