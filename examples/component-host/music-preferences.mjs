const qualities = ['128k', '192k', '320k', 'flac', 'flac24bit', 'hires']
export const mediaBindings = {
  toggle: 'MediaPlayPause',
  previous: 'MediaPreviousTrack',
  next: 'MediaNextTrack',
}

export function getMusicPreferences(store) {
  const quality = store.get('music-quality')
  return {
    manualDir: store.get('music-manual-dir'),
    recommendDir: store.get('music-recommend-dir'),
    quality: qualities.includes(quality) ? quality : '320k',
    mediaKeys: store.get('music-media-keys') !== 'off',
    shortcuts: Object.fromEntries(
      Object.keys(mediaBindings).map((action) => [action, store.get('shortcut-' + action)]),
    ),
  }
}

export function setMusicQuality(store, quality) {
  if (!qualities.includes(quality)) throw Error('不支持此音质')
  store.set('music-quality', quality)
}
