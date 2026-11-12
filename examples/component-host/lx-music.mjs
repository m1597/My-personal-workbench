import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream, lstatSync, unlinkSync } from 'node:fs'
import { readFile, rm, lstat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { parseFile } from 'music-metadata'
import { runSource } from './lx-runtime.mjs'
import { sourceRequest, openPublic } from './lx-net.mjs'
import { verifyAudio } from './lx-audio-check.mjs'
import { pathKey, openAudio } from './music/local-files.mjs'
import { getMusicPreferences } from './music-preferences.mjs'
import { publish } from './music/store.mjs'

class TransferError extends Error {}
class RecordingError extends Error {
  constructor(kind, message) {
    super(message)
    this.kind = kind
  }
}
function permission(source, row) {
  const rights = [row.allowPermanentSave, row.permanentDownload, row.meta?.allowPermanentSave]
  if (source.permanentSave === false || rights.includes(false) || row.downloadable === false)
    return 'denied'
  if (row.trial || row.isPreview || row.freeTrialInfo) return 'preview'
  return source.permanentSave || rights.includes(true) ? 'granted' : 'unknown'
}
const explanations = {
  denied: '明确禁止永久保存',
  preview: '仅供试听',
  unknown: '未声明永久保存许可',
}
const text = (v) => (typeof v === 'string' ? v.trim().slice(0, 256) : '')
const qualities = ['128k', '192k', '320k', 'flac', 'flac24bit', 'hires']
async function fetchSource(link, signal) {
  if (typeof link !== 'string' || link.length > 8192 || !/^https?:\/\//i.test(link))
    throw Error('请输入 HTTP 或 HTTPS 音乐源直链')
  const timeout = AbortSignal.timeout(20000)
  try {
    const response = await openPublic(link, {
      signal: AbortSignal.any([signal, timeout]),
    })
    if (response.statusCode !== 200) {
      response.destroy()
      throw Error('无法读取音乐源，HTTP ' + response.statusCode)
    }
    const chunks = []
    let bytes = 0
    for await (const chunk of response) {
      bytes += chunk.length
      if (bytes > 1024 * 1024) throw Error('音乐源超过 1 MB')
      chunks.push(chunk)
    }
    return Buffer.concat(chunks).toString('utf8')
  } catch (error) {
    signal.throwIfAborted()
    if (timeout.aborted) throw Error('在线导入超时，请重试')
    if (error.code) throw Error('无法读取音乐源，请检查链接和网络')
    throw error
  }
}
export async function inspectSource(code, signal) {
  if (typeof code !== 'string' || Buffer.byteLength(code) > 1024 * 1024) throw Error('源文件过大')
  const declared = await runSource(code, null, signal)
  for (const platform of ['wy', 'kw', 'tx', 'kg', 'mg']) {
    const d = declared?.[platform]
    if (!Array.isArray(d?.actions) || !d.actions.includes('musicUrl')) continue
    if (!d.actions.includes('search') && platform !== 'wy') continue
    const quality = qualities.filter((q) => d.qualitys?.includes(q))
    if (!quality.length) continue
    return {
      code,
      name: text(code.match(/@name\s+([^\r\n*]+)/)?.[1]) || '自定义音乐源',
      platform,
      permissionsVersion: 1,
      permanentSave: [d.allowPermanentSave, d.permanentDownload].includes(false)
        ? false
        : [d.allowPermanentSave, d.permanentDownload].includes(true)
          ? true
          : undefined,
      search: d.actions.includes('search'),
      quality,
    }
  }
  throw Error('此源缺少可用的搜索平台、取址操作或音质')
}
async function versions(source, row, signal) {
  const keyword = [row.title, row.artist === '未知艺人' ? '' : row.artist].filter(Boolean).join(' ')
  if (source.search)
    return runSource(
      source.code,
      { action: 'search', source: source.platform, info: { keyword, limit: 20 } },
      signal,
    )
  let response
  try {
    response = await sourceRequest(
      'https://music.163.com/api/search/get?type=1&limit=20&s=' + encodeURIComponent(keyword),
      { signal },
    )
  } catch (e) {
    signal.throwIfAborted()
    throw new RecordingError('network', '无法连接在线目录，请检查网络后重试')
  }
  if (response.statusCode !== 200)
    throw new RecordingError(
      'network',
      '在线目录请求失败（HTTP ' + response.statusCode + '），请重试',
    )
  const songs = response.body?.result?.songs
  if (!Array.isArray(songs)) throw Error('在线目录暂时不可用')
  const grants = response.body.result.privileges ?? response.body.privileges
  const privileges = new Map(Array.isArray(grants) ? grants.map((p) => [String(p.id), p]) : [])
  return songs
    .filter((s) => s && s.id != null)
    .map((s) => {
      const flags = [s, s.meta, s.privilege, privileges.get(String(s.id))].filter(Boolean)
      const rights = flags.flatMap((f) => [f.allowPermanentSave, f.permanentDownload])
      return {
        name: s.name,
        singer: s.artists?.map((a) => a.name).join('/'),
        albumName: s.album?.name,
        id: String(s.id),
        songmid: String(s.id),
        source: 'wy',
        meta: { wy: { id: String(s.id) } },
        allowPermanentSave: rights.includes(false)
          ? false
          : rights.includes(true)
            ? true
            : undefined,
        trial: flags.some((f) => f.trial || f.isPreview || f.freeTrialInfo),
        downloadable: flags.some((f) => f.downloadable === false || f.dl === 0) ? false : undefined,
      }
    })
}
function extension(format) {
  if (format.container === 'FLAC') return '.flac'
  if (format.container === 'WAVE') return '.wav'
  if (format.container === 'MPEG' && /layer 3/i.test(format.codec ?? '')) return '.mp3'
  if (/M4A|isom|mp4/i.test(format.container ?? '') && /AAC|ALAC|MPEG-4/i.test(format.codec ?? ''))
    return '.m4a'
  throw Error('返回的文件不是支持的音频格式')
}
export function publishToLibrary(temp, row, store, version, dailyId) {
  const file = row.file
  const before = lstatSync(temp, { bigint: true })
  store.db.exec('BEGIN IMMEDIATE')
  let published = false
  try {
    store.library.upsert(row)
    if (version) {
      const local = store.db
        .prepare('SELECT id FROM local_tracks WHERE path_key=?')
        .get(pathKey(file)).id
      store.db
        .prepare(
          'INSERT OR REPLACE INTO recording_copies(version,local,automatic,source,platform,sourceId,quality,digest) VALUES(?,?,?,?,?,?,?,?)',
        )
        .run(
          version.key,
          local,
          Number(!!dailyId),
          version.source,
          version.platform,
          version.sourceId,
          version.quality,
          version.digest,
        )
      if (dailyId) markSaved(store, dailyId, local)
    }
    publish(temp, file)
    published = true
    store.db.exec('COMMIT')
  } catch (e) {
    if (store.db.isTransaction) store.db.exec('ROLLBACK')
    if (published) {
      const actual = lstatSync(file, { bigint: true, throwIfNoEntry: false })
      if (actual?.ino === before.ino && actual.dev === before.dev) unlinkSync(file)
    }
    throw e
  }
}
export async function saveRecording(url, dir, info, store, signal, auditionId, version, dailyId) {
  const temp = path.join(dir, '.fitbay-' + randomUUID() + '.part')
  try {
    const res = await openPublic(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(240000)]),
    })
    if (res.statusCode !== 200) {
      res.destroy()
      throw Error('音频服务器拒绝下载')
    }
    res.setTimeout(120000, () => res.destroy(new TransferError('音频传输超时，请稍后重试')))
    const hash = version && createHash('sha256')
    let size = 0
    const limit = new Transform({
      transform(chunk, _encoding, cb) {
        hash?.update(chunk)
        size += chunk.length
        if (size > 512 * 1024 * 1024) cb(Error('音频超过单曲大小限制'))
        else cb(null, chunk)
      },
    })
    try {
      await pipeline(res, limit, createWriteStream(temp, { flags: 'wx' }), { signal })
    } catch (error) {
      signal.throwIfAborted()
      if (
        ['ECONNRESET', 'ETIMEDOUT', 'ERR_STREAM_PREMATURE_CLOSE', 'ABORT_ERR'].includes(error.code)
      )
        throw new TransferError('音频传输中断，请稍后重试')
      throw error
    }
    const { format, common } = await parseFile(temp, { duration: true, skipCovers: true })
    if (!(Number.isFinite(format.duration) && format.duration > 0)) throw Error('音频时长无效')
    const name = (info.singer + ' - ' + info.name)
      .normalize()
      .replace(/[<>:"/\\|?*\p{Cc}]/gu, '_')
      .slice(0, 140)
      .trim()
      .replace(/[. ]+$/, '')
    let filename =
      (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name) ? '_' : '') +
      name +
      (dailyId ? ' - ' + version.key.slice(0, 12) : '') +
      extension(format)
    let file = path.join(dir, filename)
    signal.throwIfAborted()
    if (
      !auditionId &&
      (await lstat(file).then(
        () => true,
        (e) => {
          if (e.code === 'ENOENT') return false
          throw e
        },
      ))
    ) {
      if (!dailyId) throw Error('目标文件已存在，请选择其他目录')
      const ext = extension(format)
      filename = filename.slice(0, -ext.length) + '-' + randomUUID() + ext
      file = path.join(dir, filename)
    }
    await verifyAudio(temp, signal)
    signal.throwIfAborted()
    const metadata = {
      file,
      title: text(common.title) || info.name,
      artist: text(common.artist) || info.singer || '未知艺人',
      album: text(common.album) || text(info.albumName),
      duration: format.duration,
    }
    if (version) version.digest = hash.digest('hex')
    if (auditionId) store.cacheOnline(auditionId, temp, metadata, extension(format))
    else publishToLibrary(temp, metadata, store, version, dailyId)
    return filename
  } finally {
    await rm(temp, { force: true })
  }
}
function versionInfo(src, row, quality) {
  const id = row.songmid ?? row.id ?? row.hash ?? row.meta?.[src.platform]?.id
  if (!['number', 'string'].includes(typeof id) || !String(id).trim()) return null
  const key = createHash('sha256')
    .update(JSON.stringify([src.name, src.platform, String(id), quality]))
    .digest('hex')
  return { key, source: src.name, platform: src.platform, sourceId: String(id), quality }
}
async function verifiedCopy(store, version, signal) {
  const copies = store.db
    .prepare(`SELECT t.*,c.digest FROM recording_copies c JOIN local_tracks t ON t.id=c.local
    WHERE c.version=? AND c.digest IS NOT NULL ORDER BY c.automatic DESC`)
    .all(version)
  for (const row of copies) {
    if (!(await store.library.verify(row))) continue
    try {
      const handle = await openAudio(row.file)
      const before = await handle.stat({ bigint: true })
      const hash = createHash('sha256')
      for await (const chunk of handle.createReadStream({ signal })) hash.update(chunk)
      const after = await lstat(row.file, { bigint: true })
      if (
        before.dev === after.dev &&
        before.ino === after.ino &&
        before.mtimeNs === after.mtimeNs &&
        before.size === after.size &&
        hash.digest('hex') === row.digest &&
        store.db.prepare('SELECT 1 FROM local_tracks WHERE id=? AND file=?').get(row.id, row.file)
      )
        return row
    } catch {
      signal.throwIfAborted()
    }
  }
}
function markSaved(store, id, local) {
  store.db.prepare("UPDATE recommended_items SET local=?,error='',diagnosis='' WHERE item=?").run(local, id)
  store.status(id, '已入库')
}
export function registerLx(bind, getStore, dialog) {
  let active = null
  let activeScope
  const matches = new Map()
  const source = () => {
    const saved = getStore().get('lx-source')
    return saved ? JSON.parse(saved) : null
  }
  async function currentSource(signal) {
    const saved = getStore().get('lx-source')
    if (!saved) return null
    const current = JSON.parse(saved)
    if (current.permissionsVersion === 1) return current
    const parsed = await inspectSource(current.code, signal)
    signal.throwIfAborted()
    if (getStore().get('lx-source') !== saved) throw Error('音乐源已变更，请重试')
    getStore().set('lx-source', JSON.stringify(parsed))
    return parsed
  }
  const exclusive =
    (fn, scope) =>
    async (...args) => {
      if (active && !active.signal.aborted) throw Error('请等待当前音乐源操作完成')
      const task = new AbortController()
      active = task
      activeScope = scope
      try {
        return await fn(task.signal, ...args)
      } finally {
        if (active === task) active = null
      }
    }
  bind('lxInfo', () => source()?.name ?? '')
  bind(
    'lxImport',
    exclusive(async (signal, link) => {
      let code
      if (link !== undefined) code = await fetchSource(link, signal)
      else {
        const file = await dialog.showOpenDialog({
          title: '导入洛雪音乐源',
          properties: ['openFile'],
          filters: [{ name: '洛雪音乐源', extensions: ['js'] }],
        })
        if (file.canceled) return
        const selected = file.filePaths[0],
          stat = await lstat(selected)
        if (!stat.isFile() || stat.size > 1024 * 1024) throw Error('请选择 1 MB 以内的 JS 源文件')
        code = await readFile(selected, 'utf8')
      }
      const next = await inspectSource(code, signal)
      signal.throwIfAborted()
      getStore().set('lx-source', JSON.stringify(next))
      matches.clear()
    }, 'import'),
  )
  bind(
    'lxSearch',
    exclusive(async (signal, id) => {
      const src = source()
      if (!src) throw Error('请先导入洛雪音乐源')
      let track
      if (typeof id === 'string') {
        track = id.startsWith('local-') ? getStore().library.row(id) : getStore().item(id)
      } else if (
        typeof id?.title === 'string' &&
        id.title.length <= 256 &&
        typeof id.artist === 'string' &&
        id.artist.length <= 256 &&
        (id.title.trim() || id.artist.trim())
      ) {
        track = { title: id.title.trim(), artist: id.artist.trim() }
      }
      if (!track) throw Error('无效曲目')
      matches.clear()
      const rows = await versions(src, track, signal)
      signal.throwIfAborted()
      if (!Array.isArray(rows)) throw Error('源返回了无效的版本列表')
      const items = []
      for (const row of rows.slice(0, 30)) {
        if (!text(row?.name) || JSON.stringify(row).length > 16384) continue
        const key = randomUUID()
        matches.set(key, {
          row,
          auditionId: typeof id === 'string' && !id.startsWith('local-') ? id : null,
        })
        items.push({
          key,
          title: text(row.name),
          artist: text(row.singer),
          album: text(row.albumName),
        })
      }
      return { items, quality: src.quality }
    }),
  )
  async function transfer(signal, key, quality, auditionId) {
    const src = source(),
      match = matches.get(key),
      row = match?.row
    if (
      !src ||
      !row ||
      !src.quality.includes(quality) ||
      (auditionId && match.auditionId !== auditionId)
    )
      throw Error('请重新选择版本和音质')
    let dir = getStore().cache
    if (!auditionId) {
      dir = getMusicPreferences(getStore()).manualDir
      if (!dir) {
        const folder = await dialog.showOpenDialog({
          title: '选择歌曲下载文件夹',
          properties: ['openDirectory', 'createDirectory'],
        })
        if (folder.canceled) return ''
        dir = folder.filePaths[0]
      }
    } else {
      const item = getStore().item(auditionId)
      if (item.status !== '模型推荐' && !item.track?.startsWith('online-'))
        throw Error('推荐曲目无效')
    }
    signal.throwIfAborted()
    return fetchRecording(src, row, quality, dir, signal, auditionId)
  }
  async function fetchRecording(src, row, quality, dir, signal, auditionId, dailyId) {
    for (let attempt = 0; ; attempt++) {
      const url = await runSource(
        src.code,
        { action: 'musicUrl', source: src.platform, info: { type: quality, musicInfo: row } },
        signal,
      )
      if (typeof url !== 'string' || url.length > 16384) throw Error('音乐源未返回可用地址')
      try {
        return await saveRecording(
          url,
          dir,
          { name: text(row.name), singer: text(row.singer), albumName: text(row.albumName) },
          getStore(),
          signal,
          auditionId,
          versionInfo(src, row, quality),
          dailyId,
        )
      } catch (e) {
        if (attempt > 0 || !(e instanceof TransferError)) throw e
        signal.throwIfAborted()
      }
    }
  }
  bind(
    'lxDownload',
    exclusive((signal, key, quality) => transfer(signal, key, quality)),
  )
  bind(
    'lxPreview',
    exclusive((signal, id, key, quality) => {
      if (typeof id !== 'string' || !id) throw Error('推荐曲目无效')
      return transfer(signal, key, quality, id)
    }),
  )
  const choices = new Map()
  const running = new Map()
  async function prepare(id, selected) {
    const store = getStore()
    if (!store.db.prepare('SELECT item FROM recommended_items WHERE item=?').get(id))
      throw Error('无效推荐记录')
    if (running.has(id)) return
    const task = new AbortController()
    running.set(id, task)
    const { signal } = task
    try {
      const src = await currentSource(signal)
      if (!src) throw new RecordingError('source', '尚未导入音乐源')
      const prefs = getMusicPreferences(store)
      const quality = src.quality.includes(prefs.quality)
        ? prefs.quality
        : src.quality.includes('320k')
          ? '320k'
          : src.quality[0]
      const item = store.item(id)
      let pick
      if (selected) {
        const saved = choices.get(id)
        if (
          saved?.sourceCode !== src.code ||
          saved.quality !== quality ||
          !saved.rows.has(selected)
        )
          throw Error('候选已变更，请重试')
        pick = saved.rows.get(selected)
      } else {
        store.status(id, '正在匹配')
        const hits = await versions(src, item, signal)
        signal.throwIfAborted()
        if (!Array.isArray(hits)) throw Error('音乐源返回的结果无效')
        const candidates = new Map()
        const reasons = new Set()
        const normalize = (v) => v.trim().normalize('NFKC').toLowerCase()
        const same = (a, b) => normalize(a) === normalize(b)
        const title = normalize(item.title)
        for (const row of hits.slice(0, 30)) {
          if (!row || !text(row.name) || !text(row.singer) || JSON.stringify(row).length > 16384)
            continue
          const name = normalize(row.name)
          if (
            name !== title &&
            !(name.startsWith(title) && /^[\s(（\[【-]/u.test(name.slice(title.length)))
          )
            continue
          const key = versionInfo(src, row, quality)?.key
          if (!key) continue
          const right = permission(src, row)
          if (right === 'granted') candidates.set(key, row)
          else reasons.add(right)
        }
        if (!candidates.size) {
          if (!reasons.size) throw new RecordingError('missing', '没有找到与歌名匹配的录音')
          const message = [...reasons].map((k) => explanations[k]).join('、')
          throw new RecordingError(
            reasons.size === 1 ? [...reasons][0] : 'mixed',
            '匹配录音：' + message,
          )
        }
        const exact = [...candidates.values()].filter(
          (row) => same(row.name, item.title) && same(row.singer, item.artist),
        )
        if (exact.length !== 1) {
          choices.set(id, { sourceCode: src.code, quality, rows: candidates })
          store.status(id, '待选录音')
          return
        }
        pick = exact[0]
      }
      const version = versionInfo(src, pick, quality).key
      const cached = await verifiedCopy(store, version, signal)
      if (cached) {
        signal.throwIfAborted()
        markSaved(store, id, cached.id)
      } else {
        if (!prefs.recommendDir) throw Error('请在设置中选择推荐下载目录')
        store.status(id, '正在保存')
        await fetchRecording(src, pick, quality, prefs.recommendDir, signal, undefined, id)
      }
      choices.delete(id)
    } catch (e) {
      store.db
        .prepare('UPDATE recommended_items SET error=?,diagnosis=? WHERE item=?')
        .run(
          String(e.code ? '保存失败，请检查目录与网络' : e.message).slice(0, 200),
          e.kind ?? (e instanceof TransferError ? 'network' : 'other'),
          id,
        )
      store.status(id, '待重试')
    } finally {
      running.delete(id)
    }
  }
  bind('prepareRecommendation', (id, key) => {
    if (typeof id !== 'string' || (key !== undefined && typeof key !== 'string'))
      throw Error('无效录音')
    return prepare(id, key)
  })
  bind('recommendationChoices', (id) => {
    if (typeof id !== 'string') throw Error('无效录音')
    return [...(choices.get(id)?.rows ?? [])].map(([key, v]) => ({
      key,
      title: text(v.name),
      artist: text(v.singer),
      album: text(v.albumName),
    }))
  })
  bind('lxCancel', (scope) => {
    if (scope === undefined || (scope === 'import' && activeScope === 'import')) active?.abort()
  })
  let generation = 0
  let processing = Promise.resolve()
  return {
    batch(batch) {
      const epoch = generation
      const ids = getStore().db.prepare('SELECT id FROM items WHERE batch=?').all(batch)
      processing = processing
        .then(async () => {
          for (const { id } of ids) {
            if (epoch !== generation) break
            await prepare(id)
          }
        })
        .catch(() => {})
    },
    close() {
      generation++
      for (const task of running.values()) task.abort()
      active?.abort()
      matches.clear()
      choices.clear()
      getStore()
        ?.db.prepare(
          "UPDATE items SET status='待重试' WHERE id IN (SELECT item FROM recommended_items) AND status IN ('正在匹配','正在保存','待处理','待选录音')",
        )
        .run()
    },
  }
}
