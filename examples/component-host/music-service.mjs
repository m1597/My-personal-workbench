import { reconcileRecycled } from './recycled-tracks.mjs'
import { registerReleaseCatalog } from './release-catalog.mjs'
import { desktopLyrics } from './desktop-lyrics.mjs'
import { musicPlugins } from './music-plugins.mjs'
import { registerLibraryTools } from './library-tools.mjs'
import { localLines } from './music-lyrics.mjs'
import {
  forgetLocal,
  recoverTrash,
  recyclableLyrics,
  retireDownloads,
  trashAudio,
} from './daily-lifecycle.mjs'
import {
  inLibrary,
  artistMatches,
  namesRequestedArtist,
  recordingConstraints,
} from './music-discovery.mjs'
import { MusicTaste } from './music-taste.mjs'
import { musicShortcuts } from './music-shortcuts.mjs'
import {
  getMusicPreferences,
  setPlayerOption,
  setMusicOutput,
  setMusicQuality,
  setListeningPreference,
} from './music-preferences.mjs'
import { lstat, realpath } from 'node:fs/promises'
import { openAudio, pathKey, regularFile } from './music/local-files.mjs'
import { registerLx } from './lx-music.mjs'
import path from 'node:path'
import { searchCollection } from './search-collection.mjs'
import { modelInfo, configureModel, requestMusicModel } from './music-model.mjs'
import { ipcMain, clipboard, dialog, nativeImage, safeStorage, shell } from 'electron'
import { MusicStore } from './music/store.mjs'
import { createHash, randomUUID } from 'node:crypto'
import { localStream } from './local-stream.mjs'
import { onlineStream } from './online-stream.mjs'
export function musicService(
  profile,
  isSender,
  mcpScript = path.resolve(import.meta.dirname, '../../../scripts/music-source-mcp.mjs'),
) {
  let store,
    pending,
    generationFinished,
    recoveringTrash,
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
      recoveringTrash = recoverTrash(store, forgetTracks, (file) => shell.trashItem(file))
      taste = new MusicTaste(store, root, (data, signal) =>
        requestMusicModel(store, safeStorage, 'profile', data, signal),
      )
      store.library.changed = queueTasteUpdate
    }
  }
  const overlay = desktopLyrics(
    () => store,
    (locked) => {
      if (musicView && !musicView.isDestroyed()) musicView.send('music:lyric-locked', locked)
    },
  )
  const shortcuts = musicShortcuts()
  const sessions = new WeakSet()
  let musicView
  const archiveJobs = new Set()
  const bind = (name, fn) =>
    ipcMain.handle('music:' + name, async (event, ...args) => {
      if (!isSender(event)) throw Error('DENIED')
      try {
        musicView = event.sender
        ensureStore()
        await recoveringTrash
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
  registerReleaseCatalog(bind, () => store, nativeImage)
  const plugins = musicPlugins(profile, () => store, dialog, nativeImage)
  bind('pluginList', () => plugins.list())
  bind('pluginInstall', (id) => plugins.install(id))
  bind('pluginDownload', (id) => plugins.download(id))
  bind('pluginRemove', (id) => plugins.remove(id))
  bind('pluginCall', (id, action, args) => plugins.call(id, action, args))
  bind('musicGuide', () => ({
    seen: Boolean(store.get('music-guide-v1')),
    script: mcpScript,
  }))
  bind('copyMcpCommand', () => clipboard.writeText(`node "${mcpScript}"`))
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
  bind('unlockLyrics', () => overlay.unlock())
  bind('lyricTiming', (id, step) => {
    if (!text(id) || ![undefined, 'earlier', 'later', 'reset'].includes(step))
      throw Error('歌词校准参数无效')
    const local = store.db.prepare('SELECT id FROM local_tracks WHERE id=?').get(id)
    const recording =
      local?.id ??
      store.db.prepare('SELECT local FROM recommended_items WHERE item=?').get(id)?.local ??
      store.item(id)?.track
    if (!recording) throw Error('找不到这首录音')
    const key = 'lyric-offset-ms:' + recording
    const previous = Number(store.get(key)) || 0
    if (step === undefined) return previous
    const shift =
      step === 'reset'
        ? 0
        : Math.max(-30000, Math.min(30000, previous + (step === 'earlier' ? -500 : 500)))
    if (shift) store.set(key, shift)
    else store.db.prepare('DELETE FROM state WHERE key=?').run(key)
    return shift
  })
  bind('lyricLine', (groups) => {
    if (!Array.isArray(groups) || groups.length > 2) throw Error('歌词组无效')
    overlay.update(
      groups.map(({ id, original, translation }) => ({
        id: text(id),
        original: text(original),
        translation: text(translation ?? ''),
      })),
      Number(getMusicPreferences(store).lyricSize),
    )
  })
  bind('lyrics', async (id, translations = false) => {
    if (!text(id) || id.startsWith('online-recording-')) return []
    if (grant?.id === id) {
      const track = grant.audition
        ? store.metadata(store.item(id).track)
        : store.library.row(grant.libraryId ?? id)
      return localLines(grant.file, track, translations === true)
    }
    if (id.startsWith('local-')) {
      const track = store.library.row(id)
      return track.awaitingLocation ? [] : localLines(track.file, track, translations === true)
    }
    const library = store.db
      .prepare(
        'SELECT t.file,t.title,t.artist,t.awaitingLocation FROM recommended_items r JOIN local_tracks t ON t.id=r.local WHERE r.item=?',
      )
      .get(id)
    if (library)
      return library.awaitingLocation
        ? []
        : localLines(library.file, library, translations === true)
    const item = store.item(id)
    if (!item.track || !['已入库', '就绪'].includes(item.status)) return []
    return localLines(
      store.local(item.track) ?? store.file(id),
      store.metadata(item.track),
      translations === true,
    )
  })
  bind('importLocal', (mode) => {
    if (!['folder', 'files'].includes(mode)) throw Error('导入方式无效')
    return selectLocal(mode)
  })
  bind('albums', () => store.library.albums.list())
  bind('albumCover', (id) => store.library.albums.cover(id, nativeImage))
  bind('trackCover', (id) => store.library.albums.trackCover(id, nativeImage))
  bind('moveSidebarItem', (group, id, target, after) =>
    store.moveSidebarItem(group, id, target, after),
  )
  bind('createPlaylist', (name, tracks) => store.library.createPlaylist(name, tracks))
  bind('setPlaylistSort', (id, sort, descending) =>
    store.library.setPlaylistSort(id, sort, descending),
  )
  bind('movePlaylistTrack', (id, track, target, after) =>
    store.library.movePlaylistTrack(id, track, target, after),
  )
  bind('setMembership', (playlist, track, added) =>
    store.library.setMembership(playlist, track, added),
  )
  bind('undoMembership', (token) => store.library.undoMembership(text(token)))
  bind('cancelImport', () => store.library.cancel())
  bind('relocateLocal', (id) => selectLocal('files', text(id)))
  bind('refreshLocal', async () => {
    await store.library.refresh()
    await reconcileRecycled(store, forgetTracks)
  })
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
  bind('dragLocalFiles', async (ids) => {
    if (!Array.isArray(ids) || !ids.length) throw Error('请选择本地录音')
    const sender = musicView
    const epoch = viewEpoch
    const files = []
    for (const id of new Set(ids)) {
      const row = store.library.row(text(id))
      if (!row.available || row.awaitingLocation || !(await regularFile(row.file)))
        throw Error('文件不可用，请重新定位')
      files.push(row.file)
    }
    if (sender.isDestroyed() || epoch !== viewEpoch || sender !== musicView) return
    sender.startDrag({ file: files[0], files, icon: path.join(import.meta.dirname, 'fitbay.png') })
  })
  bind('revealTrack', async (id) => {
    const track = text(id)
    const row = track.startsWith('online-recording-')
      ? await store.library.onlineCopy(track)
      : store.library.row(track)
    if (!row || row.awaitingLocation || !(await regularFile(row.file)))
      throw Error('文件不可用，请重新定位')
    shell.showItemInFolder(row.file)
  })
  bind('openFolder', async (id) => {
    const [member] = store.library.folderMembers(text(id))
    const dir = path.dirname(member.file)
    if (!(await lstat(dir)).isDirectory() || pathKey(await realpath(dir)) !== pathKey(dir))
      throw Error('文件夹已变化，请重新导入')
    if (await shell.openPath(dir)) throw Error('无法打开文件夹，请检查目录是否可用')
  })
  function trackIds(value) {
    const ids = Array.isArray(value) ? value : [value]
    if (!ids.length) throw Error('请选择歌曲')
    return [...new Set(ids.map(text))]
  }
  function forgetTracks(ids) {
    const removed = forgetLocal(store, ids)
    if (removed.has(grant?.id) || removed.has(grant?.libraryId)) grant = null
    if (musicView && !musicView.isDestroyed()) musicView.send('music:library-changed', [...removed])
    return removed
  }
  bind('removeLocal', (value) => {
    forgetTracks(trackIds(value))
  })
  bind('trashLocal', async (value) => {
    const rows = trackIds(value).map((id) => store.library.row(id))
    if (rows.some((row) => row.awaitingLocation)) throw Error('请先重新定位音频')
    if (localDialog || store.library.job.running) throw Error('请等待当前曲库操作结束')
    localDialog = true
    const epoch = viewEpoch
    try {
      const targets = []
      for (const row of rows)
        targets.push({ row, lyric: await recyclableLyrics(store.db, row.file) })
      const answer = await dialog.showMessageBox({
        type: 'warning',
        title: '移至系统回收站',
        message: '将下列文件移至系统回收站？',
        detail: targets
          .flatMap(({ row, lyric }) => (lyric ? [row.file, lyric] : [row.file]))
          .join('\n'),
        buttons: ['取消', '移至回收站'],
        defaultId: 0,
        cancelId: 0,
      })
      if (answer.response !== 1 || epoch !== viewEpoch) return false
      for (const { row, lyric } of targets) {
        try {
          if (epoch !== viewEpoch) throw Error('窗口已关闭，尚未处理的歌曲已保留')
          if (store.library.row(row.id).file !== row.file || !(await regularFile(row.file)))
            throw Error('文件已变化，曲库记录已保留')
          await trashAudio(store, row, lyric, (file) => shell.trashItem(file), forgetTracks)
        } catch (error) {
          const remaining = targets.filter(({ row }) =>
            store.db.prepare('SELECT 1 FROM local_tracks WHERE id=?').get(row.id),
          ).length
          throw Error(
            error.message +
              '（已回收 ' +
              (targets.length - remaining) +
              ' / ' +
              targets.length +
              ' 首）',
          )
        }
      }
      return true
    } finally {
      localDialog = false
    }
  })
  let playbackEpoch = 0
  bind('analysisRecording', async (id) => {
    if (typeof id !== 'string' || !id.startsWith('local-')) return null
    const row = store.library.row(id)
    if (!row.duration || row.duration > 900 || !(await store.library.verify(row))) return null
    const file = await openAudio(row.file)
    try {
      const stat = await file.stat()
      if (stat.size > 24 * 1024 * 1024) return null
      const bytes = Buffer.alloc(stat.size)
      let offset = 0
      while (offset < bytes.length) {
        const read = await file.read(bytes, offset, bytes.length - offset, offset)
        if (!read.bytesRead) return null
        offset += read.bytesRead
      }
      return bytes
    } finally {
      await file.close()
    }
  })
  function releaseGrant() {
    playbackEpoch++
    grant?.controller?.abort()
    grant = null
  }
  bind('localSource', async (id, scope) => {
    releaseGrant()
    const play = playbackEpoch
    const epoch = viewEpoch
    if (text(id).startsWith('online-recording-')) {
      const copy = await store.library.onlineCopy(id)
      if (epoch !== viewEpoch || play !== playbackEpoch) throw Error('播放请求已结束')
      if (copy) {
        store.release()
        grant = {
          id,
          libraryId: copy.id,
          file: copy.file,
          duration: copy.duration,
          url: 'fitbay-audio://track/' + randomUUID(),
        }
        return grant.url
      }
      const playback = lx.onlinePlayback(id, typeof scope === 'string' ? scope.slice(0, 128) : id)
      store.release()
      grant = {
        id,
        connect: playback.connect,
        controller: new AbortController(),
        url: 'fitbay-audio://track/' + randomUUID(),
      }
      return grant.url
    }
    if (!text(id).startsWith('local-')) {
      const entry = store.db.prepare('SELECT local FROM recommended_items WHERE item=?').get(id)
      if (entry) {
        const row =
          entry.local && store.db.prepare('SELECT * FROM local_tracks WHERE id=?').get(entry.local)
        if (!row || !(await store.library.verify(row))) {
          store.status(id, '待重试')
          throw Error('本地录音不可用，请重试')
        }
        if (epoch !== viewEpoch || play !== playbackEpoch) throw Error('播放请求已结束')
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
      if (viewEpoch !== epoch || play !== playbackEpoch) throw Error('播放请求已结束')
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
    if (viewEpoch !== epoch || play !== playbackEpoch) throw Error('播放请求已结束')
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
      if (grant.controller) {
        const failure = {
          message: grant.failure || '音频传输或解码失败',
          choices: lx.playbackChoices(id),
        }
        releaseGrant()
        return failure
      }
      if (grant.audition) {
        store.status(id, '文件缺失')
        store.release()
      } else {
        store.db
          .prepare('UPDATE local_tracks SET available=0,unplayable=1 WHERE id=?')
          .run(grant.libraryId ?? id)
        if (grant.libraryId && !id.startsWith('online-recording-')) store.status(id, '待重试')
      }
      grant = null
    }
  })
  function validateQueue(ids) {
    if (!Array.isArray(ids)) throw Error('播放队列无效')
    const known = new Set(
      store.db
        .prepare('SELECT id FROM items UNION ALL SELECT id FROM playlist_recordings')
        .all()
        .map((row) => row.id),
    )
    // Each insertion can retain the current occurrence and add one in album order.
    if (ids.length > known.size * 2) throw Error('播放队列无效')
    const remaining = new Set(known)
    for (const id of ids) {
      if (!remaining.delete(id) && !known.delete(id)) throw Error('播放队列无效')
    }
  }
  function validateQueuePosition(ids, occurrence, pendingAlbum) {
    if (!Array.isArray(pendingAlbum) || pendingAlbum.length > ids.length)
      throw Error('专辑插播无效')
    const known = new Set(ids)
    if (pendingAlbum.some((id) => !known.delete(id))) throw Error('专辑插播无效')
    if (occurrence !== 0 && occurrence !== 1) throw Error('播放队列位置无效')
  }
  bind('setRepeatOne', (enabled) => {
    if (typeof enabled !== 'boolean') throw Error('播放模式无效')
    store.set('music-repeat-one', enabled ? '1' : '0')
  })
  bind('setQueue', (ids, occurrence = 0, pendingAlbum = []) => {
    validateQueue(ids)
    validateQueuePosition(ids, occurrence, pendingAlbum)
    store.db.exec('BEGIN')
    try {
      store.set('play-queue', JSON.stringify(ids))
      store.set('queue-occurrence', String(occurrence))
      store.set('pending-album', JSON.stringify(pendingAlbum))
      store.db.exec('COMMIT')
    } catch (error) {
      store.db.exec('ROLLBACK')
      throw error
    }
  })
  bind('playQueue', (id, ids, position, occurrence = 0, pendingAlbum = []) => {
    if (
      !(store.active === id || grant?.id === id) ||
      !Array.isArray(ids) ||
      !ids.includes(id) ||
      !Number.isFinite(position) ||
      position < 0
    )
      throw Error('播放队列无效')
    validateQueue(ids)
    validateQueuePosition(ids, occurrence, pendingAlbum)
    store.db.exec('BEGIN')
    try {
      store.set('play-queue', JSON.stringify(ids))
      store.set('queue-occurrence', String(occurrence))
      store.set('pending-album', JSON.stringify(pendingAlbum))
      store.checkpoint(id, position)
      store.db.exec('COMMIT')
    } catch (e) {
      store.db.exec('ROLLBACK')
      throw e
    }
  })
  bind('state', () => {
    lx.startBootstrap(() => {
      if (musicView && !musicView.isDestroyed()) musicView.send('music:sources-changed')
    })
    return {
      ...store.snapshot(),
      tasteExclusions: taste.exclusions(),
      models: modelInfo(store),
      prefs: {
        ...getMusicPreferences(store),
        shortcutFailures: shortcuts.failures(),
      },
    }
  })
  bind('setMusicQuality', (quality) => setMusicQuality(store, quality))
  bind('setListeningPreference', (key, value) => setListeningPreference(store, key, value))
  let shortageDecision
  bind('answerShortage', (batch, expand) => {
    if (!shortageDecision || shortageDecision.batch !== batch || typeof expand !== 'boolean')
      throw Error('此批次没有待确认的范围选择')
    shortageDecision.answer(expand)
  })
  bind('setPlayerOption', (key, value) => setPlayerOption(store, key, value))
  bind('setMusicOutput', (volume, muted) => setMusicOutput(store, volume, muted))
  bind('setShortcutEnabled', (scope, enabled) => shortcuts.setEnabled(store, scope, enabled))
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
  let collectionSearch
  bind('searchCollection', async (scope, query) => {
    collectionSearch?.abort()
    const job = new AbortController()
    collectionSearch = job
    try {
      return await searchCollection(store, safeStorage, scope, query, job.signal)
    } finally {
      if (collectionSearch === job) collectionSearch = undefined
    }
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
  bind('setTasteExcluded', (kind, id, excluded) => {
    taste.setExcluded(kind, id, excluded)
    queueTasteUpdate()
  })
  bind('setTasteConsent', (value) => {
    taste.consent(value)
    if (!value) pending?.abort(new DOMException('已撤回审美资料授权', 'AbortError'))
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
      const previous = store.get('latest-daily-run')
      store.expireRecommendations(undefined, true)
      const batch = store.saveSuggestions(label, [], '待处理', undefined, targetCount)
      let cleanupMessage = ''
      let catalogSync
      const update = (state, message) =>
        store.db
          .prepare('UPDATE recommendation_runs SET state=?,message=? WHERE batch=?')
          .run(state, message + cleanupMessage, batch)
      // Closing the last window can exit before the asynchronous workers unwind.
      const recordCancellation = () =>
        update('cancelled', '本次推荐已终止（' + signal.reason.message + '）')
      signal.addEventListener('abort', recordCancellation, { once: true })
      try {
        const { archive, failures } = await retireDownloads(
          store,
          previous,
          {
            forget: forgetTracks,
            trash: (file) => shell.trashItem(file),
            model: (payload, abort) =>
              requestMusicModel(store, safeStorage, 'classify', payload, abort),
            chooseRoot: async () => {
              if (localDialog) return
              const epoch = viewEpoch
              localDialog = true
              try {
                const result = await dialog.showOpenDialog({
                  title: '选择收藏歌曲分类根目录',
                  properties: ['openDirectory', 'createDirectory'],
                })
                if (!result.canceled && epoch === viewEpoch) return result.filePaths[0]
              } finally {
                localDialog = false
              }
            },
            onMove: (id, file) => {
              if ((grant?.libraryId ?? grant?.id) === id) grant.file = file
              if (musicView && !musicView.isDestroyed()) musicView.send('music:library-changed', [])
            },
          },
          signal,
        )
        if (failures) cleanupMessage = ' · 上轮有 ' + failures + ' 首未能完整回收'
        const generation = pending
        archiveJobs.add(generation)
        void archive()
          .catch(() => {})
          .finally(() => archiveJobs.delete(generation))
        if (
          !store.get('music-recommend-dir') &&
          !(await chooseMusicDirectory('recommend', signal))
        ) {
          signal.throwIfAborted()
          update('cancelled', '未选择推荐下载目录')
          return null
        }
        signal.throwIfAborted()
        const catalog = lx.synchronizeSources(signal)
        catalogSync = catalog.finish
        await catalog.ready
        signal.throwIfAborted()
        if (!store.get('lx-source'))
          throw Error('目录和已导入的音乐源均不可用，请在设置中检查音乐源')
        let profilePolicy = taste.policy()
        let profile = await taste.refresh(signal)
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
        const reservations = store.db.prepare(
          "SELECT artist FROM items WHERE batch=? AND status IN ('待处理','正在匹配','正在保存','正在校验')",
        )
        const pendingItem = store.db.prepare(
          "SELECT id FROM items WHERE batch=? AND title=? AND artist=? AND status='待处理' ORDER BY rowid DESC LIMIT 1",
        )
        const candidates = []
        let reserves = new Set()
        let requiredArtist = mode === 'artist' && !similar ? preference.trim() : ''
        const frequency = (row, tracks) =>
          tracks.filter(
            (r) => artistMatches(row.artist, r.artist) || artistMatches(r.artist, row.artist),
          ).length
        const preferDifferentArtist = (row) =>
          mode !== 'artist' &&
          !requiredArtist &&
          !(mode === 'auto' && namesRequestedArtist(preference, row.artist))
        let repeated = 0
        let stalled = 0
        let roundSaved = 0
        let round = 0
        let freshSelected = false
        let refilling
        let refillError
        const prefs = getMusicPreferences(store)
        let exhausted = false
        let broadened = false
        let keepPartial = false
        const sourceHealth = {
          catalogSync,
          lyricTasks: [],
          unreachable: 0,
          queries: new Map(),
          cooldown: new Map(),
          catalogRecordings: new Map(),
          constraints: { ...recordingConstraints(preference, prefs), artist: '' },
        }
        async function refill(represented, savedCount, work) {
          if (exhausted && !broadened) {
            let expand = prefs.shortage === 'similar'
            if (!expand) {
              update('awaiting', '直接相关的候选已用尽，是否扩大到相近歌曲？')
              const decision = Promise.withResolvers()
              const abort = () => decision.reject(work.reason)
              shortageDecision = { batch, answer: decision.resolve }
              work.addEventListener('abort', abort, { once: true })
              try {
                work.throwIfAborted()
                expand = await decision.promise
              } finally {
                work.removeEventListener('abort', abort)
                shortageDecision = undefined
              }
            }
            if (!expand) {
              keepPartial = true
              return
            }
            broadened = true
          }
          stalled = round && savedCount <= roundSaved ? stalled + 1 : 0
          if (stalled >= 6)
            throw Error(
              '连续 6 轮没有可入库的新录音，已停止继续调用模型。请查看匹配详情或更换音源、调整要求后重试',
            )
          roundSaved = savedCount
          reserves = new Set(candidates)
          freshSelected = false
          let catalogChoices = []
          if (round++) {
            update('running', '正在为补推查找可保存的录音')
            const wanted = (row) => !preferDifferentArtist(row) || !frequency(row, represented)
            catalogChoices = (
              await lx.discoveries(
                seen.filter(wanted).slice(-20),
                [...localRows.all(), ...history, ...seen],
                work,
                sourceHealth,
              )
            ).filter(wanted)
          }
          work.throwIfAborted()
          update('running', round > 1 ? '正在补推候选歌曲' : '正在生成候选歌曲')
          if (profilePolicy !== taste.policy()) {
            profilePolicy = taste.policy()
            profile = await taste.refresh(work)
            work.throwIfAborted()
          }
          const remaining = targetCount - represented.length
          const excluded = [...(profile ? history.slice(-20) : []), ...seen.slice(-100)].map(
            ({ title, artist }) => ({ title, artist }),
          )
          const {
            songs: rows,
            requestedArtist,
            directExhausted,
          } = await requestMusicModel(
            store,
            safeStorage,
            'recommend',
            {
              preference,
              scope: broadened ? 'related' : 'direct',
              recording: sourceHealth.constraints,
              mode,
              similar: mode === 'artist' && similar,
              // Keep alternates in memory on refills. The reservation limit below still
              // admits only the requested number of recordings to matching and saving.
              count: Math.min(5, round > 1 ? Math.max(targetCount, remaining + 2) : remaining),
              ...(profile ? { profile } : {}),
              ...(catalogChoices.length ? { catalogChoices } : {}),
              ...(excluded.length ? { excluded } : {}),
              ...(mode !== 'artist' && represented.length
                ? {
                    recentArtists: [...new Set(represented.map((r) => r.artist))].slice(-30),
                  }
                : {}),
            },
            work,
          )
          work.throwIfAborted()
          exhausted = !!preference.trim() && directExhausted
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
          repeated = fresh.length || candidates.length ? 0 : repeated + 1
          if (repeated >= 3)
            throw Error('模型连续返回已排除的歌曲或不符合条件的艺人，未能提供更多新候选')
          candidates.push(...fresh)
          update('running', '正在匹配录音')
        }
        await lx.batch(batch, signal, sourceHealth, async (work) => {
          while (!refillError && !keepPartial) {
            work.throwIfAborted()
            const saved = savedRows.all(batch)
            const active = reservations.all(batch)
            const represented = [...saved, ...active]
            if (represented.length >= targetCount || sourceHealth.unreachable >= 3) return
            if (refilling) {
              await refilling
              continue
            }
            if (mode !== 'artist')
              candidates.sort((a, b) => frequency(a, represented) - frequency(b, represented))
            let index = candidates.findIndex(
              (row) => !preferDifferentArtist(row) || !frequency(row, represented),
            )
            if (index < 0 && (!freshSelected || (!active.length && saved.length === roundSaved)))
              index = candidates.findIndex((row) => reserves.has(row))
            if (index < 0 && exhausted && candidates.length) index = 0
            if (index >= 0) {
              const row = candidates.splice(index, 1)[0]
              store.saveSuggestions(label, [row], '待处理', batch)
              const entry = pendingItem.get(batch, row.title, row.artist)
              if (!entry) continue
              if (!reserves.has(row)) freshSelected = true
              return entry.id
            }
            if (exhausted && !broadened && active.length) return
            // All idle workers share a single refill, while other workers keep their recordings.
            refilling ??= refill(represented, saved.length, work)
              .catch((error) => {
                refillError = error
                if (!work.aborted) update('running', '正在完成已开始处理的录音')
              })
              .finally(() => {
                refilling = undefined
              })
            await refilling
          }
        })
        signal.throwIfAborted()
        if (refillError && savedRows.all(batch).length < targetCount) throw refillError
        update(
          keepPartial ? 'partial' : 'completed',
          keepPartial ? '已保留直接相关的歌曲' : '已达到目标首数',
        )
      } catch (error) {
        if (!signal.aborted)
          update(
            'blocked',
            error.code ? '存储操作失败，请检查空间和目录权限后重试' : String(error.message),
          )
        else recordCancellation()
      } finally {
        signal.removeEventListener('abort', recordCancellation)
      }
      try {
        await catalogSync?.()
      } catch (error) {
        if (!signal.aborted) throw error
      }
      if (musicView && !musicView.isDestroyed()) musicView.send('music:sources-changed')
      return batch
    })
  })
  bind('stopGeneration', async () => {
    pending?.abort(new DOMException('手动终止', 'AbortError'))
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
    releaseGrant()
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
    if (!grant || grant.url !== text(url) || grant.audition || grant.controller) return
    store.library.heard(grant.libraryId ?? grant.id)
  })
  bind('release', (url) => {
    if (url !== undefined && grant?.url !== url) return
    releaseGrant()
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
        session.protocol.handle('fitbay-audio', (req) =>
          grant?.controller ? onlineStream(req, grant) : localStream(req, grant, store?.library),
        )
        session.protocol.handle('fitbay-plugin', (req) => plugins.resource(req))
        sessions.add(session)
      }
    },
    dispose(reason = '音乐组件已关闭') {
      collectionSearch?.abort()
      pending?.abort(new DOMException(reason, 'AbortError'))
      for (const generation of archiveJobs) generation.abort()
      overlay.show(false)
      lx.close()
      clearTimeout(updateTimer)
      taste?.controller?.abort()
      viewEpoch++
      releaseGrant()
      store?.library.cancel()
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
