const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('sampleHost', {
  hello: (payload) => ipcRenderer.invoke('sample:hello', payload),
  transfer: (action) => ipcRenderer.invoke('sample:transfer', action),
  subscribe: (callback) => {
    const listener = (_, state) => callback(state)
    ipcRenderer.on('sample:state', listener)
    return () => ipcRenderer.removeListener('sample:state', listener)
  },
})
