import { MusicTaste } from './music-taste.mjs'
import { musicShortcuts } from './music-shortcuts.mjs'
import { getMusicPreferences, setMusicQuality } from './music-preferences.mjs'
import { openAudio, regularFile } from './music/local-files.mjs'
import { registerLx } from './lx-music.mjs'
import path from 'node:path'
import { modelInfo, configureModel, requestMusicModel } from './music-model.mjs'
import { ipcMain, dialog, safeStorage, shell } from 'electron'
import { setTimeout as delay } from 'node:timers/promises'
import { MusicStore } from './music/store.mjs'
import { createHash, randomUUID } from 'node:crypto'
import { localStream } from './local-stream.mjs'
export function musicService(profile, isSender) {
  let store,
    pending,
    taste,
    updateTimer,
    choosing,
    grant,
    localDialog = false,
    viewEpoch = 0
  const shortcuts = musicShortcuts()
  const sessions = new WeakSet()
  const bind = (name, fn) =>
    ipcMain.handle('music:' + name, async (event, ...args) => {
      if (!isSender(event)) throw Error('DENIED')
      try {
        if (!store) {
          const root = path.join(profile, 'fitbay-music')
          store = new MusicStore(root)
          taste = new MusicTaste(store, root, (data, signal) =>
            requestMusicModel(store, safeStorage, 'profile', data, signal),
          )
          store.library.changed = queueTasteUpdate
        }
        shortcuts.activate(event.sender, store)
        return await fn(...args)
      } catch (e) {
        // File system and SQLite errors may contain local paths.
        if (e.name === 'AbortError')
          throw Error(name.startsWith('lx') ? '操作已取消' : '生成已取消')
        if (e.code) throw Error('存储操作失败，请检查空间和目录权限后重试')
        throw e
      }
    })
  const lx = registerLx(bind, () => store, dialog)
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
  bind('renamePlaylist', (id, name) => store.library.renamePlaylist(text(id), name))
  bind('deletePlaylist', (id) => store.library.deletePlaylist(text(id)))
  function updateLibrary(remove) {
    store.db.exec('BEGIN IMMEDIATE')
    try {
      const removed = new Set(remove())
      if (removed.has(store.get('current'))) store.checkpoint('', 0)
      if (removed.size)
        store.set(
          'play-queue',
          JSON.stringify(
            JSON.parse(store.get('play-queue') || '[]').filter((id) => !removed.has(id)),
          ),
        )
      store.db.exec('COMMIT')
      if (removed.has(grant?.id)) grant = null
      return [...removed]
    } catch (error) {
      store.db.exec('ROLLBACK')
      throw error
    }
  }
  bind('removeFolder', (id) => updateLibrary(() => store.library.removeFolder(text(id))))
  const forgetTrack = (id) =>
    updateLibrary(() => {
      store.library.remove(id)
      return [id]
    })
  bind('removeLocal', (id) => {
    forgetTrack(text(id))
  })
  bind('trashLocal', async (id) => {
    const row = store.library.row(text(id))
    if (localDialog || store.library.job.running) throw Error('请等待当前曲库操作结束')
    localDialog = true
    const epoch = viewEpoch
    try {
      const answer = await dialog.showMessageBox({
        type: 'warning',
        title: '移至系统回收站',
        message: '将这个音频文件移至系统回收站？',
        detail: row.file,
        buttons: ['取消', '移至回收站'],
        defaultId: 0,
        cancelId: 0,
      })
      if (answer.response !== 1 || epoch !== viewEpoch) return false
      if (store.library.row(id).file !== row.file || !(await regularFile(row.file)))
        throw Error('文件已变化，曲库记录已保留')
      try {
        await shell.trashItem(row.file)
      } catch {
        throw Error('无法移至系统回收站，曲库记录已保留')
      }
      forgetTrack(id)
      return true
    } finally {
      localDialog = false
    }
  })
  bind('localSource', async (id) => {
    const epoch = viewEpoch
    if (!text(id).startsWith('local-')) {
      const entry = store.db.prepare('SELECT local FROM recommended_items WHERE item=?').get(id)
      if (entry) {
        const row =
          entry.local && store.db.prepare('SELECT * FROM local_tracks WHERE id=?').get(entry.local)
        if (!row || !(await store.library.verify(row))) {
          store.status(id, '待重试')
          throw Error('本地录音不可用，请重试')
        }
        if (epoch !== viewEpoch) throw Error('窗口已关闭')
        store.release()
        grant = {
          id,
          libraryId: row.id,
          file: row.file,
          url: 'fitbay-audio://track/' + randomUUID(),
        }
        return grant.url
      }
      const item = store.item(id)
      if (!item.track?.startsWith('online-') || !['就绪', '已入库'].includes(item.status))
        throw Error('推荐录音未就绪')
      const saved = store.local(item.track),
        file = saved ?? store.file(id)
      if (!saved) {
        let verified = false
        try {
          const handle = await openAudio(file)
          const hash = createHash('sha256')
          for await (const chunk of handle.createReadStream()) hash.update(chunk)
          verified = hash.digest('hex') === item.digest
        } catch {
          /* Missing or changed cache. */
        }
        if (!verified) {
          store.status(id, '文件缺失')
          throw Error('试听缓存缺失或校验失败，请重新获取')
        }
      }
      if (viewEpoch !== epoch) throw Error('窗口已关闭')
      store.release()
      store.active = id
      grant = { url: 'fitbay-audio://track/' + randomUUID(), id, file, audition: true }
      return grant.url
    }
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
      if (grant.audition) {
        store.status(id, '文件缺失')
        store.release()
      } else {
        store.db
          .prepare('UPDATE local_tracks SET available=0,unplayable=1 WHERE id=?')
          .run(grant.libraryId ?? id)
        if (grant.libraryId) store.status(id, '待重试')
      }
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
  bind('state', () => ({
    ...store.snapshot(),
    models: modelInfo(store),
    prefs: { ...getMusicPreferences(store), shortcutFailures: shortcuts.failures() },
  }))
  bind('setMusicQuality', (quality) => setMusicQuality(store, quality))
  bind('setMusicShortcut', (action, key) => shortcuts.setCustom(store, action, key))
  bind('setMusicMediaKeys', (enabled) => shortcuts.setMedia(store, enabled))
  bind('chooseMusicDirectory', async (kind) => {
    if (!['manual', 'recommend'].includes(kind)) throw Error('无效的目录用途')
    const epoch = viewEpoch
    const choice = await dialog.showOpenDialog({
      title: kind === 'manual' ? '选择手动下载目录' : '选择推荐下载目录',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (!choice.canceled && choice.filePaths.length && viewEpoch === epoch)
      store.set('music-' + kind + '-dir', choice.filePaths[0])
  })
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
  function queueTasteUpdate() {
    clearTimeout(updateTimer)
    if (store.get('taste-consent') !== '1') return
    updateTimer = setTimeout(() => {
      if (modelInfo(store).active !== 'offline') void taste.refresh().catch(() => {})
    }, 500)
    updateTimer.unref()
  }
  bind('getTasteStatus', () => taste.status())
  bind('setTasteConsent', (value) => {
    taste.consent(value)
    if (!value) pending?.abort()
    queueTasteUpdate()
    return taste.status()
  })
  bind('generate', (preference, mode = 'style', similar = false) => {
    text(preference)
    if (!['artist', 'style'].includes(mode) || typeof similar !== 'boolean')
      throw Error('无效推荐方式')
    return generateTask(async (signal) => {
      const label = preference.trim() || (mode === 'artist' ? '按歌手推荐' : '按风格推荐')
      if (modelInfo(store).active === 'offline') {
        await delay(150, undefined, { signal })
        return store.generate('离线示例 · ' + label, [])
      }
      clearTimeout(updateTimer)
      const profile = await taste.refresh()
      signal.throwIfAborted()
      const rows = await requestMusicModel(
        store,
        safeStorage,
        'recommend',
        {
          preference,
          mode,
          similar: mode === 'artist' && similar,
          ...(profile ? { profile } : {}),
        },
        signal,
      )
      signal.throwIfAborted()
      const artistKey = (v) => v.normalize('NFKC').trim().toLocaleLowerCase()
      const acceptable =
        mode === 'artist' && !similar && preference.trim()
          ? rows.filter((row) => artistKey(row.artist) === artistKey(preference))
          : rows
      if (!acceptable.length) throw Error('未找到该歌手的推荐歌曲，请检查歌手名或开启相似歌手')
      const batch = store.saveSuggestions(label, acceptable, '待处理')
      lx.batch(batch)
      return batch
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
      lx.close()
      clearTimeout(updateTimer)
      taste?.controller?.abort()
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
