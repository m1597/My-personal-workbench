import { globalShortcut } from 'electron'
import {
  defaultShortcuts,
  getMusicPreferences,
  mediaBindings as media,
} from './music-preferences.mjs'

function accelerator(value) {
  if (value === '') return ''
  if (typeof value !== 'string' || value.length > 60) throw Error('快捷键无效')
  const parts = value.split('+')
  const key = parts.pop()
  const modifiers = ['Ctrl', 'Alt', 'Shift', 'Super'].filter((modifier) => parts.includes(modifier))
  if (
    !key ||
    parts.length !== modifiers.length ||
    !/^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert|Delete)$/.test(
      key,
    ) ||
    (!modifiers.length && !/^F\d+$/.test(key))
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
      if (prefs.globalKeys) {
        if (prefs.mediaKeys) for (const [action, key] of Object.entries(media)) attempt(key, action)
        for (const [action, key] of Object.entries(prefs.shortcuts)) attempt(key, action)
      }
    },
    failures: () => Array.from(failures),
    setEnabled(store, scope, enabled) {
      if (!['app', 'global'].includes(scope) || typeof enabled !== 'boolean')
        throw Error('快捷键设置无效')
      store.set('music-' + scope + '-keys', enabled ? 'on' : 'off')
      if (scope === 'global') {
        const prefs = getMusicPreferences(store)
        const bindings = [
          ...Object.entries(prefs.shortcuts),
          ...Object.entries(media).filter(() => prefs.mediaKeys),
        ]
        for (const [action, key] of bindings) {
          if (enabled) attempt(key, action)
          else remove(key)
        }
      }
    },
    setCustom(store, action, raw) {
      if (!Object.hasOwn(defaultShortcuts, action)) throw Error('未知的播放操作')
      const key = accelerator(raw)
      const prefs = getMusicPreferences(store)
      if (
        key &&
        Object.entries(prefs.shortcuts).some(([id, shortcut]) => id !== action && shortcut === key)
      )
        throw Error('该组合已分配给另一个播放操作')
      const previous = prefs.shortcuts[action]
      if (prefs.globalKeys) add(key, action)
      try {
        store.set('shortcut-' + action, key)
      } catch (error) {
        if (key !== previous) remove(key)
        throw error
      }
      if (previous !== key) remove(previous)
    },
    setMedia(store, enabled) {
      if (typeof enabled !== 'boolean') throw Error('媒体键设置无效')
      store.set('music-media-keys', enabled ? 'on' : 'off')
      for (const [action, key] of Object.entries(media)) {
        if (enabled && getMusicPreferences(store).globalKeys) attempt(key, action)
        else remove(key)
      }
    },
  }
}
