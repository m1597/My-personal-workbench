const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('builtinWindow', {
  mounted: () => ipcRenderer.send('builtin:mounted'),
  status: () => ipcRenderer.invoke('builtin:status'),
  open: (id) => ipcRenderer.invoke('builtin:open', id),
  query: (value) => ipcRenderer.send('builtin:query', value),
  onState(callback) {
    const listener = (_, value) => callback(value)
    ipcRenderer.on('builtin:state', listener)
    return () => ipcRenderer.removeListener('builtin:state', listener)
  },
})
