import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createWriteStream, lstatSync, unlinkSync } from 'node:fs'
import { readFile, rm, lstat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { parseFile } from 'music-metadata'
import { runSource } from './lx-runtime.mjs'
import { sourceRequest, openPublic } from './lx-net.mjs'
import { verifyAudio } from './lx-audio-check.mjs'
import { publish } from './music/store.mjs'

class TransferError extends Error {}
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
  const response = await sourceRequest(
    'https://music.163.com/api/search/get?type=1&limit=20&s=' + encodeURIComponent(keyword),
    { signal },
  )
  const songs = response.body?.result?.songs
  if (!Array.isArray(songs)) throw Error('在线目录暂时不可用')
  return songs.map((s) => ({
    name: s.name,
    singer: s.artists?.map((a) => a.name).join('/'),
    albumName: s.album?.name,
    id: String(s.id),
    songmid: String(s.id),
    source: 'wy',
    meta: { wy: { id: String(s.id) } },
  }))
}
function extension(format) {
  if (format.container === 'FLAC') return '.flac'
  if (format.container === 'WAVE') return '.wav'
  if (format.container === 'MPEG' && /layer 3/i.test(format.codec ?? '')) return '.mp3'
  if (/M4A|isom|mp4/i.test(format.container ?? '') && /AAC|ALAC|MPEG-4/i.test(format.codec ?? ''))
    return '.m4a'
  throw Error('返回的文件不是支持的音频格式')
}
export function publishToLibrary(temp, row, store) {
  const file = row.file
  const before = lstatSync(temp, { bigint: true })
  store.db.exec('BEGIN IMMEDIATE')
  let published = false
  try {
    store.library.upsert(row)
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
export async function saveRecording(url, dir, info, store, signal, auditionId) {
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
    let size = 0
    const limit = new Transform({
      transform(chunk, _encoding, cb) {
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
    const filename =
      (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name) ? '_' : '') + name + extension(format)
    const file = path.join(dir, filename)
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
    )
      throw Error('目标文件已存在，请选择其他目录')
    await verifyAudio(temp, signal)
    signal.throwIfAborted()
    const metadata = {
      file,
      title: text(common.title) || info.name,
      artist: text(common.artist) || info.singer || '未知艺人',
      album: text(common.album) || text(info.albumName),
      duration: format.duration,
    }
    if (auditionId) store.cacheOnline(auditionId, temp, metadata, extension(format))
    else publishToLibrary(temp, metadata, store)
    return filename
  } finally {
    await rm(temp, { force: true })
  }
}
export function registerLx(bind, getStore, dialog) {
  let active = null
  const matches = new Map()
  const source = () => {
    const saved = getStore().get('lx-source')
    return saved ? JSON.parse(saved) : null
  }
  const exclusive =
    (fn) =>
    async (...args) => {
      if (active && !active.signal.aborted) throw Error('请等待当前音乐源操作完成')
      const task = new AbortController()
      active = task
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
    }),
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
      const folder = await dialog.showOpenDialog({
        title: '选择歌曲下载文件夹',
        properties: ['openDirectory', 'createDirectory'],
      })
      if (folder.canceled) return ''
      dir = folder.filePaths[0]
    } else {
      const item = getStore().item(auditionId)
      if (item.status !== '模型推荐' && !item.track?.startsWith('online-'))
        throw Error('推荐曲目无效')
    }
    signal.throwIfAborted()
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
  bind('lxCancel', () => active?.abort())
  return () => {
    active?.abort()
    matches.clear()
  }
}
