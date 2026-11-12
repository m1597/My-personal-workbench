import { desktopLyrics } from './desktop-lyrics.mjs'
import { registerLibraryTools } from './library-tools.mjs'
import { localLines, ownedLyrics } from './music-lyrics.mjs'
import {
  inLibrary,
  artistMatches,
  namesRequestedArtist,
  recordingPreference,
} from './music-discovery.mjs'
import { MusicTaste } from './music-taste.mjs'
import { musicShortcuts } from './music-shortcuts.mjs'
import { getMusicPreferences, setMusicOutput, setMusicQuality } from './music-preferences.mjs'
import { readdir } from 'node:fs/promises'
import { audioTypes, openAudio, regularFile } from './music/local-files.mjs'
import { registerLx } from './lx-music.mjs'
import path from 'node:path'
import { modelInfo, configureModel, requestMusicModel } from './music-model.mjs'
import { ipcMain, dialog, safeStorage, shell } from 'electron'
import { MusicStore } from './music/store.mjs'
import { createHash, randomUUID } from 'node:crypto'
import { localStream } from './local-stream.mjs'
export function musicService(
  profile,
  isSender,
  mcpScript = path.resolve(import.meta.dirname, '../../../scripts/music-source-mcp.mjs'),
) {
  let store,
    pending,
    generationFinished,
    taste,
    updateTimer,
    choosing,
    grant,
    localDialog = false,
    viewEpoch = 0
  function ensureStore() {
    if (!store) {
      const root = path.join(profile, 'fitbay-music')
      store = new MusicStore(root)
      taste = new MusicTaste(store, root, (data, signal) =>
        requestMusicModel(store, safeStorage, 'profile', data, signal),
      )
      store.library.changed = queueTasteUpdate
    }
  }
  const overlay = desktopLyrics()
  const shortcuts = musicShortcuts()
  const sessions = new WeakSet()
  let musicView
  const bind = (name, fn) =>
    ipcMain.handle('music:' + name, async (event, ...args) => {
      if (!isSender(event)) throw Error('DENIED')
      try {
        musicView = event.sender
        ensureStore()
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
  bind('musicGuide', () => ({
    seen: Boolean(store.get('music-guide-v1')),
    script: mcpScript,
  }))
  bind('markMusicGuide', () => store.set('music-guide-v1', 1))
  const lx = registerLx(
    bind,
    () => store,
    dialog,
    () => {
      if (musicView && !musicView.isDestroyed()) musicView.send('music:lyrics-saved')
    },
  )
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
  bind('showLyrics', (on) => overlay.show(on === true))
  bind('lyricLine', (line) => overlay.update(typeof line === 'string' ? line.slice(0, 500) : ''))
  bind('lyrics', async (id) => {
    if (!text(id)) return []
    if (grant?.id === id) return localLines(grant.file)
    if (id.startsWith('local-')) {
      const track = store.library.row(id)
      return track.awaitingLocation ? [] : localLines(track.file)
    }
    const library = store.db
      .prepare(
        'SELECT t.file,t.awaitingLocation FROM recommended_items r JOIN local_tracks t ON t.id=r.local WHERE r.item=?',
      )
      .get(id)
    if (library) return library.awaitingLocation ? [] : localLines(library.file)
    const item = store.item(id)
    if (!item.track || !['已入库', '就绪'].includes(item.status)) return []
    return localLines(store.local(item.track) ?? store.file(id))
  })
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
  registerLibraryTools(
    bind,
    () => store,
    () => taste,
    dialog,
    () => viewEpoch,
  )
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
  async function recyclableLyrics(audio) {
    const lyric = await ownedLyrics(store.db, audio)
    if (!lyric) return null
    const current = path.parse(audio)
    try {
      const entries = await readdir(current.dir)
      const shared = entries.some((name) => {
        const entry = path.parse(name)
        return (
          name.toLowerCase() !== current.base.toLowerCase() &&
          entry.name.toLowerCase() === current.name.toLowerCase() &&
          Object.hasOwn(audioTypes, entry.ext.toLowerCase())
        )
      })
      return shared ? null : lyric
    } catch {
      return null
    }
  }
  bind('trashLocal', async (id) => {
    const row = store.library.row(text(id))
    if (row.awaitingLocation) throw Error('请先重新定位音频')
    if (localDialog || store.library.job.running) throw Error('请等待当前曲库操作结束')
    localDialog = true
    const epoch = viewEpoch
    try {
      const lyric = await recyclableLyrics(row.file)
      const answer = await dialog.showMessageBox({
        type: 'warning',
        title: '移至系统回收站',
        message: '将下列文件移至系统回收站？',
        detail: [row.file, lyric].filter(Boolean).join('\n'),
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
      if (lyric && lyric === (await recyclableLyrics(row.file))) {
        try {
          await shell.trashItem(lyric)
        } catch {
          throw Error('音频已回收，歌词文件回收失败')
        }
        store.db.prepare('DELETE FROM lyric_files WHERE file=?').run(lyric)
      }
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
      grant = {
        url: 'fitbay-audio://track/' + randomUUID(),
        id,
        file,
        audition: true,
      }
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
  function validateQueue(ids) {
    if (!Array.isArray(ids)) throw Error('播放队列无效')
    const known = new Set(
      store.db
        .prepare('SELECT id FROM items UNION ALL SELECT id FROM local_tracks')
        .all()
        .map((row) => row.id),
    )
    if (
      ids.length > known.size ||
      ids.some((key) => !known.has(key)) ||
      new Set(ids).size !== ids.length
    )
      throw Error('播放队列无效')
  }
  bind('setQueue', (ids) => {
    validateQueue(ids)
    store.set('play-queue', JSON.stringify(ids))
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
    validateQueue(ids)
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
    prefs: {
      ...getMusicPreferences(store),
      shortcutFailures: shortcuts.failures(),
    },
  }))
  bind('setMusicQuality', (quality) => setMusicQuality(store, quality))
  bind('setMusicOutput', (volume, muted) => setMusicOutput(store, volume, muted))
  bind('setMusicShortcut', (action, key) => shortcuts.setCustom(store, action, key))
  bind('setMusicMediaKeys', (enabled) => shortcuts.setMedia(store, enabled))
  async function chooseMusicDirectory(kind, signal) {
    if (!['manual', 'recommend'].includes(kind)) throw Error('无效的目录用途')
    if (localDialog) throw Error('请先关闭当前文件选择窗口')
    const epoch = viewEpoch
    localDialog = true
    try {
      const choice = await dialog.showOpenDialog({
        title: kind === 'manual' ? '选择手动下载目录' : '选择推荐下载目录',
        properties: ['openDirectory', 'createDirectory'],
      })
      if (choice.canceled || !choice.filePaths.length || viewEpoch !== epoch || signal?.aborted)
        return false
      store.set('music-' + kind + '-dir', choice.filePaths[0])
      return true
    } finally {
      localDialog = false
    }
  }
  bind('chooseMusicDirectory', async (kind) => {
    await chooseMusicDirectory(kind)
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
      generationFinished = run(pending.signal)
      return await generationFinished
    } finally {
      generationFinished = null
      pending = null
    }
  }
  function queueTasteUpdate() {
    clearTimeout(updateTimer)
    if (store.get('taste-consent') !== '1') return
    updateTimer = setTimeout(() => {
      void taste.refresh().catch(() => {})
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
  bind('generate', (preference, mode = 'auto', similar = false, targetCount = 5) => {
    text(preference)
    if (!['auto', 'artist', 'style'].includes(mode) || typeof similar !== 'boolean')
      throw Error('无效推荐方式')
    if (!Number.isSafeInteger(targetCount) || targetCount < 1) throw Error('目标首数须为正整数')
    return generateTask(async (signal) => {
      const label = preference.trim() || (mode === 'artist' ? '按歌手推荐' : '按风格推荐')
      clearTimeout(updateTimer)
      if (!store.get('music-recommend-dir') && !(await chooseMusicDirectory('recommend', signal)))
        return null
      signal.throwIfAborted()
      const batch = store.saveSuggestions(label, [], '待处理', undefined, targetCount)
      const update = (state, message) =>
        store.db
          .prepare('UPDATE recommendation_runs SET state=?,message=? WHERE batch=?')
          .run(state, message, batch)
      try {
        if (!store.get('lx-source')) throw Error('请先在设置中导入音乐源')
        const profile = await taste.refresh(signal)
        signal.throwIfAborted()
        const seen = []
        const history = store.db
          .prepare('SELECT title,artist FROM recommended_songs ORDER BY rowid')
          .all()
        const localRows = store.db.prepare(
          'SELECT title,artist FROM local_tracks UNION SELECT i.title,i.artist FROM items i JOIN recommended_items r ON r.item=i.id JOIN local_tracks t ON t.id=r.local',
        )
        const savedRows = store.db.prepare(
          "SELECT i.artist FROM items i JOIN recommended_items r ON r.item=i.id JOIN local_tracks t ON t.id=r.local WHERE i.batch=? AND i.status='已入库' AND t.available=1",
        )
        let saved = []
        let deferred = []
        let requiredArtist = mode === 'artist' && !similar ? preference.trim() : ''
        const frequency = (row, tracks = saved) =>
          tracks.filter(
            (r) => artistMatches(row.artist, r.artist) || artistMatches(r.artist, row.artist),
          ).length
        const preferDifferentArtist = (row) =>
          mode !== 'artist' &&
          !requiredArtist &&
          !(mode === 'auto' && namesRequestedArtist(preference, row.artist))
        let catalogChoices = []
        let repeated = 0
        let stalled = 0
        const sourceHealth = {
          unreachable: 0,
          constraints: { version: recordingPreference(preference), artist: '' },
        }
        while (saved.length < targetCount) {
          signal.throwIfAborted()
          const remaining = targetCount - saved.length
          const excluded = [...(profile ? history.slice(-20) : []), ...seen.slice(-100)].map(
            ({ title, artist }) => ({ title, artist }),
          )
          const { songs: rows, requestedArtist } = await requestMusicModel(
            store,
            safeStorage,
            'recommend',
            {
              preference,
              mode,
              similar: mode === 'artist' && similar,
              count: Math.min(5, remaining),
              ...(profile ? { profile } : {}),
              ...(catalogChoices.length ? { catalogChoices } : {}),
              ...(excluded.length ? { excluded } : {}),
              ...(mode !== 'artist' && saved.length
                ? {
                    recentArtists: [...new Set(saved.map((r) => r.artist))].slice(-30),
                  }
                : {}),
            },
            signal,
          )
          signal.throwIfAborted()
          if (mode === 'auto' && !seen.length && !requiredArtist) {
            if (requestedArtist && namesRequestedArtist(preference, requestedArtist, true))
              requiredArtist = requestedArtist
            else
              requiredArtist =
                rows.find((row) => namesRequestedArtist(preference, row.artist))?.artist ?? ''
          }
          sourceHealth.constraints.artist = requiredArtist
          const local = localRows.all()
          const fresh = []
          for (const row of rows) {
            if (inLibrary(row, seen)) continue
            seen.push(row)
            if (requiredArtist && !artistMatches(requiredArtist, row.artist)) continue
            if (!inLibrary(row, local) && !inLibrary(row, history)) fresh.push(row)
          }
          repeated = fresh.length || deferred.length ? 0 : repeated + 1
          if (repeated >= 3)
            throw Error('模型连续返回已排除的歌曲或不符合条件的艺人，未能提供更多新候选')
          const previouslySaved = saved.length
          const priorDeferred = new Set(deferred)
          const candidates = [...deferred, ...fresh]
          deferred = []
          async function attempt(queue, allowRepeat) {
            while (queue.length && saved.length < targetCount) {
              signal.throwIfAborted()
              const group = []
              const slots = Math.min(3, targetCount - saved.length)
              while (group.length < slots && queue.length) {
                const represented = [...saved, ...group]
                if (mode !== 'artist')
                  queue.sort((a, b) => frequency(a, represented) - frequency(b, represented))
                const index = queue.findIndex(
                  (row) =>
                    allowRepeat || !preferDifferentArtist(row) || !frequency(row, represented),
                )
                if (index < 0) break
                group.push(queue.splice(index, 1)[0])
              }
              if (!group.length) break
              store.saveSuggestions(label, group, '待处理', batch)
              await lx.batch(batch, signal, sourceHealth)
              signal.throwIfAborted()
              saved = savedRows.all(batch)
            }
          }
          await attempt(candidates, false)
          deferred = candidates
          // Try fresh artists from another model/catalog round before using same-artist reserves.
          // Once that search yields no new playable artist, release the preceding round's reserves.
          if (saved.length === previouslySaved && priorDeferred.size) {
            const reserves = deferred.filter((row) => priorDeferred.has(row))
            deferred = deferred.filter((row) => !priorDeferred.has(row))
            await attempt(reserves, true)
          }
          stalled = saved.length > previouslySaved ? 0 : stalled + 1
          if (stalled >= 6)
            throw Error(
              '连续 6 轮没有可入库的新录音，已停止继续调用模型。请查看匹配详情或更换音源、调整要求后重试',
            )
          if (saved.length < targetCount) {
            update('running', '正在补推，还差 ' + (targetCount - saved.length) + ' 首')
            catalogChoices = await lx.discoveries(
              seen.filter((row) => !preferDifferentArtist(row) || !frequency(row)).slice(-20),
              [...local, ...history, ...seen],
              signal,
            )
            catalogChoices = catalogChoices.filter(
              (row) => !preferDifferentArtist(row) || !frequency(row),
            )
          }
        }
        update('completed', '已达到目标首数')
      } catch (error) {
        update(
          signal.aborted ? 'cancelled' : 'blocked',
          signal.aborted
            ? '本次推荐已终止'
            : error.code
              ? '存储操作失败，请检查空间和目录权限后重试'
              : String(error.message),
        )
      }
      return batch
    })
  })
  bind('stopGeneration', async () => {
    pending?.abort()
    await generationFinished?.catch(() => {})
  })
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
  bind('heardLocal', (url) => {
    if (!grant || grant.url !== text(url) || grant.audition) return
    store.library.heard(grant.libraryId ?? grant.id)
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
    async sourceTool(name, args, signal) {
      ensureStore()
      try {
        return await lx.sourceTool(name, args, signal)
      } finally {
        if (
          (name === 'import_sources' || name === 'select_source') &&
          musicView &&
          !musicView.isDestroyed()
        )
          musicView.send('music:sources-changed')
      }
    },
    register(session) {
      if (!sessions.has(session)) {
        session.protocol.handle('fitbay-audio', (req) => localStream(req, grant, store?.library))
        sessions.add(session)
      }
    },
    dispose() {
      overlay.show(false)
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
