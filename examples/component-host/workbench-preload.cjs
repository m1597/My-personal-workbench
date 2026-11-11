const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('componentHost', {
  status: () => ipcRenderer.invoke('prototype:status'),
  open: () => ipcRenderer.invoke('prototype:open'),
  dropZone: (rect) => ipcRenderer.send('prototype:drop-zone', rect),
  bounds: (bounds) => ipcRenderer.send('prototype:bounds', bounds),
  detach: () => ipcRenderer.invoke('prototype:detach'),
  subscribe: (callback) => {
    const listener = (_, state) => callback(state)
    ipcRenderer.on('prototype:state', listener)
    return () => ipcRenderer.removeListener('prototype:state', listener)
  },
})
