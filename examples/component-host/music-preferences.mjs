const qualities = ['128k', '192k', '320k', 'flac', 'flac24bit', 'hires']
export const mediaBindings = {
  toggle: 'MediaPlayPause',
  previous: 'MediaPreviousTrack',
  next: 'MediaNextTrack',
}

export function getMusicPreferences(store) {
  const quality = store.get('music-quality')
  const level = Number(store.get('music-volume') || 100)
  return {
    volume: Number.isInteger(level) && level >= 1 && level <= 100 ? level : 100,
    muted: store.get('music-muted') === 'on',
    manualDir: store.get('music-manual-dir'),
    recommendDir: store.get('music-recommend-dir'),
    quality: qualities.includes(quality) ? quality : '320k',
    mediaKeys: store.get('music-media-keys') !== 'off',
    shortcuts: Object.fromEntries(
      Object.keys(mediaBindings).map((action) => [action, store.get('shortcut-' + action)]),
    ),
  }
}

export function setMusicOutput(store, volume, muted) {
  if (!Number.isInteger(volume) || volume < 1 || volume > 100 || typeof muted !== 'boolean')
    throw Error('无效的播放音量')
  store.db.exec('BEGIN')
  try {
    store.set('music-volume', volume)
    store.set('music-muted', muted ? 'on' : 'off')
    store.db.exec('COMMIT')
  } catch (e) {
    store.db.exec('ROLLBACK')
    throw e
  }
}

export function setMusicQuality(store, quality) {
  if (!qualities.includes(quality)) throw Error('不支持此音质')
  store.set('music-quality', quality)
}
