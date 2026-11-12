const { contextBridge, ipcRenderer } = require('electron')
const names = [
  'musicGuide',
  'markMusicGuide',
  'lyrics',
  'showLyrics',
  'lyricLine',
  'lxSources',
  'lxRefreshCatalog',
  'lxImportSelected',
  'lxSelectSource',
  'lxInfo',
  'lxImport',
  'lxSearch',
  'lxDownload',
  'lxPreview',
  'lxCancel',
  'setMusicQuality',
  'setMusicOutput',
  'setMusicShortcut',
  'setMusicMediaKeys',
  'chooseMusicDirectory',
  'configureModel',
  'state',
  'createPlaylist',
  'setMembership',
  'importLocal',
  'cancelImport',
  'refreshLocal',
  'recentHistory',
  'setFavorite',
  'exportLibrary',
  'previewRestore',
  'applyRestore',
  'previewRelocation',
  'applyRelocation',
  'removeLocal',
  'removeFolder',
  'trashLocal',
  'renamePlaylist',
  'deletePlaylist',
  'relocateLocal',
  'localSource',
  'mediaFailed',
  'playQueue',
  'setQueue',
  'draft',
  'generate',
  'getTasteStatus',
  'setTasteConsent',
  'dismissRecommendation',
  'prepareRecommendation',
  'recommendationChoices',
  'stopGeneration',
  'match',
  'choose',
  'retry',
  'cancel',
  'cancelBatch',
  'bytes',
  'progress',
  'heardLocal',
  'release',
  'clean',
  'checked',
  'keep',
]
const bridge = Object.fromEntries(
  names.map((name) => [name, (...args) => ipcRenderer.invoke('music:' + name, ...args)]),
)
bridge.onLyricsSaved = (listener) => {
  const notify = () => listener()
  ipcRenderer.on('music:lyrics-saved', notify)
  return () => ipcRenderer.removeListener('music:lyrics-saved', notify)
}
bridge.onSourcesChanged = (listener) => {
  const notify = () => listener()
  ipcRenderer.on('music:sources-changed', notify)
  return () => ipcRenderer.removeListener('music:sources-changed', notify)
}
contextBridge.exposeInMainWorld('music', Object.freeze(bridge))
contextBridge.exposeInMainWorld('musicWindow', {
  thumbnailState: (state) => ipcRenderer.send('music-sample:thumbnail-state', state),
  onTransport: (fn) => {
    const cb = (_, action) => fn(action)
    ipcRenderer.on('music:transport', cb)
    return () => ipcRenderer.removeListener('music:transport', cb)
  },
  status: () => ipcRenderer.invoke('music-sample:hello', { protocol: '0.1' }),
  present: (mode) => ipcRenderer.invoke('music-sample:presentation', mode),
  transfer: (action) => ipcRenderer.invoke('music-sample:transfer', action),
  subscribe: (fn) => {
    const cb = (_, v) => fn(v)
    ipcRenderer.on('music-sample:state', cb)
    return () => ipcRenderer.removeListener('music-sample:state', cb)
  },
})
