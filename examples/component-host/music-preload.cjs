const { contextBridge, ipcRenderer, webUtils } = require('electron')
const names = [
  'connectionSnapshot',
  'writeConnection',
  'recoverProfile',
  'musicGuide',
  'copyMcpCommand',
  'mcpAgents',
  'setMcpAgent',
  'markMusicGuide',
  'lyrics',
  'lyricTiming',
  'showLyrics',
  'unlockLyrics',
  'lyricLine',
  'lxSources',
  'choosePlaybackVersion',
  'setPlaybackRepository',
  'lxRefreshCatalog',
  'lxImportSelected',
  'lxSelectSource',
  'lxInfo',
  'lxImport',
  'lxSearch',
  'searchHistory',
  'searchCover',
  'rememberOnline',
  'lxDownload',
  'downloadTasks',
  'cancelDownloadTask',
  'downloadSelection',
  'queuePlaylistDownload',
  'lxPreview',
  'lxCancel',
  'setMusicQuality',
  'setListeningPreference',
  'answerShortage',
  'retryFailedRecommendations',
  'setMusicOutput',
  'setPlayerOption',
  'setShortcutEnabled',
  'setMusicShortcut',
  'resetMusicShortcuts',
  'setMusicMediaKeys',
  'chooseMusicDirectory',
  'favoriteSortInfo',
  'setFavoriteSort',
  'chooseFavoriteSortDirectory',
  'searchCollection',
  'configureModel',
  'state',
  'albums',
  'findArtists',
  'followedArtists',
  'similarArtists',
  'artistHighlights',
  'artistSongs',
  'aiCatalogQuery',
  'followArtist',
  'releaseNews',
  'artistReleases',
  'releaseCover',
  'artistPortrait',
  'newsEditions',
  'albumEditions',
  'editionTracks',
  'namedEditions',
  'trackArtists',
  'songDetails',
  'workDetails',
  'personWorks',
  'albumCover',
  'trackCover',
  'publicGenres',
  'publicLists',
  'publicListCover',
  'publicListSongs',
  'keepPublicSongs',
  'importPublicList',
  'playlistArtwork',
  'changePlaylistArtwork',
  'moveSidebarItem',
  'createPlaylist',
  'setMembership',
  'undoMembership',
  'exportPlaylist',
  'setPlaylistSort',
  'movePlaylistTrack',
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
  'previewCleanup',
  'applyCleanup',
  'removeFolder',
  'openFolder',
  'revealTrack',
  'dragLocalFiles',
  'trashLocal',
  'renamePlaylist',
  'deletePlaylist',
  'relocateLocal',
  'localSource',
  'analysisRecording',
  'mediaFailed',
  'playQueue',
  'setQueue',
  'setRepeatOne',
  'draft',
  'generate',
  'getTasteStatus',
  'getRecommendationReferences',
  'setTasteExcluded',
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
for (const name of ['aiCatalogQuery', 'searchCollection']) {
  const invoke = bridge[name]
  bridge[name] = async (...args) => {
    try {
      return await invoke(...args)
    } catch (error) {
      if (error.message.includes('请先在模型设置中填写 API Key'))
        window.dispatchEvent(new Event('music-model-required'))
      throw error
    }
  }
}
bridge.previewPlaylist = (file) =>
  ipcRenderer.invoke('music:previewPlaylist', webUtils.getPathForFile(file))
contextBridge.exposeInMainWorld(
  'musicPlugins',
  Object.freeze({
    list: () => ipcRenderer.invoke('music:pluginList'),
    install: (id) => ipcRenderer.invoke('music:pluginInstall', id),
    download: (id) => ipcRenderer.invoke('music:pluginDownload', id),
    remove: (id) => ipcRenderer.invoke('music:pluginRemove', id),
    call: (id, action, ...args) => ipcRenderer.invoke('music:pluginCall', id, action, args),
  }),
)
bridge.onLyricsSaved = (listener) => {
  const notify = () => listener()
  ipcRenderer.on('music:lyrics-saved', notify)
  return () => ipcRenderer.removeListener('music:lyrics-saved', notify)
}
bridge.onLibraryChanged = (listener) => {
  const notify = (_, removed) => listener(removed)
  ipcRenderer.on('music:library-changed', notify)
  return () => ipcRenderer.removeListener('music:library-changed', notify)
}
bridge.onLyricLocked = (listener) => {
  const notify = (_, locked) => listener(locked)
  ipcRenderer.on('music:lyric-locked', notify)
  return () => ipcRenderer.removeListener('music:lyric-locked', notify)
}
bridge.onSourcesChanged = (listener) => {
  const notify = () => listener()
  ipcRenderer.on('music:sources-changed', notify)
  return () => ipcRenderer.removeListener('music:sources-changed', notify)
}
contextBridge.exposeInMainWorld('fitbayConnections', {
  snapshot: bridge.connectionSnapshot,
  write: bridge.writeConnection,
})
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
