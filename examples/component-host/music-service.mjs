import { registerLx } from './lx-music.mjs'
import path from 'node:path'
import { modelInfo, configureModel, requestMusicModel } from './music-model.mjs'
import { ipcMain, dialog, safeStorage } from 'electron'
import { setTimeout as delay } from 'node:timers/promises'
import { MusicStore } from './music/store.mjs'
import { randomUUID } from 'node:crypto'
import { localStream } from './local-stream.mjs'
export function musicService(profile, isSender) {
  let store,
    pending,
    choosing,
    grant,
    localDialog = false,
    viewEpoch = 0
  const sessions = new WeakSet()
  const bind = (name, fn) =>
    ipcMain.handle('music:' + name, async (event, ...args) => {
      if (!isSender(event)) throw Error('DENIED')
      try {
        store ??= new MusicStore(path.join(profile, 'fitbay-music'))
        return await fn(...args)
      } catch (e) {
        // File system and SQLite errors may contain local paths.
        if (e.name === 'AbortError')
          throw Error(name.startsWith('lx') ? '操作已取消' : '生成已取消')
        if (e.code) throw Error('存储操作失败，请检查空间和目录权限后重试')
        throw e
      }
    })
  const closeLx = registerLx(bind, () => store, dialog)
  const text = (value) => {
    if (typeof value !== 'string' || value.length > 1000) throw Error('输入过长')
    return value
  }
  async function selectLocal(mode, id) {
    if (localDialog || store.library.job.running) throw Error('请等待当前导入结束')
    if (id) store.library.row(id)
    const generation = viewEpoch
    localDialog = true
    try {
      const folder = mode === 'folder'
      const result = await dialog.showOpenDialog({
        title: id ? '重新定位歌曲' : folder ? '添加音乐文件夹' : '添加歌曲',
        properties: folder
          ? ['openDirectory']
          : id
            ? ['openFile']
            : ['openFile', 'multiSelections'],
        filters: folder ? [] : [{ name: '音频文件', extensions: ['mp3', 'flac', 'wav', 'm4a'] }],
      })
      if (!result.canceled && result.filePaths.length && generation === viewEpoch)
        store.library.start(result.filePaths, folder, id)
    } finally {
      localDialog = false
    }
  }
  bind('importLocal', (mode) => {
    if (!['folder', 'files'].includes(mode)) throw Error('导入方式无效')
    return selectLocal(mode)
  })
  bind('createPlaylist', (name) => store.library.createPlaylist(name))
  bind('setMembership', (playlist, track, added) =>
    store.library.setMembership(playlist, track, added),
  )
  bind('cancelImport', () => store.library.cancel())
  bind('relocateLocal', (id) => selectLocal('files', text(id)))
  bind('refreshLocal', () => store.library.refresh())
  bind('removeLocal', (id) => {
    store.library.remove(text(id))
    if (grant?.id === id) grant = null
    if (store.get('current') === id) store.checkpoint('', 0)
    store.set(
      'play-queue',
      JSON.stringify(JSON.parse(store.get('play-queue') || '[]').filter((key) => key !== id)),
    )
  })
  bind('localSource', async (id) => {
    const epoch = viewEpoch
    const row = store.library.row(text(id))
    if (!(await store.library.verify(row))) throw Error('文件不可用，请重新定位')
    if (viewEpoch !== epoch) throw Error('窗口已关闭')
    store.release()
    grant = {
      url: 'fitbay-audio://track/' + randomUUID(),
      id,
      file: row.file,
      duration: row.duration,
    }
    return grant.url
  })
  bind('mediaFailed', (id, url) => {
    if (grant && grant.id === id && grant.url === url) {
      store.db.prepare('UPDATE local_tracks SET available=0,unplayable=1 WHERE id=?').run(id)
      grant = null
    }
  })
  bind('playQueue', (id, ids, position) => {
    if (
      !(store.active === id || grant?.id === id) ||
      !Array.isArray(ids) ||
      !ids.includes(id) ||
      !Number.isFinite(position) ||
      position < 0
    )
      throw Error('播放队列无效')
    const known = new Set(
      store.db
        .prepare('SELECT id FROM items UNION ALL SELECT id FROM local_tracks')
        .all()
        .map((row) => row.id),
    )
    if (ids.length > known.size || ids.some((key) => !known.has(key))) throw Error('播放队列无效')
    store.db.exec('BEGIN')
    try {
      store.set('play-queue', JSON.stringify(ids))
      store.checkpoint(id, position)
      store.db.exec('COMMIT')
    } catch (e) {
      store.db.exec('ROLLBACK')
      throw e
    }
  })
  bind('state', () => ({ ...store.snapshot(), models: modelInfo(store) }))
  bind('configureModel', (id, model, key, forget) => {
    if (pending) throw Error('请先结束当前生成')
    configureModel(store, safeStorage, id, model, key, forget)
  })
  bind('draft', (v) => store.set('draft', text(v)))
  async function generateTask(run) {
    if (pending) throw Error('请先结束当前生成')
    pending = new AbortController()
    try {
      return await run(pending.signal)
    } finally {
      pending = null
    }
  }
  bind('generateProfile', (description, summary) => {
    text(description)
    if (
      summary !== undefined &&
      (!Array.isArray(summary) ||
        JSON.stringify(summary) !== JSON.stringify(store.preferenceSummary()))
    )
      throw Error('摘要已变更，请重新预览')
    if (!description.trim() && !summary?.length) throw Error('请填写自述或附加曲库摘要')
    if (modelInfo(store).active === 'offline') throw Error('请选择模型服务生成偏好资料')
    return generateTask(async (signal) => {
      const result = await requestMusicModel(
        store,
        safeStorage,
        'profile',
        { description, ...(summary ? { summary } : {}) },
        signal,
      )
      signal.throwIfAborted()
      store.set('taste-profile', result)
    })
  })
  bind('generate', (preference, profile = '') => {
    text(preference)
    if (profile !== (store.get('taste-profile') || '')) throw Error('资料已变更，请重新预览')
    if (!preference.trim() && !profile) throw Error('请填写当次风格或先生成资料')
    return generateTask(async (signal) => {
      const label = preference.trim() || '个人偏好'
      if (modelInfo(store).active === 'offline') {
        await delay(150, undefined, { signal })
        return store.generate(label, profile ? [profile] : [])
      }
      const rows = await requestMusicModel(
        store,
        safeStorage,
        'recommend',
        { preference, ...(profile ? { profile } : {}) },
        signal,
      )
      signal.throwIfAborted()
      return store.saveSuggestions(label, rows, '模型推荐')
    })
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
  bind('bytes', (id) => {
    const bytes = store.bytes(text(id))
    grant = null
    return bytes
  })
  bind('progress', (id, time, duration) => {
    if (
      Number.isFinite(time) &&
      time >= 0 &&
      (grant?.id === id || store.active === id) &&
      Number.isFinite(duration) &&
      time <= duration
    )
      store.checkpoint(id, time)
  })
  bind('release', () => {
    grant = null
    store.release()
  })
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
  return {
    register(session) {
      if (!sessions.has(session)) {
        session.protocol.handle('fitbay-audio', (req) => localStream(req, grant, store?.library))
        sessions.add(session)
      }
    },
    dispose() {
      closeLx()
      viewEpoch++
      grant = null
      store?.library.cancel()
      pending?.abort()
      if (store) {
        try {
          store.release()
        } catch {
          store.active = null
        }
      }
    },
  }
}
