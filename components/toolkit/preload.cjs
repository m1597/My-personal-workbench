const { contextBridge, ipcRenderer } = require('electron')
const commands = [
  'state',
  'initial',
  'settings',
  'configure',
  'enable',
  'capture',
  'crop',
  'copy',
  'save',
  'pin',
  'dismiss',
  'ask',
  'copyAnswer',
  'top',
  'actions',
]
contextBridge.exposeInMainWorld(
  'toolkit',
  Object.fromEntries(
    commands.map((name) => [name, (value) => ipcRenderer.invoke('toolkit:' + name, value)]),
  ),
)
