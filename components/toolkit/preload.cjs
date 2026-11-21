const { contextBridge, ipcRenderer } = require('electron')
const commands = [
  'state',
  'initial',
  'settings',
  'configure',
  'connections',
  'settingsTarget',
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
contextBridge.exposeInMainWorld('toolkit', {
  ...Object.fromEntries(
    commands.map((name) => [name, (value) => ipcRenderer.invoke('toolkit:' + name, value)]),
  ),
  onConnectionChange: (callback) => {
    ipcRenderer.on('toolkit:connections-changed', () => callback())
  },
  onSettingsTarget: (callback) => {
    ipcRenderer.on('toolkit:settings-target', (_event, route) => callback(route))
  },
})
