import path from 'node:path'
import { createHash } from 'node:crypto'
import { constants, lstatSync, realpathSync, unlinkSync } from 'node:fs'
import { copyFile, lstat, mkdir, readdir, realpath } from 'node:fs/promises'
import { audioTypes, confirmedMissing, openAudio, pathKey } from './music/local-files.mjs'
import { lyricPath, ownedLyrics } from './music-lyrics.mjs'

const identity = (s) => [s.dev, s.ino, s.birthtimeNs].join(':')
const revision = (s) => [identity(s), s.size, s.mtimeNs].join(':')
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
function metadata(value) {
  return typeof value === 'string' && !/[\\/\p{Cc}]/u.test(value) && !/^[a-z]:/i.test(value)
    ? value.slice(0, 200)
    : ''
}
export async function recyclableLyrics(db, audio) {
  const lyric = await ownedLyrics(db, audio)
  if (!lyric) return null
  const current = path.parse(audio)
  const entries = await readdir(current.dir).catch(() => null)
  if (
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
    return null
  return lyric
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
  if (row.lyric && row.lyric === (await recyclableLyrics(db, row.file))) {
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
async function directories(store) {
  const ignored = new Set(
    ['music-manual-dir', 'music-recommend-dir', 'music-category-root']
      .map((k) => store.get(k))
      .filter(Boolean)
      .map(pathKey),
  )
  const dirs = new Set(
    store.db
      .prepare('SELECT file FROM local_tracks WHERE listed=1 AND awaitingLocation=0')
      .all()
      .map((r) => path.dirname(r.file)),
  )
  const root = store.get('music-category-root')
  if (root && (await safeDir(root)))
    for (const entry of await readdir(root, { withFileTypes: true }))
      if (entry.isDirectory()) dirs.add(path.join(root, entry.name))
  const result = []
  for (const dir of dirs) {
    const name = path.basename(dir)
    if (!ignored.has(pathKey(dir)) && safeName(name) && (await safeDir(dir).catch(() => false)))
      result.push({ id: result.length + 1, name, dir })
  }
  return result
}
async function classify(store, row, model, chooseRoot, signal) {
  const options = await directories(store)
  const choice = await model(
    {
      title: metadata(row.title),
      artist: metadata(row.artist),
      album: metadata(row.album),
      categories: options.map(({ id, name }) => ({ id, name })),
    },
    signal,
  )
  signal.throwIfAborted()
  if (choice.category !== undefined) return options.find((r) => r.id === choice.category)?.dir
  const name = choice.newCategory
  if (!safeName(name)) return
  const same = options.filter((r) => r.name.toLowerCase() === name.toLowerCase())
  if (same.length) return same.length === 1 ? same[0].dir : undefined
  let root = store.get('music-category-root')
  if (!root) {
    root = await chooseRoot()
    signal.throwIfAborted()
    if (!root || !(await safeDir(root))) return
    store.set('music-category-root', root)
  }
  if (!(await safeDir(root))) return
  const dir = path.join(root, name)
  if (pathKey(path.dirname(dir)) !== pathKey(root)) return
  await mkdir(dir).catch((e) => {
    if (e.code !== 'EEXIST') throw e
  })
  if (await safeDir(dir)) return dir
}
async function moveFavorite(store, row, target, sourceRevision, lyric, onMove, signal) {
  const db = store.db
  const file = path.join(target, path.basename(row.file))
  if (pathKey(file) === pathKey(row.file)) return
  // Copy exclusively before switching the index. A power loss always leaves a playable copy.
  const copies = []
  const sources = []
  const copy = async (src, dst) => {
    const old = stat(src)
    await copyFile(src, dst, constants.COPYFILE_EXCL)
    const created = stat(dst)
    copies.push([dst, revision(created)])
    sources.push([src, revision(old)])
    if (created.size !== old.size || revision(stat(src)) !== revision(old))
      throw Error('源文件已变化')
    return created
  }
  const checkPaths = () => {
    signal.throwIfAborted()
    if (
      pathKey(realpathSync(target)) !== pathKey(target) ||
      pathKey(realpathSync(row.file)) !== pathKey(row.file) ||
      !db
        .prepare('SELECT 1 FROM local_tracks WHERE id=? AND file=? AND favorite=1')
        .get(row.id, row.file) ||
      revision(stat(row.file)) !== sourceRevision
    )
      throw Error('目录或原曲已变化')
  }
  try {
    checkPaths()
    if (stat(lyricPath(file))) throw Error('目标歌词冲突')
    const audio = await copy(row.file, file)
    const dst = lyricPath(file)
    const s = lyric ? await copy(lyric, dst) : null
    if (lyric && lyric !== (await recyclableLyrics(db, row.file))) throw Error('歌词已变化')
    checkPaths()
    if (copies.some(([dst, version]) => revision(stat(dst)) !== version))
      throw Error('目标文件已变化')
    db.exec('BEGIN IMMEDIATE')
    if (s) {
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
    db.exec('COMMIT')
  } catch (e) {
    if (db.isTransaction) db.exec('ROLLBACK')
    for (const [dst, version] of copies)
      if (stat(dst) && revision(stat(dst)) === version) unlinkSync(dst)
    throw e
  }
  onMove(row.id, file)
  for (const [src, version] of sources)
    if (stat(src) && revision(stat(src)) === version) unlinkSync(src)
}
export async function retireDownloads(
  store,
  previous,
  { model, chooseRoot, trash, forget, onMove },
  signal,
) {
  const rows = store.db
    .prepare(`SELECT d.*,t.title,t.artist,t.album,t.favorite,t.id FROM daily_downloads d
    JOIN local_tracks t ON d.local=t.id AND d.file=t.file WHERE d.batch=? AND t.awaitingLocation=0
    AND NOT EXISTS(SELECT 1 FROM recording_copies c WHERE c.local=t.id AND c.automatic=0)`)
    .all(previous)
  const protectedIds = new Set(rows.filter((r) => r.favorite).map((r) => r.id))
  let failures = 0
  const favorites = []
  for (const row of rows) {
    try {
      signal.throwIfAborted()
      if (protectedIds.has(row.id)) {
        favorites.push(row)
        continue
      }
      const version = await verifyDownload(row)
      const lyric = await recyclableLyrics(store.db, row.file)
      const fresh = store.db
        .prepare('SELECT favorite,file FROM local_tracks WHERE id=?')
        .get(row.id)
      if (!version || !fresh || fresh.file !== row.file || revision(stat(row.file)) !== version)
        continue
      signal.throwIfAborted()
      if (fresh.favorite) favorites.push(row)
      else await trashAudio(store, row, lyric, trash, forget)
    } catch (e) {
      signal.throwIfAborted()
      failures++
    }
  }
  let rootPrompt
  const selectRoot = () => (rootPrompt ??= chooseRoot())
  const archive = async () => {
    for (const row of favorites) {
      try {
        signal.throwIfAborted()
        const dir = await classify(store, row, model, selectRoot, signal)
        if (!dir) continue
        const version = await verifyDownload(row)
        const lyric = await recyclableLyrics(store.db, row.file)
        signal.throwIfAborted()
        if (version) await moveFavorite(store, row, dir, version, lyric, onMove, signal)
      } catch {
        if (signal.aborted) return
      }
    }
  }
  return { archive, failures }
}
