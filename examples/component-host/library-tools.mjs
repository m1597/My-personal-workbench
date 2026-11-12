import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { open, writeFile, rename, rm, lstat } from 'node:fs/promises'
import { pathKey, openAudio } from './music/local-files.mjs'
import {
  exportLibrary,
  restoreLibrary,
  validateBackup,
  backupSummary,
  backupLimit,
} from './library-backup.mjs'

const normalized = (value) => value.normalize('NFKC').toLowerCase().trim()
const signature = (stat) => [stat.dev, stat.ino, stat.size, stat.mtimeNs].join(':')
export async function relocationPreview(library, dir) {
  await library.refresh()
  const missing = library.db.prepare('SELECT * FROM local_tracks WHERE available=0').all()
  const rows = missing.length ? await library.scanFolder(dir) : []
  const candidates = new Map(),
    matches = new Map()
  const byFilename = new Map(),
    byTitle = new Map()
  const add = (index, key, id) => {
    if (!index.has(key)) index.set(key, new Set())
    index.get(key).add(id)
  }
  for (const row of rows) {
    const linked = library.db
      .prepare('SELECT id,available FROM local_tracks WHERE path_key=?')
      .get(pathKey(row.file))
    if (linked?.available) continue
    const id = randomUUID()
    const stat = await lstat(row.file, { bigint: true }).catch(() => null)
    if (!stat?.isFile() || Number(stat.size) !== row.size) continue
    candidates.set(id, { ...row, linked: linked?.id, signature: signature(stat) })
    add(byFilename, normalized(path.basename(row.file)), id)
    add(byTitle, normalized(row.title), id)
  }
  const view = missing.map((track) => {
    const options = [
      ...new Set([
        ...(byFilename.get(normalized(path.basename(track.file))) || []),
        ...(byTitle.get(normalized(track.title)) || []),
      ]),
    ].filter((id) => !candidates.get(id).linked || candidates.get(id).linked === track.id)
    matches.set(track.id, { track, options })
    return {
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      oldFile: track.file,
      options: options.map((id) => {
        const c = candidates.get(id)
        return {
          id,
          file: path.relative(dir, c.file),
          artist: c.artist,
          album: c.album,
          duration: c.duration,
        }
      }),
    }
  })
  return { dir, candidates, matches, view }
}
export async function applyRelocation(library, preview, selections) {
  if (
    !Array.isArray(selections) ||
    !selections.length ||
    selections.length > preview.matches.size ||
    library.job.running
  )
    throw Error('请重新核对匹配')
  const targets = new Set(),
    files = new Set(),
    updates = []
  for (const s of selections) {
    const match = preview.matches.get(s?.track)
    if (!match?.options.includes(s?.candidate) || files.has(s.candidate) || targets.has(s.track))
      throw Error('同一文件只能分配给一首歌曲')
    const candidate = preview.candidates.get(s.candidate)
    const handle = await openAudio(candidate.file)
    try {
      if (signature(await handle.stat({ bigint: true })) !== candidate.signature)
        throw Error('候选文件已变化，请重新扫描')
    } finally {
      await handle.close()
    }
    if (await library.verify(library.row(s.track))) throw Error('原文件已恢复，请重新扫描')
    updates.push([match.track, candidate])
    targets.add(s.track)
    files.add(s.candidate)
  }
  const db = library.db
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const [old, c] of updates) {
      const result = db
        .prepare(`UPDATE local_tracks SET file=?,path_key=?,title=?,artist=?,album=?,size=?,duration=?,available=1,unplayable=0,awaitingLocation=0
        WHERE id=? AND file=? AND available=0`)
        .run(
          c.file,
          pathKey(c.file),
          c.title,
          c.artist,
          c.album,
          c.size,
          c.duration,
          old.id,
          old.file,
        )
      if (!result.changes) throw Error('曲库已变化，请重新扫描')
    }
    db.prepare('INSERT OR IGNORE INTO music_roots(dir) VALUES(?)').run(preview.dir)
    db.exec('COMMIT')
    return updates.length
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
export function registerLibraryTools(bind, getStore, getTaste, dialog, getEpoch) {
  let pending,
    busy = false
  const action =
    (fn) =>
    async (...args) => {
      if (busy || getStore().library.job.running) throw Error('请等待当前曲库操作完成')
      busy = true
      try {
        return await fn(...args)
      } finally {
        busy = false
      }
    }
  bind('setFavorite', (id, on) => {
    if (typeof id !== 'string' || typeof on !== 'boolean') throw Error('收藏操作无效')
    getStore().library.row(id)
    getStore().db.prepare('UPDATE local_tracks SET favorite=? WHERE id=?').run(Number(on), id)
    getStore().library.changed?.()
  })
  bind('recentHistory', async (before) => {
    if (
      before !== undefined &&
      (!Number.isSafeInteger(before?.playedAt) ||
        typeof before.event !== 'string' ||
        before.event.length > 150)
    )
      throw Error('无效的历史游标')
    if (!before) await getStore().library.refresh()
    return getStore()
      .db.prepare(
        `SELECT event,track,playedAt FROM (
          SELECT h.event,h.track,h.playedAt,ROW_NUMBER() OVER (PARTITION BY h.track ORDER BY h.playedAt DESC,h.event DESC) AS position
          FROM local_play_history h JOIN local_tracks t ON t.id=h.track WHERE t.listed=1 AND t.hiddenFromRecent=0
        ) WHERE position=1 AND (playedAt,event) < (?,?) ORDER BY playedAt DESC,event DESC LIMIT 201`,
      )
      .all(before?.playedAt ?? Number.MAX_SAFE_INTEGER, before?.event ?? '')
  })
  bind(
    'exportLibrary',
    action(async () => {
      const { filePath, canceled } = await dialog.showSaveDialog({
        title: '导出曲库资料',
        defaultPath: 'FitBay-曲库备份.json',
        filters: [{ name: '曲库资料', extensions: ['json'] }],
      })
      if (canceled) return false
      if (path.extname(filePath).toLowerCase() !== '.json') throw Error('请选择 JSON 备份文件')
      const data = JSON.stringify(exportLibrary(getStore(), getTaste()))
      if (Buffer.byteLength(data) > backupLimit) throw Error('备份超过 32 MB')
      const temp = filePath + '.' + randomUUID() + '.tmp'
      try {
        await writeFile(temp, data, { flag: 'wx' })
        await rename(temp, filePath)
      } finally {
        await rm(temp, { force: true })
      }
      return true
    }),
  )
  const save = (kind, value, epoch) => {
    if (epoch !== getEpoch()) throw Error('窗口已关闭，请重试')
    pending = { kind, value, epoch, token: randomUUID() }
    return pending.token
  }
  const take = (kind, token) => {
    if (pending?.kind !== kind || pending.token !== token || pending.epoch !== getEpoch())
      throw Error('预览已失效，请重新选择')
    return pending.value
  }
  bind(
    'previewRestore',
    action(async () => {
      pending = null
      const epoch = getEpoch()
      const result = await dialog.showOpenDialog({
        title: '选择曲库资料备份',
        properties: ['openFile'],
        filters: [{ name: '曲库资料', extensions: ['json'] }],
      })
      if (result.canceled) return null
      const handle = await open(result.filePaths[0], 'r')
      let value
      try {
        const stat = await handle.stat()
        if (!stat.isFile() || stat.size > backupLimit) throw Error('备份文件过大或无效')
        const buffer = Buffer.alloc(stat.size + 1)
        let bytes = 0
        while (bytes < buffer.length) {
          const { bytesRead } = await handle.read(buffer, bytes, buffer.length - bytes)
          if (!bytesRead) break
          bytes += bytesRead
        }
        if (bytes !== stat.size) throw Error('备份文件已变化')
        value = validateBackup(JSON.parse(buffer.toString('utf8', 0, bytes)))
      } catch {
        throw Error('无法读取此备份，请选择有效的 FitBay 曲库 JSON 文件（最大 32 MB）')
      } finally {
        await handle.close()
      }
      return { token: save('restore', value, epoch), ...backupSummary(value) }
    }),
  )
  bind(
    'applyRestore',
    action((token) => {
      restoreLibrary(getStore(), getTaste(), take('restore', token))
      pending = null
    }),
  )
  bind(
    'previewRelocation',
    action(async () => {
      pending = null
      const epoch = getEpoch()
      const result = await dialog.showOpenDialog({
        title: '选择歌曲的新目录',
        properties: ['openDirectory'],
      })
      if (result.canceled) return null
      const info = await relocationPreview(getStore().library, result.filePaths[0])
      return { token: save('move', info, epoch), rows: info.view }
    }),
  )
  bind(
    'applyRelocation',
    action(async (token, choices) => {
      const count = await applyRelocation(getStore().library, take('move', token), choices)
      pending = null
      return count
    }),
  )
}
