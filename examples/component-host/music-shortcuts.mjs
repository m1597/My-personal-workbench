import { globalShortcut } from 'electron'
import {
  appBindings,
  defaultShortcuts,
  getMusicPreferences,
  mediaBindings as media,
} from './music-preferences.mjs'

function accelerator(value, local = false) {
  if (value === '') return ''
  if (typeof value !== 'string' || value.length > 60) throw Error('快捷键无效')
  const parts = value.split('+')
  const key = parts.pop()
  const modifiers = ['Ctrl', 'Alt', 'Shift', 'Super'].filter((modifier) => parts.includes(modifier))
  if (
    !key ||
    parts.length !== modifiers.length ||
    !/^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert|Delete|MediaPlayPause|MediaNextTrack|MediaPreviousTrack)$/.test(
      key,
    ) ||
    (!local &&
      !modifiers.length &&
      !/^(?:F\d+|MediaPlayPause|MediaPreviousTrack|MediaNextTrack)$/.test(key))
  )
    throw Error('请使用修饰键组合或功能键')
  return [...modifiers, key].join('+')
}

export function musicShortcuts() {
  let owner
  const registered = new Map()
  const failures = new Set()
  const remove = (key) => {
    if (registered.has(key)) globalShortcut.unregister(key)
    registered.delete(key)
    failures.delete(key)
  }
  const add = (key, action) => {
    if (!key) return
    if (registered.has(key)) {
      if (registered.get(key) !== action) throw Error('该组合已分配给另一个播放操作')
      return
    }
    if (
      !globalShortcut.register(key, () => {
        if (owner && !owner.isDestroyed()) owner.send('music:transport', action)
      })
    )
      throw Error('快捷键已被占用或系统未允许注册：' + key)
    registered.set(key, action)
    failures.delete(key)
  }
  const attempt = (key, action) => {
    try {
      add(key, action)
    } catch {
      failures.add(key)
    }
  }
  function applyGlobal(prefs) {
    for (const key of registered.keys()) remove(key)
    failures.clear()
    if (!prefs.globalKeys) return
    for (const [action, key] of Object.entries(prefs.shortcuts)) {
      if (!key.startsWith('Media') || prefs.mediaKeys) attempt(key, action)
    }
    if (prefs.mediaKeys) for (const [action, key] of Object.entries(media)) attempt(key, action)
  }
  function checkOverlap(bindings, other) {
    if (bindings.some((key) => key && other.includes(key)))
      throw Error('该快捷键已在另一作用范围内使用')
  }
  return {
    activate(sender, store) {
      if (owner === sender) return
      for (const key of registered.keys()) remove(key)
      failures.clear()
      owner = sender
      const release = () => {
        if (owner !== sender) return
        for (const key of registered.keys()) remove(key)
        failures.clear()
        owner = undefined
      }
      sender.once('destroyed', release)
      sender.once('render-process-gone', release)
      const prefs = getMusicPreferences(store)
      applyGlobal(prefs)
    },
    failures: () => Array.from(failures),
    setEnabled(store, scope, enabled) {
      if (!['app', 'global'].includes(scope) || typeof enabled !== 'boolean')
        throw Error('快捷键设置无效')
      store.set('music-' + scope + '-keys', enabled ? 'on' : 'off')
      if (scope === 'global') applyGlobal(getMusicPreferences(store))
    },
    reset(store, scope) {
      if (!['app', 'global'].includes(scope)) throw Error('快捷键范围无效')
      const prefs = getMusicPreferences(store)
      const globalKeys = Object.values(scope === 'app' ? prefs.shortcuts : defaultShortcuts).concat(
        Object.values(media),
      )
      checkOverlap(Object.values(scope === 'app' ? appBindings : prefs.appShortcuts), globalKeys)
      const prefix = scope === 'app' ? 'app-shortcut-' : 'shortcut-'
      store.db
        .prepare('DELETE FROM state WHERE key IN (SELECT ? || value FROM json_each(?))')
        .run(prefix, JSON.stringify(Object.keys(appBindings)))
      if (scope === 'global') applyGlobal(getMusicPreferences(store))
    },
    setCustom(store, action, raw, scope = 'global') {
      if (!['app', 'global'].includes(scope)) throw Error('快捷键范围无效')
      if (!Object.hasOwn(defaultShortcuts, action)) throw Error('未知的播放操作')
      const key = accelerator(raw, scope === 'app')
      const prefs = getMusicPreferences(store)
      if (
        key &&
        Object.entries(scope === 'app' ? prefs.appShortcuts : prefs.shortcuts).some(
          ([id, shortcut]) => id !== action && shortcut === key,
        )
      )
        throw Error('该组合已分配给另一个播放操作')
      if (key) {
        checkOverlap([key], Object.values(scope === 'app' ? prefs.shortcuts : prefs.appShortcuts))
        if (
          Object.entries(media).some(
            ([other, binding]) => binding === key && (scope === 'app' || other !== action),
          )
        )
          throw Error('该组合已分配给媒体键操作')
      }
      if (scope === 'app') {
        store.set('app-shortcut-' + action, key)
        return
      }
      const previous = prefs.shortcuts[action]
      if (prefs.globalKeys && (!key.startsWith('Media') || prefs.mediaKeys)) add(key, action)
      try {
        store.set('shortcut-' + action, key)
      } catch (error) {
        if (key !== previous) remove(key)
        throw error
      }
      if (previous !== key && !(prefs.mediaKeys && Object.values(media).includes(previous)))
        remove(previous)
    },
    setMedia(store, enabled) {
      if (typeof enabled !== 'boolean') throw Error('媒体键设置无效')
      store.set('music-media-keys', enabled ? 'on' : 'off')
      applyGlobal(getMusicPreferences(store))
    },
  }
}
