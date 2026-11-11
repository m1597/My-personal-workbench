const { contextBridge, ipcRenderer } = require('electron')
const names = [
  'lxInfo',
  'lxImport',
  'lxSearch',
  'lxDownload',
  'lxCancel',
  'configureModel',
  'state',
  'importLocal',
  'cancelImport',
  'refreshLocal',
  'removeLocal',
  'relocateLocal',
  'localSource',
  'mediaFailed',
  'playQueue',
  'draft',
  'generate',
  'stopGeneration',
  'match',
  'choose',
  'retry',
  'cancel',
  'cancelBatch',
  'bytes',
  'progress',
  'release',
  'clean',
  'checked',
  'keep',
]
const bridge = Object.fromEntries(
  names.map((name) => [name, (...args) => ipcRenderer.invoke('music:' + name, ...args)]),
)
contextBridge.exposeInMainWorld('music', Object.freeze(bridge))
contextBridge.exposeInMainWorld('musicWindow', {
  status: () => ipcRenderer.invoke('music-sample:hello', { protocol: '0.1' }),
  transfer: (action) => ipcRenderer.invoke('music-sample:transfer', action),
  subscribe: (fn) => {
    const cb = (_, v) => fn(v)
    ipcRenderer.on('music-sample:state', cb)
    return () => ipcRenderer.removeListener('music-sample:state', cb)
  },
})
