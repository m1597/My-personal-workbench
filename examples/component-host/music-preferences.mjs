const qualities = ['128k', '192k', '320k', 'flac', 'flac24bit', 'hires']
const choices = {
  previewQuality: ['fast', ...qualities],
  shortage: ['ask', 'similar'],
  edition: ['any', 'studio', 'live'],
  cover: ['any', 'prefer', 'avoid'],
  instrumental: ['requested', 'any', 'prefer'],
}
export function setListeningPreference(store, key, value) {
  if (!Object.hasOwn(choices, key) || !choices[key].includes(value)) throw Error('无效的音乐偏好')
  store.set('music-pref-' + key, value)
}
export function chooseQuality(available, preference) {
  if (available.includes(preference)) return preference
  const order = preference === 'fast' ? qualities : [preference, '320k', ...qualities]
  return order.find((q) => available.includes(q)) ?? available[0]
}
export const mediaBindings = {
  toggle: 'MediaPlayPause',
  previous: 'MediaPreviousTrack',
  next: 'MediaNextTrack',
}

const options = {
  lyricSize: ['18', '24', '30'],
  lyricLayout: ['single', 'double'],
  lyricLanguage: ['original', 'bilingual'],
  lrcSave: ['on', 'off'],
  lrcLanguage: ['original', 'bilingual'],
  startup: ['pause', 'resume', 'beginning'],
  unplug: ['pause', 'continue'],
}
const defaults = {
  lyricSize: '24',
  lyricLayout: 'single',
  lyricLanguage: 'original',
  lrcSave: 'on',
  lrcLanguage: 'original',
  startup: 'pause',
  unplug: 'continue',
  sink: '',
}
export function setPlayerOption(store, key, value) {
  if (
    typeof key !== 'string' ||
    !Object.hasOwn(defaults, key) ||
    typeof value !== 'string' ||
    (key === 'sink' ? value.length > 256 : !options[key].includes(value))
  )
    throw Error('无效的播放设置')
  store.set('player-option-' + key, value)
}
export function getMusicPreferences(store) {
  const quality = store.get('music-quality')
  const level = Number(store.get('music-volume') || 100)
  return {
    ...Object.fromEntries(
      Object.entries(choices).map(([key, values]) => {
        const value = store.get('music-pref-' + key)
        return [key, values.includes(value) ? value : values[0]]
      }),
    ),
    ...Object.fromEntries(
      Object.entries(defaults).map(([key, fallback]) => {
        const saved = store.get('player-option-' + key)
        return [
          key,
          (key === 'sink' ? saved?.length <= 256 : options[key].includes(saved)) ? saved : fallback,
        ]
      }),
    ),
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
