const { contextBridge, ipcRenderer } = require('electron')
function event(channel, callback) {
  const listener = () => callback()
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}
const methods = [
  'state',
  'choose',
  'default',
  'shortcut',
  'identity',
  'locate',
  'batch',
  'browse',
  'image',
  'companion',
  'favorite',
  'activate',
  'choosePalette',
  'copy',
  'files',
  'read',
  'save',
  'pin',
  'search',
  'use',
  'dismiss',
]
contextBridge.exposeInMainWorld(
  'promptLibrary',
  Object.fromEntries([
    ...methods.map((key) => [key, (...args) => ipcRenderer.invoke('prompt:' + key, ...args)]),
    ['onChange', (fn) => event('prompt:changed', fn)],
    ['onFocus', (fn) => event('prompt:focus', fn)],
  ]),
)
contextBridge.exposeInMainWorld('sampleHost', {
  hello: (payload) => ipcRenderer.invoke('prompt-sample:hello', payload),
  transfer: (action) => ipcRenderer.invoke('prompt-sample:transfer', action),
  subscribe(callback) {
    const listener = (_, state) => callback(state)
    ipcRenderer.on('prompt-sample:state', listener)
    return () => ipcRenderer.removeListener('prompt-sample:state', listener)
  },
})

contextBridge.exposeInMainWorld('promptConnections', {
  snapshot: () => ipcRenderer.invoke('prompt:connections'),
  save: (value) => ipcRenderer.invoke('prompt:save-connection', value),
  subscribe: (callback) => event('prompt:connections-changed', callback),
})
