import path from 'node:path'
import { ipcMain, dialog } from 'electron'
import { setTimeout as delay } from 'node:timers/promises'
import { MusicStore } from './music/store.mjs'
export function musicService(profile, isSender) {
  let store, pending, choosing
  const bind = (name, fn) =>
    ipcMain.handle('music:' + name, async (event, ...args) => {
      if (!isSender(event)) throw Error('DENIED')
      try {
        store ??= new MusicStore(path.join(profile, 'fitbay-music'))
        return await fn(...args)
      } catch (e) {
        // File system and SQLite errors may contain local paths.
        if (e.name === 'AbortError') throw Error('生成已取消')
        if (e.code) throw Error('存储操作失败，请检查空间和目录权限后重试')
        throw e
      }
    })
  const text = (value) => {
    if (typeof value !== 'string' || value.length > 1000) throw Error('输入过长')
    return value
  }
  bind('state', () => store.snapshot())
  bind('draft', (v) => store.set('draft', text(v)))
  bind('generate', async (preference, summary) => {
    text(preference)
    if (!preference.trim() || pending) throw Error('请检查偏好和生成状态')
    if (
      summary !== undefined &&
      (!Array.isArray(summary) ||
        summary.length > 5 ||
        summary.some((line) => typeof line !== 'string') ||
        JSON.stringify(summary) !== JSON.stringify(store.summary()))
    )
      throw Error('摘要已变更，请重新预览')
    const request = { preference, ...(summary ? { summary } : {}) }
    const task = new AbortController()
    pending = task
    try {
      await delay(150, undefined, { signal: task.signal })
      return store.generate(request.preference, request.summary)
    } finally {
      pending = null
    }
  })
  bind('stopGeneration', () => pending?.abort())
  bind('match', (batch) => store.match(text(batch)))
  bind('choose', (id, track) => store.choose(text(id), text(track)))
  bind('retry', (id) => {
    const row = store.item(text(id))
    store.choose(id, row.track)
  })
  bind('cancel', (id) => store.cancel(text(id)))
  bind('cancelBatch', (batch) => {
    for (const { id } of store.db.prepare('SELECT id FROM items WHERE batch=?').all(text(batch)))
      store.cancel(id)
  })
  bind('bytes', (id) => store.bytes(text(id)))
  bind('progress', (id, time) => {
    if (Number.isFinite(time) && time >= 0 && time <= 20 && store.active === id)
      store.checkpoint(id, time)
  })
  bind('release', () => store.release())
  bind('clean', () => store.cleanup(true))
  bind('checked', (id, on) => {
    store.item(text(id))
    if (typeof on !== 'boolean') throw Error('选择无效')
    store.db.prepare('UPDATE items SET checked=? WHERE id=?').run(Number(on), id)
  })
  bind('keep', async (batch) => {
    text(batch)
    if (!store.get('root')) {
      choosing ??= dialog
        .showOpenDialog({
          title: '选择正式音乐库',
          properties: ['openDirectory', 'createDirectory'],
        })
        .finally(() => {
          choosing = null
        })
      const choice = await choosing
      if (choice.canceled) return
      store.set('root', choice.filePaths[0])
    }
    for (const { id } of store.db
      .prepare('SELECT id FROM items WHERE batch=? AND checked=1')
      .all(batch))
      store.keep(id)
  })
  const timer = setInterval(() => {
    try {
      store?.cleanup(false)
    } catch {
      console.warn('试听缓存清理暂缓')
    }
  }, 60000)
  timer.unref()
  return () => {
    pending?.abort()
    if (store) {
      try {
        store.release()
      } catch {
        store.active = null
      }
    }
  }
}
