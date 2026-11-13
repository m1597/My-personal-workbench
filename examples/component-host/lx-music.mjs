import { catalogId, readSourceLink, inspectSource, sourceCatalog } from './lx-source-catalog.mjs'
import {
  titleMatch,
  artistMatches,
  inLibrary,
  searchRecommendation,
  recordingPreference,
  recordingDisplayTitle,
  namesRequestedArtist,
} from './music-discovery.mjs'
import { CatalogUnavailable, platformSearch } from './lx-platform-search.mjs'
import { describeFailure } from './music-download-diagnosis.mjs'
export { inspectSource } from './lx-source-catalog.mjs'
import { publishDaily } from './music-recording-identity.mjs'
import { saveLyrics } from './music-lyrics.mjs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream, lstatSync, unlinkSync } from 'node:fs'
import { readFile, rm, lstat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { parseFile } from 'music-metadata'
import { runSource, SourceRequestError } from './lx-runtime.mjs'
import { sourceRequest, openPublic } from './lx-net.mjs'
import { verifyAudio, AudioDecodeError } from './lx-audio-check.mjs'
import { pathKey, openAudio } from './music/local-files.mjs'
import { albumTags } from './music/albums.mjs'
import { getMusicPreferences } from './music-preferences.mjs'
import { publish } from './music/store.mjs'

class SourceDownloadError extends Error {}
class TransferError extends SourceDownloadError {}
class TransferDeadline extends TransferError {}
class InvalidAudio extends SourceDownloadError {
  kind = 'unusable'
}
class RecordingError extends Error {
  constructor(kind, message) {
    super(message)
    this.kind = kind
  }
}
// Each source can stop waiting independently. Abort the underlying query when its last reader leaves.
async function sharedQuery(cache, key, signal, read) {
  signal.throwIfAborted()
  let entry = cache.get(key)
  if (!entry) {
    const controller = new AbortController()
    entry = { controller, readers: 0, done: false }
    cache.set(key, entry)
    entry.result = read(controller.signal).then(
      (data) => {
        entry.done = true
        if (cache.size > 128) {
          for (const [oldKey, value] of cache) {
            if (value.done) cache.delete(oldKey)
            if (cache.size <= 128) break
          }
        }
        return data
      },
      (error) => {
        if (cache.get(key) === entry) cache.delete(key)
        throw error
      },
    )
  }
  entry.readers++
  let abort
  try {
    return await Promise.race([
      entry.result,
      new Promise((_, reject) => {
        abort = () => reject(signal.reason)
        signal.addEventListener('abort', abort, { once: true })
      }),
    ])
  } finally {
    signal.removeEventListener('abort', abort)
    if (!--entry.readers && !entry.done) {
      if (cache.get(key) === entry) cache.delete(key)
      entry.controller.abort()
    }
  }
}
// Search and permission probes are read-only. Only the consumer of a match can publish.
async function* availableSources(sources, probe, signal, parallel) {
  const controller = new AbortController()
  const searchSignal = AbortSignal.any([signal, controller.signal])
  const pending = new Map()
  let next = 0
  function start() {
    const index = next++
    const src = sources[index]
    pending.set(
      index,
      Promise.resolve()
        .then(() => probe(src, searchSignal))
        .then(
          (candidate) => ({ index, src, candidate }),
          (error) => ({ index, src, error }),
        ),
    )
  }
  try {
    while (next < sources.length || pending.size) {
      signal.throwIfAborted()
      if (!pending.size) start()
      // Give the selected source a head start. Fast successful requests usually need no alternatives.
      let timer
      const contenders = [...pending.values()]
      if (next < sources.length && pending.size < parallel)
        contenders.push(
          new Promise((resolve) => {
            timer = setTimeout(resolve, 150)
          }),
        )
      let result
      try {
        result = await Promise.race(contenders)
      } finally {
        clearTimeout(timer)
      }
      signal.throwIfAborted()
      if (!result) {
        start()
        continue
      }
      pending.delete(result.index)
      yield result
    }
  } finally {
    controller.abort()
    await Promise.all(pending.values())
  }
}
function failureKind(error) {
  if (error.kind) return error.kind
  if (error instanceof CatalogUnavailable) return 'network'
  if (error instanceof SourceDownloadError) return 'download'
  if (error instanceof SourceRequestError) return 'source-request'
  return error.code ? 'storage' : 'other'
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
function recordingQualities(source, row) {
  if (source.search || !['tx', 'kg'].includes(source.platform) || !Array.isArray(row.types))
    return source.quality
  return source.quality.filter((q) => row.types?.some((t) => t.type === q))
}
async function versions(source, row, signal, limit = 20, page = 1, offset = 0) {
  const keyword = [row.title, row.artist === '未知艺人' ? '' : row.artist].filter(Boolean).join(' ')
  if (source.search)
    return runSource(
      source.code,
      {
        action: 'search',
        source: source.platform,
        info: { keyword, limit, page, offset },
      },
      signal,
    )
  if (source.platform === 'tx' || source.platform === 'kg')
    return platformSearch(source.platform, keyword, page, limit, signal)
  let response
  try {
    response = await sourceRequest(
      `https://music.163.com/api/search/get?type=1&limit=${limit}&offset=${offset}&s=` +
        encodeURIComponent(keyword),
      { signal },
    )
  } catch {
    signal.throwIfAborted()
    throw new RecordingError('network', '无法连接在线目录，请检查网络后重试')
  }
  if (response.statusCode !== 200)
    throw new RecordingError(
      'network',
      '在线目录请求失败（HTTP ' + response.statusCode + '），请重试',
    )
  const songs = response.body?.result?.songs
  if (!Array.isArray(songs)) throw new RecordingError('network', '在线目录暂时不可用')
  const grants = response.body.result.privileges ?? response.body.privileges
  const privileges = new Map(Array.isArray(grants) ? grants.map((p) => [String(p.id), p]) : [])
  return songs
    .filter((s) => s && s.id != null)
    .map((s) => {
      const flags = [s, s.meta, s.privilege, privileges.get(String(s.id))].filter(Boolean)
      const rights = flags.flatMap((f) => [f.allowPermanentSave, f.permanentDownload])
      return {
        name: s.name,
        titleAliases: [
          ...(Array.isArray(s.alias) ? s.alias : []),
          ...(Array.isArray(s.transNames) ? s.transNames : []),
        ].filter((v) => typeof v === 'string'),
        singer: s.artists?.map((a) => a.name).join('/'),
        artistAliases: s.artists?.map((a) =>
          [a.name, ...(a.alias ?? []), a.trans].filter((v) => typeof v === 'string'),
        ),
        albumName: s.album?.name,
        durationSeconds: Number(s.duration) / 1000,
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
// A playback bitrate and a maximum catalog bitrate are not download entitlements.
async function freeDownloadQualities(ids, signal) {
  const result = new Map()
  const query = encodeURIComponent(JSON.stringify(ids.map((id) => ({ id }))))
  let response
  try {
    response = await sourceRequest('https://music.163.com/api/v3/song/detail?c=' + query, {
      signal,
    })
  } catch {
    signal.throwIfAborted()
    throw new RecordingError('network', '无法核实网易云录音下载权限')
  }
  if (response.statusCode !== 200)
    throw new RecordingError('network', '权限查询失败（HTTP ' + response.statusCode + '）')
  for (const grant of response.body?.privileges ?? []) {
    if (!ids.includes(String(grant.id))) continue
    const free = []
    if (grant.code === 0 && grant.st === 0 && grant.fee === 0 && grant.dl > 0 && !grant.preSell) {
      for (const [quality, rate] of [
        ['128k', 128000],
        ['320k', 320000],
        ['flac', 999000],
      ]) {
        if (
          grant.dl >= rate &&
          grant.chargeInfoList?.some((r) => r.rate === rate && r.chargeType === 0)
        )
          free.push(quality)
      }
    }
    if (free.length || grant.dl === 0) result.set(String(grant.id), free)
  }
  return result
}
function searchRows(page) {
  const rows = Array.isArray(page) ? page : (page?.items ?? page?.list ?? page?.songs)
  if (!Array.isArray(rows)) throw Error('源返回了无效的版本列表')
  return rows
}
async function downloadResults(source, track, signal) {
  const results = []
  const seen = new Set()
  const pages = new Set()
  let offset = 0
  for (let page = 1; page <= 50 && results.length < 50; page++) {
    let data
    try {
      data = await versions(source, track, signal, 50, page, offset)
    } catch (error) {
      signal.throwIfAborted()
      if (results.length && error instanceof CatalogUnavailable)
        return { rows: results, partial: true }
      throw error
    }
    signal.throwIfAborted()
    const rows = searchRows(data)
    if (!rows.length) break
    const signature = createHash('sha256').update(JSON.stringify(rows)).digest('hex')
    if (pages.has(signature)) break
    pages.add(signature)
    for (const row of rows) {
      if (
        !text(row?.name) ||
        (row.source && row.source !== source.platform) ||
        JSON.stringify(row).length > 16384
      )
        continue
      const identity = JSON.stringify([
        row.source ?? source.platform,
        recordingId(source, row) ?? row,
      ])
      if (seen.has(identity)) continue
      seen.add(identity)
      results.push(row)
      if (results.length === 50) break
    }
    offset += rows.length
    if (data.hasMore === false || (Number.isFinite(data.total) && offset >= data.total)) break
  }
  return { rows: results, partial: false }
}
function extension(format) {
  if (format.container === 'FLAC') return '.flac'
  if (format.container === 'WAVE') return '.wav'
  if (format.container === 'MPEG' && /layer 3/i.test(format.codec ?? '')) return '.mp3'
  if (/M4A|isom|mp4/i.test(format.container ?? '') && /AAC|ALAC|MPEG-4/i.test(format.codec ?? ''))
    return '.m4a'
  throw new InvalidAudio('返回的文件不是支持的音频格式')
}
function rememberCopy(store, version, local, automatic) {
  if (automatic && version.source && version.platform)
    store.db
      .prepare('INSERT OR REPLACE INTO recent_daily_sources VALUES(?,?)')
      .run(version.source, version.platform)
  store.db
    .prepare(
      'INSERT OR REPLACE INTO recording_copies(version,local,automatic,source,platform,sourceId,quality,digest) VALUES(?,?,?,?,?,?,?,?)',
    )
    .run(
      version.key,
      local,
      Number(automatic),
      version.source,
      version.platform,
      version.sourceId,
      version.quality,
      version.digest,
    )
}
export function publishToLibrary(temp, row, store, version, dailyId) {
  const file = row.file
  const before = lstatSync(temp, { bigint: true })
  store.db.exec('BEGIN IMMEDIATE')
  let published = false
  try {
    store.library.upsert({
      ...row,
      size: Number(before.size),
      identity: [before.dev, before.ino, before.birthtimeNs].join(':'),
    })
    store.db
      .prepare('UPDATE local_tracks SET importedOrigin=? WHERE path_key=?')
      .run(dailyId ? 'daily' : 'download', pathKey(file))
    if (version) {
      const local = store.db
        .prepare('SELECT id FROM local_tracks WHERE path_key=?')
        .get(pathKey(file)).id
      rememberCopy(store, version, local, !!dailyId)
      if (dailyId) {
        markSaved(store, dailyId, local)
        store.db
          .prepare(`INSERT INTO daily_downloads(local,batch,file,digest,identity)
          SELECT ?,batch,?,?,? FROM items WHERE id=?
          ON CONFLICT(local) DO UPDATE SET batch=excluded.batch,file=excluded.file,
          digest=excluded.digest,identity=excluded.identity`)
          .run(
            local,
            file,
            version.digest,
            [before.dev, before.ino, before.birthtimeNs].join(':'),
            dailyId,
          )
      }
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
    const connection = new AbortController()
    const deadline = AbortSignal.timeout(240000)
    const connectionTimer = setTimeout(() => connection.abort(), 12000)
    const res = await openPublic(url, {
      signal: AbortSignal.any([signal, connection.signal, deadline]),
    })
      .catch((error) => {
        signal.throwIfAborted()
        if (connection.signal.aborted || deadline.aborted)
          throw new TransferDeadline('连接音频服务器超时')
        throw new SourceDownloadError(error.message)
      })
      .finally(() => clearTimeout(connectionTimer))
    if (res.statusCode !== 200) {
      res.destroy()
      throw new SourceDownloadError('音频服务器拒绝下载（HTTP ' + res.statusCode + '）')
    }
    res.setTimeout(dailyId ? 10000 : 120000, () =>
      res.destroy(new TransferError('音频传输超时，请稍后重试')),
    )
    const hash = version && createHash('sha256')
    let size = 0
    const limit = new Transform({
      transform(chunk, _encoding, cb) {
        hash?.update(chunk)
        size += chunk.length
        if (size > 512 * 1024 * 1024) cb(new InvalidAudio('音频超过单曲大小限制'))
        else cb(null, chunk)
      },
    })
    try {
      await pipeline(res, limit, createWriteStream(temp, { flags: 'wx' }), {
        signal,
      })
    } catch (error) {
      signal.throwIfAborted()
      if (deadline.aborted) throw new TransferDeadline('完整录音未能在传输时限内下载')
      if (
        ['ECONNRESET', 'ETIMEDOUT', 'ERR_STREAM_PREMATURE_CLOSE', 'ABORT_ERR'].includes(error.code)
      )
        throw new TransferError('音频传输中断，请稍后重试')
      throw error
    }
    if (version) version.digest = hash.digest('hex')
    if (dailyId) store.status(dailyId, '正在校验')
    if (dailyId && store.ignoresRecording('content', version.digest)) {
      store.status(dailyId, '已跳过')
      return ''
    }
    const { format, common } = await parseFile(temp, {
      duration: true,
      skipCovers: true,
    }).catch((error) => {
      if (error.syscall) throw error
      throw new InvalidAudio('返回的文件不是有效音频')
    })
    if (!(Number.isFinite(format.duration) && format.duration > 0))
      throw new InvalidAudio('音频时长无效')
    if (
      dailyId &&
      Number.isFinite(info.durationSeconds) &&
      info.durationSeconds > 0 &&
      Math.abs(info.durationSeconds - format.duration) > Math.max(3, info.durationSeconds * 0.025)
    )
      throw new InvalidAudio('音频时长与所选完整录音不符')
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
    await verifyAudio(temp, signal).catch((error) => {
      if (error instanceof AudioDecodeError) throw new InvalidAudio(error.message)
      throw error
    })
    signal.throwIfAborted()
    const metadata = {
      file,
      title: (dailyId && info.name) || text(common.title) || info.name,
      artist: (dailyId && info.singer) || text(common.artist) || info.singer || '未知艺人',
      album: (dailyId && text(info.albumName)) || text(common.album) || text(info.albumName),
      ...albumTags(common),
      duration: format.duration,
      language: text(common.language),
    }

    if (auditionId) store.cacheOnline(auditionId, temp, metadata, extension(format))
    else if (dailyId) {
      let published = false
      const match = await publishDaily(
        store,
        temp,
        size,
        format.duration,
        version.digest,
        signal,
        () => {
          // A sibling candidate can finish after preflight, even with different encoded bytes.
          const siblings = store.db
            .prepare(
              `SELECT t.title,t.artist,c.platform,c.sourceId FROM items current
             JOIN recommendation_runs run ON run.batch=current.batch
             JOIN items i ON i.batch=current.batch AND i.id!=current.id
             JOIN recommended_items r ON r.item=i.id JOIN local_tracks t ON t.id=r.local
             LEFT JOIN recording_copies c ON c.local=t.id WHERE current.id=?`,
            )
            .all(dailyId)
          if (
            siblings.some(
              (r) => r.platform === version.platform && r.sourceId === version.sourceId,
            ) ||
            inLibrary(metadata, siblings)
          ) {
            store.db
              .prepare(
                "UPDATE recommended_items SET error='本批已有同一录音',diagnosis='duplicate' WHERE item=?",
              )
              .run(dailyId)
            store.status(dailyId, '已在曲库')
            return
          }
          publishToLibrary(temp, metadata, store, version, dailyId)
          published = true
        },
      )
      if (match) {
        if (
          store.db
            .prepare('SELECT 1 FROM recommended_items WHERE item=? AND local=?')
            .get(dailyId, match.local)
        ) {
          if (match.kind === 'SHA-256') rememberCopy(store, version, match.local, true)
          markSaved(store, dailyId, match.local)
          return ''
        }
        store.db
          .prepare("UPDATE recommended_items SET error=?,diagnosis='duplicate' WHERE item=?")
          .run('本地曲库已有相同录音（' + match.kind + '）', dailyId)
        store.status(dailyId, '已在曲库')
        return ''
      }
      if (!published) return ''
    } else publishToLibrary(temp, metadata, store, version)
    return filename
  } finally {
    await rm(temp, { force: true })
  }
}
function recordingId(src, row) {
  const id =
    (src.platform === 'kg' && !src.search ? row.hash : undefined) ??
    row.songmid ??
    row.id ??
    row.hash ??
    row.meta?.[src.platform]?.id
  return ['number', 'string'].includes(typeof id) && String(id).trim() ? String(id) : null
}
// Persist LX recording identifiers only. A provider may put signed URLs in arbitrary search fields.
function durableRecording(src, row) {
  const out = {
    source: src.platform,
    name: text(row.name),
    singer: text(row.singer),
    albumName: text(row.albumName),
  }
  const identifier = (v) =>
    (typeof v === 'number' && Number.isFinite(v)) ||
    (typeof v === 'string' && /^[\p{L}\p{N}._:-]{1,256}$/u.test(v))
  for (const key of [
    'id',
    'songmid',
    'songId',
    'strMediaMid',
    'albumId',
    'albumMid',
    'albumAudioId',
    'hash',
    'interval',
    'durationSeconds',
    '_interval',
  ])
    if (identifier(row[key])) out[key] = row[key]
  const metaId = row.meta?.[src.platform]?.id
  if (identifier(metaId)) out.meta = { [src.platform]: { id: metaId } }
  if (Array.isArray(row.types)) {
    out.types = row.types
      .filter((t) => src.quality.includes(t?.type))
      .map((t) => (identifier(t.hash) ? { type: t.type, hash: t.hash } : { type: t.type }))
    out._types = Object.fromEntries(out.types.map(({ type, ...info }) => [type, info]))
  }
  return out
}
function versionInfo(src, row, quality) {
  const id = recordingId(src, row)
  if (id === null) return null
  const key = createHash('sha256')
    .update(JSON.stringify([src.name, src.platform, String(id), quality]))
    .digest('hex')
  return {
    key,
    source: src.name,
    platform: src.platform,
    sourceId: String(id),
    quality,
  }
}
async function verifiedCopy(store, version, signal) {
  const copies = store.db
    .prepare(
      `SELECT t.*,c.digest FROM recording_copies c JOIN local_tracks t ON t.id=c.local
    WHERE c.version=? AND c.digest IS NOT NULL ORDER BY c.automatic DESC`,
    )
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
  const update = store.db
    .prepare("UPDATE recommended_items SET local=?,error='',diagnosis='',summary='' WHERE item=?")
    .run(local, id)
  if (!update.changes) throw Error('推荐已过期')
  store.status(id, '已入库')
}
export function registerLx(bind, getStore, dialog, lyricsSaved) {
  let transferRates
  const sourceKey = (src) => JSON.stringify([src.name, src.platform])
  let active = null
  let activeScope
  const matches = new Map()
  const source = () => {
    const saved = getStore().get('lx-source')
    return saved ? JSON.parse(saved) : null
  }
  async function currentSource(signal, withPlatforms = false) {
    const saved = getStore().get('lx-source')
    if (!saved) return null
    const current = JSON.parse(saved)
    if (current.permissionsVersion === 1 && (!withPlatforms || current.catalogVersion === 2))
      return current
    const parsed = await inspectSource(current.code, signal, current.platform)
    signal.throwIfAborted()
    if (getStore().get('lx-source') !== saved) throw Error('音乐源已变更，请重试')
    catalog().install(parsed, null, true)
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
  let bank
  const catalog = () => {
    if (!bank) {
      const { db } = getStore()
      bank = sourceCatalog(db)
      // Adopt a baseline for failures from releases that did not save the attempted sources.
      db.prepare(
        "UPDATE recommended_items SET attemptSources=? WHERE attemptSources='' AND diagnosis!='' AND item IN (SELECT id FROM items WHERE status='待重试')",
      ).run(bank.configuration())
    }
    return bank
  }
  bind('lxSources', async () => {
    await catalog().upgrade()
    return { ...catalog().list(), configuration: catalog().configuration() }
  })
  bind(
    'lxRefreshCatalog',
    exclusive((signal) => catalog().refresh(signal), 'import'),
  )
  bind(
    'lxImportSelected',
    exclusive((signal, ids) => catalog().importSelected(ids, signal), 'import'),
  )
  bind('lxSelectSource', (id) => {
    catalog().select(id)
    matches.clear()
  })
  bind('lxInfo', () => source()?.name ?? '')
  bind(
    'lxImport',
    exclusive(async (signal, link) => {
      let code
      if (link !== undefined) code = await readSourceLink(link, signal)
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
      catalog().install(next, catalogId(link), true)
      matches.clear()
    }, 'import'),
  )
  bind(
    'lxSearch',
    exclusive(async (signal, id, platform) => {
      const selected = await currentSource(signal, platform !== undefined)
      if (!selected) throw Error('请先导入洛雪音乐源')
      const names = { wy: '网易云音乐', tx: 'QQ 音乐', kg: '酷狗音乐' }
      if (platform !== undefined && !Object.hasOwn(names, platform)) throw Error('无效的下载平台')
      if (platform && !selected.platforms?.[platform])
        throw Error('当前音乐源不支持' + names[platform] + '的搜索和下载，请更换音乐源')
      const src = platform ? { ...selected, ...selected.platforms[platform] } : selected
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
      const audition = typeof id === 'string' && !id.startsWith('local-')
      const { rows, partial } = audition
        ? {
            rows: searchRows(await versions(src, track, signal)),
            partial: false,
          }
        : await downloadResults(src, track, signal)
      signal.throwIfAborted()
      if (!Array.isArray(rows)) throw Error('源返回了无效的版本列表')
      const items = []
      for (const row of audition ? rows.slice(0, 20) : rows) {
        if (!text(row?.name) || JSON.stringify(row).length > 16384) continue
        const key = randomUUID()
        matches.set(key, {
          sourceCode: src.code,
          platform: src.platform,
          query: { title: track.title, artist: track.artist },
          row,
          auditionId: typeof id === 'string' && !id.startsWith('local-') ? id : null,
        })
        items.push({
          key,
          title: text(row.name),
          artist: text(row.singer),
          album: text(row.albumName),
          quality: recordingQualities(src, row),
        })
      }
      return { items, quality: src.quality, partial }
    }),
  )
  const onlineRows = new Map()
  function onlineDatabase() {
    const { db } = getStore()
    db.exec(`CREATE TABLE IF NOT EXISTS online_recording_sources (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, platform TEXT NOT NULL, recording TEXT NOT NULL,
      quality TEXT NOT NULL, query TEXT NOT NULL, identifiers TEXT NOT NULL)`)
    return db
  }
  bind('rememberOnline', (key, quality) => {
    const match = matches.get(key)
    const selected = source()
    if (!match || match.auditionId || selected?.code !== match.sourceCode)
      throw Error('请重新搜索并选择录音')
    const src = { ...selected, ...selected.platforms?.[match.platform] }
    const row = match.row
    const recording = recordingId(src, row)
    const qualities = recordingQualities(src, row)
    if (quality === undefined) {
      const preferred = getMusicPreferences(getStore()).quality
      quality = qualities.includes(preferred) ? preferred : qualities[0]
    }
    if (!recording || !/^[\p{L}\p{N}._:-]{1,256}$/u.test(recording) || !qualities.includes(quality))
      throw Error('此版本没有可用的录音标识或音质')
    const sourceId = catalog().list().active
    if (!sourceId) throw Error('请重新选择音乐源')
    const id =
      'online-recording-' +
      createHash('sha256')
        .update(JSON.stringify([sourceId, src.platform, recording]))
        .digest('hex')
    const db = onlineDatabase()
    db.exec('BEGIN')
    try {
      db.prepare(`INSERT INTO online_recording_sources VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET quality=excluded.quality,query=excluded.query,identifiers=excluded.identifiers`).run(
        id,
        sourceId,
        src.platform,
        recording,
        quality,
        JSON.stringify(match.query),
        JSON.stringify(durableRecording(src, row)),
      )
      getStore().library.rememberOnline({
        id,
        title: text(row.name),
        artist: text(row.singer),
        album: text(row.albumName),
        duration: Number.isFinite(row.durationSeconds) ? row.durationSeconds : 0,
      })
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    onlineRows.delete(id)
    onlineRows.set(id, row)
    if (onlineRows.size > 64) onlineRows.delete(onlineRows.keys().next().value)
    return id
  })
  async function transfer(signal, key, quality, auditionId, detailed = false) {
    const selected = source()
    const match = matches.get(key)
    const src = selected && {
      ...selected,
      ...selected.platforms?.[match?.platform],
    }
    const row = match?.row
    if (
      !src ||
      !row ||
      match.sourceCode !== src.code ||
      !recordingQualities(src, row).includes(quality) ||
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
    if (auditionId) return fetchRecording(src, row, quality, dir, signal, auditionId)
    await catalog().upgrade()
    const eligible = recordingId(src, row) && !['denied', 'preview'].includes(permission(src, row))
    const candidates = [
      src,
      ...(eligible
        ? catalog()
            .alternatives(src.platform, quality, src.code)
            .filter((candidate) => !['denied', 'preview'].includes(permission(candidate, row)))
        : []),
    ]
    const tried = []
    const reasons = []
    const resolve = async (candidate, probeSignal) => {
      tried.push(candidate.name)
      return recordingAddress(candidate, row, quality, probeSignal)
    }
    for await (const { src: candidate, candidate: url, error } of availableSources(
      candidates,
      resolve,
      signal,
      2,
    )) {
      try {
        if (error) throw error
        const file = await fetchRecording(
          candidate,
          row,
          quality,
          dir,
          signal,
          undefined,
          undefined,
          url,
        )
        return detailed ? { file, sources: tried } : file
      } catch (error) {
        signal.throwIfAborted()
        if (!(error instanceof SourceDownloadError)) throw error
        reasons.push(candidate.name + '：' + error.message)
      }
    }
    signal.throwIfAborted()
    throw Error(
      reasons.join('；') +
        (reasons.length === 1 ? '。没有其他可用的已导入音乐源。' : '。已尝试所有可用音乐源。'),
    )
  }
  async function saveRecordingLyrics(src, row, audio, signal) {
    const saved = await saveLyrics(getStore().db, audio, async () => {
      const timeout = AbortSignal.any([signal, AbortSignal.timeout(6000)])
      let result = row.lyric
      if (!result) {
        try {
          result = await runSource(
            src.code,
            {
              action: 'lyric',
              source: src.platform,
              info: { musicInfo: row },
            },
            timeout,
          )
        } catch {
          /* Some sources expose only audio. */
        }
      }
      const raw = typeof result === 'string' ? result : result?.lyric
      if (raw) return raw
      const id = recordingId(src, row)
      if (src.platform !== 'wy' || !/^\d+$/.test(id)) return ''
      const response = await sourceRequest('https://music.163.com/api/song/lyric?lv=1&id=' + id, {
        signal: timeout,
      })
      return response.body?.lrc?.lyric
    }).catch(() => false)
    if (saved) lyricsSaved?.()
  }
  async function recordingAddress(src, row, quality, signal, dailyId) {
    // Manual and audition requests were validated against the original search result.
    // A fallback resolver receives that row unchanged, regardless of its own search dialect.
    if (dailyId && !recordingQualities(src, row).includes(quality))
      throw Error('此录音不提供所选音质，请重新选择')
    let url
    const addressDeadline = AbortSignal.timeout(6500)
    try {
      url = await runSource(
        src.code,
        {
          action: 'musicUrl',
          source: src.platform,
          info: { type: quality, musicInfo: row },
        },
        AbortSignal.any([signal, addressDeadline]),
      )
    } catch (error) {
      signal.throwIfAborted()
      if (addressDeadline.aborted) {
        if (dailyId) throw new RecordingError('network', '音乐源取址超时')
        throw new SourceDownloadError('音乐源取址超时')
      }
      if (!(error instanceof SourceRequestError)) throw error
      throw new SourceDownloadError(
        src.name +
          '（' +
          src.platform +
          '）未能取得该版本的 ' +
          quality +
          ' 地址：' +
          error.message,
      )
    }
    if (typeof url !== 'string' || !url || url.length > 16384)
      throw new SourceDownloadError('音乐源未返回可用地址')
    return url
  }
  async function fetchRecording(
    src,
    row,
    quality,
    dir,
    signal,
    auditionId,
    dailyId,
    preparedUrl,
    canRetry = true,
    lyricTasks,
  ) {
    for (let attempt = 0; ; attempt++) {
      const url =
        (!attempt && preparedUrl) || (await recordingAddress(src, row, quality, signal, dailyId))
      try {
        const started = performance.now()
        const filename = await saveRecording(
          url,
          dir,
          {
            name: dailyId ? text(recordingDisplayTitle(row)) : text(row.name),
            durationSeconds: row.durationSeconds,
            singer: text(row.singer),
            albumName: text(row.albumName),
          },
          getStore(),
          signal,
          auditionId,
          versionInfo(src, row, quality),
          dailyId,
        )
        if (filename && !auditionId) {
          const bytes = (await lstat(path.join(dir, filename)).catch(() => null))?.size
          if (bytes > 0) {
            const key = sourceKey(src)
            const rate = bytes / Math.max(1, performance.now() - started)
            transferRates ??= new Map(JSON.parse(getStore().get('lx-transfer-rates') || '[]'))
            const previous = transferRates.get(key)
            transferRates.delete(key)
            transferRates.set(key, previous ? (previous + rate) / 2 : rate)
            if (transferRates.size > 64) transferRates.delete(transferRates.keys().next().value)
            getStore().set('lx-transfer-rates', JSON.stringify([...transferRates]))
          }
          const lyrics = () => saveRecordingLyrics(src, row, path.join(dir, filename), signal)
          if (lyricTasks) lyricTasks.push(lyrics)
          else await lyrics()
        }
        return filename
      } catch (e) {
        if (
          !canRetry ||
          attempt > 0 ||
          !(e instanceof TransferError) ||
          (dailyId && e instanceof TransferDeadline)
        )
          throw e
        signal.throwIfAborted()
      }
    }
  }
  bind(
    'lxDownload',
    exclusive((signal, key, quality, detailed) =>
      transfer(signal, key, quality, undefined, detailed === true),
    ),
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
  async function prepare(id, selected, batchSignal, constraints, health) {
    const store = getStore()
    const recommendation = store.db
      .prepare('SELECT local FROM recommended_items WHERE item=?')
      .get(id)
    if (!recommendation) throw Error('无效推荐记录')
    if (running.has(id) || store.db.prepare('SELECT 1 FROM dismissed_items WHERE item=?').get(id))
      return
    const item = store.item(id)
    const batch = store.db
      .prepare(
        'SELECT b.preference,r.batch AS targeted FROM batches b LEFT JOIN recommendation_runs r ON r.batch=b.id WHERE b.id=?',
      )
      .get(item.batch)
    constraints ??= {
      version: recordingPreference(batch?.preference),
      artist: namesRequestedArtist(batch?.preference, item.artist) ? item.artist : '',
    }
    function hasLocalCopy(recording) {
      if (recommendation.local) return false
      const local = store.db
        .prepare("SELECT title,artist FROM local_tracks WHERE ? OR importedOrigin='local'")
        .all(Number(!!batchSignal))
      return (
        inLibrary(item, local) ||
        (recording && local.some((track) => titleMatch(track, recording) === 'exact'))
      )
    }
    function markDuplicate() {
      choices.delete(id)
      store.db
        .prepare(
          "UPDATE recommended_items SET error='本地曲库已有这首歌，本次未重复下载',diagnosis='duplicate' WHERE item=?",
        )
        .run(id)
      store.status(id, '已在曲库')
    }
    if (hasLocalCopy()) return markDuplicate()
    const bank = catalog()
    let attemptSources = bank.configuration()
    const task = new AbortController()
    running.set(id, task)
    const signal = batchSignal ? AbortSignal.any([batchSignal, task.signal]) : task.signal
    const failures = []
    try {
      const activeSource = await currentSource(signal, true)
      if (!activeSource) throw new RecordingError('source', '尚未导入音乐源')
      const prefs = getMusicPreferences(store)
      const cache = new Map()
      const choicesForItem = new Map()
      await bank.upgrade()
      attemptSources = bank.configuration(activeSource.code)
      const independent = !!health?.catalogSync && bank.independentManual()
      const installed = bank.discoverySources(activeSource, independent)
      const catalogKey = (src) => (src.search ? src.code + '\0' + src.platform : src.platform)
      if (health) {
        const recent = store.db
          .prepare(
            'SELECT source AS name,platform FROM recent_daily_sources ORDER BY rowid DESC LIMIT 32',
          )
          .all()
        const rank = (src) => {
          const exact = recent.findIndex((r) => sourceKey(r) === sourceKey(src))
          if (exact >= 0) return exact
          const platform = recent.findIndex((r) => r.platform === src.platform)
          return platform >= 0 ? recent.length + platform : Infinity
        }
        transferRates ??= new Map(JSON.parse(store.get('lx-transfer-rates') || '[]'))
        installed.sort((a, b) => {
          const aRate = transferRates.get(sourceKey(a)) ?? 0
          const bRate = transferRates.get(sourceKey(b)) ?? 0
          return bRate - aRate || rank(a) - rank(b)
        })
      }
      const saved = selected && choices.get(id)?.rows.get(selected)
      if (
        selected &&
        (!saved ||
          !installed.some(
            (src) => src.code === saved.src.code && src.platform === saved.src.platform,
          ))
      )
        throw Error('候选已变更，请重试')
      store.status(id, '正在匹配')
      let phase = health ? 'shallow' : 'full'
      const expandable = (error) =>
        ['missing', 'unknown', 'denied', 'preview', 'quality', 'mixed', 'ignored'].includes(
          error.kind,
        )
      const selectRecording = async (src, probeSignal = signal) => {
        const catalog = catalogKey(src)
        const known = health?.catalogRecordings.get(JSON.stringify([item.title, item.artist]))
        if (
          phase === 'shallow' &&
          catalog === 'wy' &&
          known &&
          titleMatch(item, known.row, constraints)
        ) {
          try {
            return await eligibleRecording(src, [known.row], [], probeSignal, known.rights)
          } catch (error) {
            if (!expandable(error)) throw error
          }
        }
        const cacheKey = (phase === 'deep' ? src.code + catalog : catalog) + '\0' + phase
        let selection
        let rejected
        if (!cache.has(cacheKey)) {
          const deadline = AbortSignal.timeout(7000)
          const lookup = batchSignal ? AbortSignal.any([probeSignal, deadline]) : probeSignal
          cache.set(
            cacheKey,
            searchRecommendation(
              item,
              src.platform,
              (query, page, offset) => {
                const read = (activeSignal) => versions(src, query, activeSignal, 20, page, offset)
                if (!health) return read(lookup)
                const key = JSON.stringify([catalog, query.title, query.artist, page, offset])
                return sharedQuery(health.queries, key, lookup, read)
              },
              lookup,
              constraints,
              phase,
              phase === 'deep'
                ? async (rows) => {
                    try {
                      selection = await eligibleRecording(src, rows, [], lookup)
                      return !!selection
                    } catch (error) {
                      if (!expandable(error)) throw error
                      rejected = error
                      return false
                    }
                  }
                : undefined,
            ).catch((error) => {
              if (
                health &&
                !probeSignal.aborted &&
                (deadline.aborted || ['network', 'source-request'].includes(failureKind(error)))
              )
                backOff(catalog, deadline.aborted ? '平台检索超时' : error.message)
              if (batchSignal && deadline.aborted && !probeSignal.aborted)
                throw new RecordingError('network', '平台检索超时')
              throw error
            }),
          )
        }
        const { matches: relevant, diagnostics } = await cache.get(cacheKey)
        if (selection) return selection
        if (rejected) throw rejected
        return eligibleRecording(src, relevant, diagnostics, probeSignal)
      }
      async function eligibleRecording(src, relevant, diagnostics, probeSignal, knownRights) {
        const officialWy = !src.search && src.platform === 'wy'
        const rightsKey = 'wyRights:' + JSON.stringify(relevant.map((r) => r.id))
        if (officialWy && !knownRights && !cache.has(rightsKey)) {
          const ids = relevant
            .filter((r) => permission(src, r) === 'unknown' && /^\d+$/u.test(r.id))
            .map((r) => r.id)
          if (ids.length) {
            const deadline = AbortSignal.timeout(5500)
            cache.set(
              rightsKey,
              freeDownloadQualities(
                ids,
                batchSignal ? AbortSignal.any([probeSignal, deadline]) : probeSignal,
              ).catch((error) => {
                if (batchSignal && deadline.aborted && !probeSignal.aborted)
                  throw new RecordingError('network', '下载权限查询超时')
                throw error
              }),
            )
          }
        }
        const rights = knownRights ?? (officialWy ? await cache.get(rightsKey) : undefined)
        const candidates = new Map()
        const reasons = new Set()
        for (const row of relevant) {
          const grant = rights?.get(row.id)
          const right = permission(src, row)
          if (right !== 'granted' && !(right === 'unknown' && grant?.length)) {
            reasons.add(right === 'unknown' && grant && !grant.length ? 'denied' : right)
            continue
          }
          const qualities = recordingQualities(src, row).filter(
            (q) => right === 'granted' || grant.includes(q),
          )
          const quality = [prefs.quality, '320k', ...qualities].find((q) => qualities.includes(q))
          if (!quality) {
            reasons.add('quality')
            continue
          }
          const version = versionInfo(src, row, quality)
          if (!version) continue
          if (store.ignoresRecording(version.platform, version.sourceId)) {
            reasons.add('ignored')
            continue
          }
          candidates.set(version.key, { src, row, quality })
        }
        if (!candidates.size) {
          if (!reasons.size)
            throw new RecordingError(
              'missing',
              '没有找到歌名和艺人都匹配且音质可用的录音。检索：' + diagnostics.join('；'),
            )
          if (reasons.size === 1 && reasons.has('ignored'))
            throw new RecordingError('ignored', '已标记不感兴趣')
          const error = new RecordingError(
            reasons.size === 1 ? [...reasons][0] : 'mixed',
            '匹配录音：' +
              [...reasons]
                .map(
                  (k) => explanations[k] ?? (k === 'quality' ? '没有兼容音质' : '已标记不感兴趣'),
                )
                .join('、'),
          )
          error.kinds = [...reasons]
          throw error
        }
        if (batch?.targeted) {
          const rank = { exact: 0, variant: 1, cover: 2 }
          return [...candidates.values()].sort(
            (a, b) =>
              rank[titleMatch(item, a.row, constraints)] -
              rank[titleMatch(item, b.row, constraints)],
          )[0]
        }
        const exact = [...candidates.values()].filter(
          ({ row }) => titleMatch(item, row) === 'exact',
        )
        if (exact.length === 1) return exact[0]
        for (const [key, entry] of candidates) choicesForItem.set(key, entry)
      }
      const ownedRecording = (identity) =>
        batchSignal &&
        store.db
          .prepare(
            'SELECT 1 FROM recording_copies c JOIN local_tracks t ON t.id=c.local WHERE c.platform=? AND c.sourceId=?',
          )
          .get(identity.platform, identity.sourceId)
      async function save({ src, row: pick, quality, preparedUrl }, canRetry = true) {
        const identity = versionInfo(src, pick, quality)
        if (store.ignoresRecording(identity.platform, identity.sourceId)) {
          store.status(id, '已跳过')
          return
        }
        if (ownedRecording(identity) || hasLocalCopy(pick)) return markDuplicate()
        const version = identity.key
        const cached = await verifiedCopy(store, version, signal)
        if (cached) {
          signal.throwIfAborted()
          if (store.ignoresRecording('content', cached.digest)) {
            store.status(id, '已跳过')
            return
          }
          markSaved(store, id, cached.id)
          const lyrics = () => saveRecordingLyrics(src, pick, cached.file, signal)
          if (health?.lyricTasks) health.lyricTasks.push(lyrics)
          else await lyrics()
        } else {
          if (!prefs.recommendDir) throw new RecordingError('storage', '请在设置中选择推荐下载目录')
          store.status(id, '正在保存')
          await fetchRecording(
            src,
            pick,
            quality,
            prefs.recommendDir,
            signal,
            undefined,
            id,
            preparedUrl,
            canRetry,
            health?.lyricTasks,
          )
        }
      }
      const keyFor = (src) => src.code + '\0' + src.platform
      function backOff(key, message) {
        const previous = health.cooldown.get(key)
        if (previous?.until > Date.now()) return
        const delay = Math.min(120000, (previous?.delay ?? 15000) * 2)
        health.cooldown.set(key, { until: Date.now() + delay, delay, message })
      }
      const probe = async (src, probeSignal) => {
        probeSignal.throwIfAborted()
        const suspended =
          health &&
          [keyFor(src), catalogKey(src)]
            .map((key) => health.cooldown.get(key))
            .find((entry) => entry?.until > Date.now())
        if (suspended)
          throw new RecordingError('network', '同批暂时跳过此来源：' + suspended.message)
        if (health && src.permanentSave === false)
          throw new RecordingError('denied', explanations.denied)
        const candidate = saved || (await selectRecording(src, probeSignal))
        if (batchSignal && candidate && prefs.recommendDir) {
          const identity = versionInfo(src, candidate.row, candidate.quality)
          if (!ownedRecording(identity) && !hasLocalCopy(candidate.row))
            candidate.preparedUrl = await recordingAddress(
              src,
              candidate.row,
              candidate.quality,
              probeSignal,
              id,
            )
        }
        return candidate
      }
      let sources = saved ? [saved.src] : installed
      const checkedSources = health?.catalogSync
      // Prefer an independent active script while repository-managed candidates are being verified.
      const initialSources = sources
      const deferredDeep = []
      let expandedCatalog = false
      const timedOutUrls = new Set()
      let deferredTransfer
      while (sources.length) {
        const expand = []
        for await (const { src, candidate, error: searchError } of availableSources(
          sources,
          probe,
          signal,
          batchSignal ? 3 : 1,
        )) {
          try {
            if (searchError) throw searchError
            signal.throwIfAborted()
            if (!candidate) continue
            if (candidate.preparedUrl && timedOutUrls.has(candidate.preparedUrl))
              throw new SourceDownloadError('此来源返回了同一条已超时的下载地址')
            await save(candidate)
            choices.delete(id)
            return
          } catch (error) {
            signal.throwIfAborted()
            if (error.code || (!prefs.recommendDir && error.message.includes('推荐下载目录')))
              throw error
            if (
              health &&
              ['network', 'source-request'].includes(failureKind(error)) &&
              ![keyFor(src), catalogKey(src)].some(
                (key) => health.cooldown.get(key)?.until > Date.now(),
              )
            )
              backOff(keyFor(src), error.message)
            if (health) store.status(id, '正在匹配')
            failures.push({ src, error })
            if (error instanceof TransferDeadline && candidate) {
              if (candidate.preparedUrl) timedOutUrls.add(candidate.preparedUrl)
              deferredTransfer ??= candidate
            }
            if (phase === 'shallow' && expandable(error) && src.permanentSave !== false)
              expand.push(src)
          }
        }
        if (!expandedCatalog && checkedSources && !saved) {
          expandedCatalog = true
          await checkedSources()
          signal.throwIfAborted()
          const current = await currentSource(signal, true)
          const discovered = current
            ? bank
                .discoverySources(current)
                .filter(
                  (src) =>
                    !initialSources.some(
                      (first) => first.code === src.code && first.platform === src.platform,
                    ),
                )
            : []
          if (discovered.length) {
            deferredDeep.push(...expand)
            sources = discovered
            continue
          }
        }
        sources = [...deferredDeep.splice(0), ...expand]
        phase = 'deep'
      }
      if (deferredTransfer) {
        try {
          // Other eligible addresses have had their turn. Resolve once more in case the link changed.
          await save({ ...deferredTransfer, preparedUrl: undefined }, false)
          choices.delete(id)
          return
        } catch (error) {
          signal.throwIfAborted()
          if (error.code) throw error
          failures.push({ src: deferredTransfer.src, error })
        }
      }
      if (choicesForItem.size) {
        choices.set(id, { rows: choicesForItem })
        store.status(id, '待选录音')
        return
      }
      if (failures.length && failures.every(({ error }) => error.kind === 'ignored')) {
        store.status(id, '已跳过')
        return
      }
      throw failures[0]?.error ?? new RecordingError('source', '没有兼容的已安装音乐源')
    } catch (e) {
      if (store.db.prepare('SELECT 1 FROM dismissed_items WHERE item=?').get(id)) return
      const attempts =
        !signal.aborted && failures.some((f) => f.error === e) ? failures : [{ error: e }]
      const issue = describeFailure(
        attempts.map(({ src, error }) => {
          return {
            platform: src?.platform,
            source: src?.name,
            kinds: signal.aborted ? ['cancelled'] : (error.kinds ?? [failureKind(error)]),
            message: signal.aborted
              ? '操作已取消'
              : error.code
                ? '本地存储失败（' + error.code + '）'
                : String(error.message).slice(0, 320),
          }
        }),
      )
      store.db
        .prepare(
          'UPDATE recommended_items SET error=?,diagnosis=?,summary=?,attemptSources=? WHERE item=?',
        )
        .run(issue.detail, issue.kind, issue.summary, attemptSources, id)
      store.status(id, '待重试')
      return attempts.every(({ error }) =>
        ['network', 'source-request'].includes(failureKind(error)),
      )
        ? 'unreachable'
        : undefined
    } finally {
      running.delete(id)
    }
  }
  bind('dismissRecommendation', (id) => {
    const store = getStore()
    for (const item of store.dismiss(id)) {
      running.get(item)?.abort()
      choices.delete(item)
    }
  })
  bind('prepareRecommendation', (id, key) => {
    if (typeof id !== 'string' || (key !== undefined && typeof key !== 'string'))
      throw Error('无效录音')
    return prepare(id, key)
  })
  bind('recommendationChoices', (id) => {
    if (typeof id !== 'string') throw Error('无效录音')
    return [...(choices.get(id)?.rows ?? [])].map(([key, v]) => ({
      key,
      title: text(v.row.name),
      artist: text(v.row.singer),
      album: text(v.row.albumName),
    }))
  })
  bind('lxCancel', (scope) => {
    if (scope === undefined || (scope === 'import' && activeScope === 'import')) active?.abort()
  })
  let generation = 0
  return {
    onlineAddress(id) {
      const db = onlineDatabase()
      const record = db.prepare('SELECT * FROM online_recording_sources WHERE id=?').get(id)
      const installed =
        record &&
        db
          .prepare("SELECT payload FROM music_sources WHERE id=? AND disabled=''")
          .get(record.source)
      if (!installed) throw Error('录音的原音乐源不可用，请重新搜索')
      const source = JSON.parse(installed.payload)
      const platform =
        source.platforms?.[record.platform] ?? (source.platform === record.platform ? source : null)
      if (!platform?.quality.includes(record.quality)) throw Error('原音乐源已不支持此音质')
      const src = { ...source, ...platform }
      let row = onlineRows.get(id)
      return async (signal) => {
        if (!row) {
          try {
            const saved = JSON.parse(record.identifiers)
            const url = await recordingAddress(src, saved, record.quality, signal)
            row = saved
            return url
          } catch {
            signal.throwIfAborted()
          }
          const { rows } = await downloadResults(src, JSON.parse(record.query), signal)
          row = rows.find((candidate) => recordingId(src, candidate) === record.recording)
          if (!row) throw Error('音乐源中已找不到该录音，请重新搜索')
        }
        return recordingAddress(src, row, record.quality, signal)
      }
    },
    synchronizeSources(signal) {
      const bank = catalog()
      // Independent user scripts can work immediately. Repository-managed sources wait for the check.
      if (!bank.independentManual()) {
        const ready = bank.synchronize(signal)
        return { ready, finish: () => ready }
      }
      let release
      const gate = new Promise((resolve) => {
        release = resolve
      })
      const finished = bank.synchronize(signal, () => gate)
      // Cancellation can arrive before the caller joins the catalog import.
      void finished.catch(() => {})
      return {
        ready: Promise.resolve(),
        finish: () => {
          release()
          return finished
        },
      }
    },
    async sourceTool(name, args, signal) {
      const bank = catalog()
      await bank.upgrade()
      switch (name) {
        case 'list_sources':
          return bank.list()
        case 'source_capabilities':
          return bank.describe(args.id)
        case 'select_source': {
          const result = bank.select(args.id)
          matches.clear()
          return result
        }
        case 'import_sources':
          return bank.importSelected(args.ids, signal)
        default:
          throw Error('未知的音源操作')
      }
    },
    async discoveries(seen, local, signal, health) {
      const current = await currentSource(signal, true)
      if (!current) return []
      const bank = catalog()
      await bank.upgrade()
      const src = bank
        .discoverySources(current)
        .find((s) => s.platform === 'wy' && !s.search && s.permanentSave !== false)
      if (!src || health.cooldown.get('wy')?.until > Date.now()) return []
      const pool = []
      const deadline = AbortSignal.timeout(5000)
      const lookup = AbortSignal.any([signal, deadline])
      const artists = [...new Set(seen.map((r) => r.artist))].slice(0, 5)
      const byArtist = (artist, probeSignal) =>
        sharedQuery(
          health.queries,
          JSON.stringify(['discovery', artist]),
          probeSignal,
          async (readSignal) => {
            const hits = searchRows(
              await versions(src, { title: artist, artist: '' }, readSignal, 30),
            ).filter(
              (row) =>
                artistMatches(artist, row.singer, row.artistAliases) &&
                /^\d+$/u.test(row.id) &&
                !['denied', 'preview'].includes(permission(src, row)) &&
                !getStore().ignoresRecording(src.platform, row.id),
            )
            if (!hits.length) return []
            const rights = await freeDownloadQualities(
              hits.map((r) => r.id),
              readSignal,
            )
            return hits.filter((r) => rights.get(r.id)?.length).map((row) => ({ row, rights }))
          },
        )
      try {
        for await (const { candidate } of availableSources(artists, byArtist, lookup, 2)) {
          for (const entry of (candidate ?? []).slice(0, 10)) {
            const { row } = entry
            const item = { title: text(row.name), artist: text(row.singer) }
            if (!inLibrary(item, local) && !inLibrary(item, seen) && !inLibrary(item, pool)) {
              pool.push(item)
              health.catalogRecordings.set(JSON.stringify([item.title, item.artist]), entry)
            }
            if (pool.length >= 50) return pool
          }
        }
      } catch {
        signal.throwIfAborted()
      }
      return pool
    },
    async batch(batch, signal, sourceHealth, reserveNext) {
      const epoch = generation
      const controller = new AbortController()
      const work = AbortSignal.any([signal, controller.signal])
      let fatal
      const initialWorkers =
        catalog().independentManual() && catalog().independentCount() === 1 ? 5 : 3
      let activeWorkers = initialWorkers
      const workers = []
      const worker = async () => {
        try {
          while (epoch === generation) {
            work.throwIfAborted()
            const id = await reserveNext(work)
            if (!id) break
            const outcome = await prepare(
              id,
              undefined,
              work,
              sourceHealth?.constraints,
              sourceHealth,
            )
            work.throwIfAborted()
            if (sourceHealth) {
              choices.delete(id)
              sourceHealth.unreachable =
                outcome === 'unreachable' ? sourceHealth.unreachable + 1 : 0
              if (activeWorkers < 5 && getStore().item(id)?.status === '已入库') {
                activeWorkers++
                workers.push(worker())
              }
              const issue = getStore()
                .db.prepare('SELECT diagnosis,summary FROM recommended_items WHERE item=?')
                .get(id)
              if (['source', 'storage'].includes(issue?.diagnosis)) throw Error(issue.summary)
            }
          }
        } catch (error) {
          fatal ??= error
          controller.abort()
        }
      }
      try {
        workers.push(...Array.from({ length: initialWorkers }, worker))
        for (const completion of workers) await completion
        if (fatal) throw fatal
        if (sourceHealth.unreachable >= 3)
          throw Error('连续多首歌曲的所有匹配来源均无法访问，请检查网络或音源状态')
      } finally {
        if (sourceHealth?.lyricTasks && !work.aborted) {
          const jobs = sourceHealth.lyricTasks.values()
          const write = async () => {
            for (const job of jobs) {
              if (work.aborted) break
              await job()
            }
          }
          await Promise.all([write(), write()])
        }
        if (work.aborted)
          getStore()
            .db.prepare("UPDATE items SET status='待重试' WHERE batch=? AND status='待处理'")
            .run(batch)
      }
    },
    close() {
      generation++
      for (const task of running.values()) task.abort()
      active?.abort()
      matches.clear()
      choices.clear()
      getStore()
        ?.db.prepare(
          "UPDATE items SET status='待重试' WHERE id IN (SELECT item FROM recommended_items) AND status IN ('正在匹配','正在保存','正在校验','待处理','待选录音')",
        )
        .run()
    },
  }
}
