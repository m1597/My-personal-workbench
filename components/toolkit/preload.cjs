const { contextBridge, ipcRenderer } = require('electron')
const commands = [
  'state',
  'screenReady',
  'initial',
  'toolTarget',
  'batchInputs',
  'selectionImage',
  'applyAnnotation',
  'extractText',
  'copyMeasuredColor',
  'copyColorResult',
  'repick',
  'chooseFiles',
  'readImage',
  'readText',
  'chooseOutput',
  'finishOutput',
  'writeImage',
  'writeAlbumPdf',
  'clipboardSnapshot',
  'clipboardAction',
  'planRename',
  'applyRename',
  'convertDoc',
  'configure',
  'connections',
  'settingsTarget',
  'enable',
  'capture',
  'crop',
  'copy',
  'save',
  'pin',
  'pinReady',
  'pinFailed',
  'pinZoom',
  'pinMove',
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
  onMaterial: (callback) => ipcRenderer.on('toolkit:material', (_, m) => callback(m)),
  onToolTarget: (callback) => {
    ipcRenderer.on('toolkit:tool-target', (_, id) => callback(id))
  },
  onConnectionChange: (callback) => {
    ipcRenderer.on('toolkit:connections-changed', () => callback())
  },
  onSettingsTarget: (callback) => {
    ipcRenderer.on('toolkit:settings-target', (_event, route) => callback(route))
  },
})
