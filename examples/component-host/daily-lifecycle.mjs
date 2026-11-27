import path from 'node:path'
import { createHash } from 'node:crypto'
import {
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  realpathSync,
  unlinkSync,
  write,
} from 'node:fs'
import { lstat, mkdir, open, readdir, realpath } from 'node:fs/promises'
import { promisify } from 'node:util'
import { audioTypes, confirmedMissing, openAudio, pathKey } from './music/local-files.mjs'
import { lyricPath, ownedLyrics } from './music-lyrics.mjs'
import { readCommon } from './music/albums.mjs'

const identity = (s) => [s.dev, s.ino, s.birthtimeNs].join(':')
const revision = (s) => [identity(s), s.size, s.mtimeNs].join(':')
const writeChunk = promisify(write)
// An interrupted write has no final size or mtime. The same inode can now contain user edits.
const matchesCopy = (s, version, partial) => !partial && s && revision(s) === version
const stat = (file) => lstatSync(file, { bigint: true, throwIfNoEntry: false })
const safeDir = async (dir) =>
  path.isAbsolute(dir) &&
  (await lstat(dir)).isDirectory() &&
  pathKey(await realpath(dir)) === pathKey(dir)
const safeName = (name) =>
  typeof name === 'string' &&
  !!name.trim() &&
  name.length <= 60 &&
  !/[<>:"/\\|?*\p{Cc}]/u.test(name) &&
  !/[. ]$/.test(name) &&
  !/^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(name)
export async function recyclableLyrics(db, audio) {
  const lyric = await ownedLyrics(db, audio)
  if (!lyric) return null
  const other = db.prepare(
    'SELECT 1 FROM lyric_files WHERE file=? COLLATE NOCASE AND audio<>? COLLATE NOCASE LIMIT 1',
  ).get(lyric, audio)
  return other || (await hasOtherRecording(audio)) ? null : lyric
}
async function hasOtherRecording(audio) {
  const current = path.parse(audio)
  const entries = await readdir(current.dir).catch(() => null)
  return (
    !entries ||
    entries.some((name) => {
      const entry = path.parse(name)
      return (
        name.toLowerCase() !== current.base.toLowerCase() &&
        entry.name.toLowerCase() === current.name.toLowerCase() &&
        Object.hasOwn(audioTypes, entry.ext.toLowerCase())
      )
    })
  )
}
export function forgetLocal(store, ids) {
  const db = store.db
  const removed = new Set(ids)
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const id of ids) {
      for (const { item } of db.prepare('SELECT item FROM recommended_items WHERE local=?').all(id))
        removed.add(item)
      db.prepare(
        "UPDATE items SET status='文件已移除' WHERE id IN (SELECT item FROM recommended_items WHERE local=?)",
      ).run(id)
      db.prepare('UPDATE recommended_items SET local=NULL WHERE local=?').run(id)
      db.prepare('DELETE FROM recording_copies WHERE local=?').run(id)
      store.library.remove(id)
    }
    if (removed.has(store.get('current'))) store.checkpoint('', 0)
    store.set(
      'play-queue',
      JSON.stringify(JSON.parse(store.get('play-queue') || '[]').filter((id) => !removed.has(id))),
    )
    db.exec('COMMIT')
    return removed
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
async function finishTrash(store, row, trash) {
  const db = store.db
  if (row.lyric && !(await confirmedMissing(row.file)) && !stat(row.file)) return
  if (row.lyric && !stat(row.file) && row.lyric === (await recyclableLyrics(db, row.file))) {
    try {
      await trash(row.lyric)
    } catch {
      throw Error('音频已回收，歌词文件回收失败')
    }
    db.prepare('DELETE FROM lyric_files WHERE audio=? AND file=?').run(row.file, row.lyric)
  }
  db.prepare('DELETE FROM pending_trash WHERE local=?').run(row.local)
}
export async function recoverTrash(store, forget, trash) {
  for (const row of store.db.prepare('SELECT * FROM pending_trash').all()) {
    const missing = await confirmedMissing(row.file)
    if (!row.recycled && !missing) {
      if (stat(row.file)) store.db.prepare('DELETE FROM pending_trash WHERE local=?').run(row.local)
      continue
    }
    if (
      store.db.prepare('SELECT 1 FROM local_tracks WHERE id=? AND file=?').get(row.local, row.file)
    )
      forget([row.local])
    if (missing) await finishTrash(store, row, trash).catch(() => {})
    else if (stat(row.file))
      store.db.prepare('DELETE FROM pending_trash WHERE local=?').run(row.local)
  }
}
export async function trashAudio(store, row, lyric, trash, forget) {
  const db = store.db
  if (db.prepare('SELECT 1 FROM favorite_moves WHERE local=?').get(row.id))
    throw Error('歌曲正在移动')
  db.prepare('INSERT INTO pending_trash(local,file,lyric) VALUES(?,?,?)').run(
    row.id,
    row.file,
    lyric,
  )
  try {
    await trash(row.file)
  } catch {
    db.prepare('DELETE FROM pending_trash WHERE local=?').run(row.id)
    throw Error('无法移至系统回收站，曲库记录已保留')
  }
  db.prepare('UPDATE pending_trash SET recycled=1 WHERE local=?').run(row.id)
  forget([row.id])
  await finishTrash(store, { local: row.id, file: row.file, lyric }, trash)
}
async function verifyDownload(row) {
  const handle = await openAudio(row.file)
  try {
    const before = await handle.stat({ bigint: true })
    if (!row.identity || row.identity !== identity(before)) return
    const hash = createHash('sha256')
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk)
    const current = stat(row.file)
    if (current && revision(before) === revision(current) && hash.digest('hex') === row.digest)
      return revision(current)
  } finally {
    await handle.close()
  }
}
// The native picker authorizes this move including an accompanying user-written LRC.
export async function moveLibraryTrack(store, row, target, onMove) {
  if (!(await safeDir(target)) || !(await store.library.acceptsVolume(target)))
    throw Error('目标目录不可用')
  if (pathKey(target) === pathKey(path.dirname(row.file))) return false
  const source = stat(row.file)
  if (
    !source?.isFile() ||
    row.awaitingLocation ||
    !(await store.library.acceptsVolume(row.file)) ||
    (row.fileIdentity && identity(source) !== row.fileIdentity)
  )
    throw Error('原曲不可用或已被替换')
  const sidecar = lyricPath(row.file)
  const lyrics = stat(sidecar)
  if (lyrics && (!lyrics.isFile() || (await hasOtherRecording(row.file))))
    throw Error('歌词由其他录音共用或无法移动')
  await moveRecording(
    store,
    row,
    target,
    revision(source),
    lyrics ? sidecar : null,
    onMove,
    true,
    true,
  )
  return true
}
async function moveRecording(
  store,
  row,
  target,
  sourceRevision,
  lyric,
  onMove,
  manual,
  explicit = false,
) {
  const db = store.db
  const file = path.join(target, path.basename(row.file))
  if (pathKey(file) === pathKey(row.file)) return
  // Copy exclusively before switching the index. A power loss always leaves a playable copy.
  const managedLyric = lyric && (await ownedLyrics(db, row.file))
  const copies = []
  const sources = []
  if (db.prepare('SELECT 1 FROM pending_trash WHERE local=?').get(row.id))
    throw Error('歌曲正在回收')
  db.prepare('INSERT INTO favorite_moves VALUES(?,?,?,?,?)').run(row.id, row.file, file, '[]', '[]')
  const copy = async (src, dst) => {
    const old = stat(src)
    const save = () =>
      db
        .prepare('UPDATE favorite_moves SET copies=?,sources=? WHERE local=?')
        .run(JSON.stringify(copies), JSON.stringify(sources), row.id)
    const input = await open(src, 'r')
    let fd, created
    try {
      fd = openSync(dst, 'wx')
      copies.push([dst, identity(fstatSync(fd, { bigint: true })), true])
      sources.push([src, revision(old)])
      save()
      for await (const chunk of input.createReadStream({ autoClose: false })) {
        let offset = 0
        while (offset < chunk.length) {
          const { bytesWritten } = await writeChunk(fd, chunk, offset, chunk.length - offset, null)
          if (!bytesWritten) throw Error('无法写入目标文件')
          offset += bytesWritten
        }
      }
      fsyncSync(fd)
      created = fstatSync(fd, { bigint: true })
    } finally {
      if (fd !== undefined) {
        // A live, empty destination can be rolled back even if the first journal write failed.
        const last = fstatSync(fd, { bigint: true })
        if (last.size === 0n && copies.at(-1)?.[0] === dst)
          copies[copies.length - 1] = [dst, revision(last)]
        closeSync(fd)
      }
      await input.close()
    }
    if (identity(stat(dst)) !== identity(created)) throw Error('目标文件已替换')
    created = stat(dst)
    copies[copies.length - 1] = [dst, revision(created)]
    save()
    if (created.size !== old.size || revision(stat(src)) !== revision(old))
      throw Error('源文件已变化')
    return created
  }
  const checkPaths = () => {
    if (
      (!manual && store.get('auto-sort-favorites') !== 'on') ||
      pathKey(realpathSync(target)) !== pathKey(target) ||
      pathKey(realpathSync(row.file)) !== pathKey(row.file) ||
      !db
        .prepare('SELECT 1 FROM local_tracks WHERE id=? AND file=? AND (? OR favorite=1)')
        .get(row.id, row.file, Number(explicit)) ||
      revision(stat(row.file)) !== sourceRevision
    )
      throw Error('目录或原曲已变化')
  }
  try {
    checkPaths()
    if (stat(lyricPath(file)) || (lyric && (await hasOtherRecording(file))))
      throw Error('目标歌词冲突')
    const audio = await copy(row.file, file)
    const dst = lyricPath(file)
    const s = lyric ? await copy(lyric, dst) : null
    if (
      lyric &&
      (explicit
        ? await hasOtherRecording(row.file)
        : lyric !== (await recyclableLyrics(db, row.file)))
    )
      throw Error('歌词已变化')
    if (lyric && (await hasOtherRecording(file))) throw Error('目标目录有同名录音')
    checkPaths()
    if (copies.some(([dst, version]) => revision(stat(dst)) !== version))
      throw Error('目标文件已变化')
    db.exec('BEGIN IMMEDIATE')
    if (s && managedLyric) {
      db.prepare('UPDATE lyric_files SET audio=?,file=?,identity=? WHERE audio=? AND file=?').run(
        file,
        dst,
        [s.dev, s.ino, s.birthtimeNs, s.mtimeNs].join(':'),
        row.file,
        lyric,
      )
    }
    db.prepare('UPDATE local_tracks SET file=?,path_key=?,fileIdentity=? WHERE id=?').run(
      file,
      pathKey(file),
      identity(audio),
      row.id,
    )
    db.prepare('DELETE FROM daily_downloads WHERE local=? AND file=?').run(row.id, row.file)
    db.prepare('DELETE FROM favorite_sort_pending WHERE local=?').run(row.id)
    db.exec('COMMIT')
  } catch (e) {
    if (db.isTransaction) db.exec('ROLLBACK')
    for (const [dst, version, partial] of copies)
      if (matchesCopy(stat(dst), version, partial)) unlinkSync(dst)
    db.prepare('DELETE FROM favorite_moves WHERE local=?').run(row.id)
    throw e
  }
  onMove(row.id, file)
  for (const [src, version] of sources)
    if (stat(src) && revision(stat(src)) === version) unlinkSync(src)
  db.prepare('DELETE FROM favorite_moves WHERE local=?').run(row.id)
}
export function recoverFavoriteMoves(store) {
  for (const row of store.db.prepare('SELECT * FROM favorite_moves').all()) {
    const file = store.db.prepare('SELECT file FROM local_tracks WHERE id=?').get(row.local)?.file
    if (file !== row.original && file !== row.destination) continue
    const cleanup = JSON.parse(file === row.original ? row.copies : row.sources)
    const retained = JSON.parse(file === row.original ? row.sources : row.copies)
    try {
      if (!stat(file) || retained.some(([p, v]) => !stat(p) || revision(stat(p)) !== v)) continue
      for (const [p, v, partial] of cleanup) if (matchesCopy(stat(p), v, partial)) unlinkSync(p)
      store.db.prepare('DELETE FROM favorite_moves WHERE local=?').run(row.local)
    } catch {
      /* A playing file may remain locked until the next startup. */
    }
  }
}

const languages = {
  jpn: '日语',
  ja: '日语',
  eng: '英语',
  en: '英语',
  zho: '华语',
  chi: '华语',
  zh: '华语',
  kor: '韩语',
  ko: '韩语',
}
const genres = {
  pop: '流行',
  rock: '摇滚',
  classical: '古典',
  jazz: '爵士',
  soundtrack: '原声',
  electronic: '电子',
  folk: '民谣',
}
export async function sortFavorite(store, id, manualDirectory, onMove) {
  const db = store.db
  const row = db
    .prepare(`SELECT d.*, t.id,t.artist,t.album,t.language,t.title FROM daily_downloads d JOIN local_tracks t
    ON t.id=d.local AND t.file=d.file WHERE t.id=? AND t.favorite=1 AND t.awaitingLocation=0
    AND NOT EXISTS(SELECT 1 FROM recording_copies c WHERE c.local=t.id AND c.automatic=0)`)
    .get(id)
  if (!row) return
  const pending = (reason) =>
    db
      .prepare(
        'INSERT OR REPLACE INTO favorite_sort_pending SELECT t.id,? FROM local_tracks t JOIN daily_downloads d ON d.local=t.id AND d.file=t.file WHERE t.id=? AND t.favorite=1',
      )
      .run(reason, id)
  try {
    const verified = await verifyDownload(row)
    if (!verified) {
      pending('原文件身份或内容已变化')
      return
    }
    let target = manualDirectory
    if (!target) {
      const root = store.get('music-category-root')
      if (!root || !(await safeDir(root))) {
        pending('请先选择分类根目录')
        return
      }
      const tags = await readCommon(row.file, true).catch(() => null)
      const names = [...new Set((tags?.genre ?? []).filter(safeName))]
      const language = row.language || tags?.language
      const languageName =
        (typeof language === 'string' &&
          Object.hasOwn(languages, language.toLowerCase()) &&
          languages[language.toLowerCase()]) ||
        (Object.values(languages).includes(language) ? language : '')
      const choices = [
        row.artist,
        row.album,
        ...names,
        ...names.map((n) => genres[n.toLowerCase()]),
        languageName,
      ].filter(safeName)
      const dirs = await readdir(root, { withFileTypes: true })
      const matching = dirs.filter(
        (d) => d.isDirectory() && choices.some((n) => n.toLowerCase() === d.name.toLowerCase()),
      )
      if (matching.length === 1) target = path.join(root, matching[0].name)
      else if (!matching.length) {
        const name =
          names.length === 1
            ? genres[names[0].toLowerCase()] || names[0]
            : !names.length && languageName
        if (name && safeName(name)) {
          target = path.join(root, name)
          await mkdir(target).catch((e) => {
            if (e.code !== 'EEXIST') throw e
          })
        }
      }
    }
    if (
      !target ||
      !(await safeDir(target)) ||
      pathKey(target) === pathKey(path.dirname(row.file))
    ) {
      pending('请为这首歌选择分类文件夹')
      return
    }
    const lyric = await recyclableLyrics(db, row.file)
    if (!lyric && stat(lyricPath(row.file))) {
      pending('现有歌词未经确认或与其他录音共用，已保留原位')
      return
    }
    await moveRecording(store, row, target, verified, lyric, onMove, Boolean(manualDirectory))
  } catch {
    pending('文件冲突、正在使用或目录不可用，请另选文件夹或重试')
  }
}
// Historical audio rows may already have cascaded away. The sidecar ownership ledger
// survives that deletion and records both the original file identity and content hash.
export async function retireOrphanLyrics(store, trash, signal) {
  const directory = store.get('music-recommend-dir')
  const db = store.db
  if (!directory || !await safeDir(directory).catch(() => false) ||
      !db.prepare("SELECT 1 FROM sqlite_master WHERE name='lyric_files'").get()) return 0
  let failures = 0
  for (const { audio, file } of db.prepare('SELECT audio,file FROM lyric_files').all()) {
    signal?.throwIfAborted()
    if (pathKey(path.dirname(audio)) !== pathKey(directory)) continue
    if (!await confirmedMissing(audio) || file !== await recyclableLyrics(db, audio)) continue
    if (db.prepare('SELECT 1 FROM local_tracks WHERE path_key=?').get(pathKey(audio))) continue
    try {
      await trash(file)
      db.prepare('DELETE FROM lyric_files WHERE audio=? AND file=?').run(audio, file)
    } catch {
      failures++
    }
  }
  return failures
}
export async function retirePendingBatches(store, operations, signal) {
  const runs = store.db.prepare('SELECT batch FROM retiring_daily_batches').all()
  const orphanFailures = await retireOrphanLyrics(store, operations.trash, signal)
  let failures = orphanFailures
  for (const { batch } of runs) {
    const result = await retireDownloads(store, batch, operations, signal)
    failures += result.failures
    if (!result.failures && !orphanFailures)
      store.db.prepare('DELETE FROM retiring_daily_batches WHERE batch=?').run(batch)
  }
  return failures
}
export async function retireDownloads(store, previous, { trash, forget }, signal) {
  const rows = store.db
    .prepare(`SELECT d.*,t.title,t.artist,t.album,t.language,t.favorite,t.id FROM daily_downloads d
    JOIN local_tracks t ON d.local=t.id AND d.file=t.file WHERE d.batch=? AND t.awaitingLocation=0
    AND NOT EXISTS(SELECT 1 FROM recording_copies c WHERE c.local=t.id AND c.automatic=0)`)
    .all(previous)
  const protectedIds = new Set(rows.filter((r) => r.favorite).map((r) => r.id))
  let failures = 0
  for (const row of rows) {
    signal.throwIfAborted()
    try {
      if (protectedIds.has(row.id)) continue
      const version = await verifyDownload(row)
      const lyric = await recyclableLyrics(store.db, row.file)
      signal.throwIfAborted()
      const fresh = store.db
        .prepare('SELECT favorite,file FROM local_tracks WHERE id=?')
        .get(row.id)
      if (!version || !fresh || fresh.file !== row.file || revision(stat(row.file)) !== version)
        continue
      if (!fresh.favorite) await trashAudio(store, row, lyric, trash, forget)
    } catch {
      signal.throwIfAborted()
      failures++
    }
  }
  return { failures }
}
