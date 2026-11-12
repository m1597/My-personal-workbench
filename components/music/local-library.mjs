import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { pathKey, regularFile } from './local-files.mjs'

const folderKey = (dir) => createHash('sha256').update(pathKey(dir)).digest('hex')
function playlistName(name) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80)
    throw Error('歌单名称须为 1 至 80 个字符')
  return name.trim()
}
export class LocalLibrary {
  constructor(store) {
    this.store = store
    this.db = store.db
    this.job = { running: false, added: 0, duplicates: 0, failed: 0, cancelled: false }
    this.db.exec('BEGIN')
    try {
      this.db.exec(
        'CREATE TABLE IF NOT EXISTS local_tracks(id TEXT PRIMARY KEY, path_key TEXT UNIQUE, file TEXT NOT NULL,title TEXT NOT NULL,artist TEXT NOT NULL,album TEXT NOT NULL,duration REAL NOT NULL,available INTEGER NOT NULL DEFAULT 1,unplayable INTEGER NOT NULL DEFAULT 0)',
      )
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS music_roots(dir TEXT PRIMARY KEY COLLATE NOCASE);
        CREATE TABLE IF NOT EXISTS playlists(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE COLLATE NOCASE);
        CREATE TABLE IF NOT EXISTS playlist_tracks(
          playlist TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
          track TEXT NOT NULL REFERENCES local_tracks(id) ON DELETE CASCADE,
          PRIMARY KEY(playlist,track)
        );
        CREATE TABLE IF NOT EXISTS recording_versions(version TEXT PRIMARY KEY, local TEXT NOT NULL, automatic INTEGER NOT NULL, source TEXT, platform TEXT, sourceId TEXT, quality TEXT);
        CREATE TABLE IF NOT EXISTS recommended_items(item TEXT PRIMARY KEY, local TEXT, error TEXT DEFAULT '');
        CREATE INDEX IF NOT EXISTS recorded_local ON recording_versions(local);
        CREATE INDEX IF NOT EXISTS playlist_track_lookup ON playlist_tracks(track);
      `)
      if (
        !this.db
          .prepare('PRAGMA table_info(local_tracks)')
          .all()
          .some((col) => col.name === 'listed')
      )
        this.db.exec('ALTER TABLE local_tracks ADD COLUMN listed INTEGER NOT NULL DEFAULT 1')
      if (!store.get('local-index-v1')) {
        for (const row of this.db.prepare('SELECT track,file FROM library').all())
          this.saved(row.track, row.file)
        store.set('local-index-v1', 1)
      }
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }
  saved(track, filename) {
    const t = this.store.metadata(track),
      root = this.store.get('root')
    if (t && root && path.basename(filename) === filename)
      this.upsert({
        file: path.join(root, filename),
        title: t.title,
        artist: t.artist,
        album: t.album,
        duration: t.duration ?? 20,
      })
  }
  upsert(row, replacing) {
    const key = pathKey(row.file)
    const existing = this.db.prepare('SELECT id FROM local_tracks WHERE path_key=?').get(key)
    if (replacing && existing && existing.id !== replacing) throw Error('所选文件已经在曲库中')
    const values = [key, row.file, row.title, row.artist, row.album, row.duration]
    if (replacing || existing)
      this.db
        .prepare(
          'UPDATE local_tracks SET path_key=?,file=?,title=?,artist=?,album=?,duration=?,available=1,unplayable=0,listed=1 WHERE id=?',
        )
        .run(...values, replacing ?? existing.id)
    else
      this.db
        .prepare(
          'INSERT INTO local_tracks(path_key,file,title,artist,album,duration,id) VALUES(?,?,?,?,?,?,?)',
        )
        .run(...values, 'local-' + randomUUID())
    this.changed?.()
    return !!(existing || replacing)
  }
  list() {
    const roots = new Set(
      this.db
        .prepare('SELECT dir FROM music_roots')
        .all()
        .map((r) => pathKey(r.dir)),
    )
    const rows = this.db
      .prepare(
        `SELECT id,title,artist,album,duration,available,listed,file,(SELECT source || ' · ' || quality FROM recording_versions v WHERE v.local=local_tracks.id AND v.automatic=1 LIMIT 1) AS recommendationSource FROM local_tracks ORDER BY title COLLATE NOCASE,artist,id`,
      )
      .all()
    const parents = new Set(rows.filter((r) => r.listed).map((r) => pathKey(path.dirname(r.file))))
    const cached = new Map()
    function folders(dir) {
      if (cached.has(dir)) return cached.get(dir)
      const ancestors = [dir]
      while (path.dirname(ancestors[0]) !== ancestors[0])
        ancestors.unshift(path.dirname(ancestors[0]))
      let start = ancestors.findIndex((d) => roots.has(pathKey(d)))
      if (start < 0) start = ancestors.findIndex((d) => parents.has(pathKey(d)))
      const result = ancestors.slice(start).map((d) => ({
        id: folderKey(d),
        name: path.basename(d) || path.parse(d).root,
      }))
      cached.set(dir, result)
      return result
    }
    return rows.map(({ file, ...row }) => ({
      ...row,
      folders: row.listed ? folders(path.dirname(file)) : [],
    }))
  }
  playlists() {
    const lists = this.db.prepare('SELECT id,name FROM playlists ORDER BY rowid').all()
    const byId = new Map(lists.map((list) => [list.id, { ...list, tracks: [] }]))
    for (const row of this.db
      .prepare('SELECT playlist,track FROM playlist_tracks ORDER BY rowid')
      .all()) {
      byId.get(row.playlist).tracks.push(row.track)
    }
    const recommended = this.db
      .prepare(
        'SELECT DISTINCT r.local FROM recommended_items r JOIN local_tracks t ON r.local=t.id',
      )
      .all()
    return [
      ...(recommended.length
        ? [
            {
              id: 'system-recommendations',
              name: '歌曲推荐',
              system: true,
              tracks: recommended.map((r) => r.local),
            },
          ]
        : []),
      ...byId.values(),
    ]
  }
  createPlaylist(name) {
    const id = randomUUID()
    if (
      !this.db
        .prepare('INSERT OR IGNORE INTO playlists(id,name) VALUES(?,?)')
        .run(id, playlistName(name)).changes
    )
      throw Error('已有同名歌单')
    return id
  }
  renamePlaylist(id, name) {
    if (
      !this.db
        .prepare('UPDATE OR IGNORE playlists SET name=? WHERE id=?')
        .run(playlistName(name), id).changes
    )
      throw Error('已有同名歌单或歌单已移除')
  }
  deletePlaylist(id) {
    if (!this.db.prepare('DELETE FROM playlists WHERE id=?').run(id).changes)
      throw Error('未找到歌单')
  }
  removeFolder(id) {
    if (this.worker) throw Error('请等待当前导入结束')
    const rows = this.list().filter((row) => row.folders.some((folder) => folder.id === id))
    if (!rows.length) throw Error('未找到文件夹')
    let dir = path.dirname(this.row(rows[0].id).file)
    while (folderKey(dir) !== id) {
      if (path.dirname(dir) === dir) throw Error('文件夹已变化')
      dir = path.dirname(dir)
    }
    const retained = new Set(this.playlists().flatMap((list) => list.tracks))
    const detached = this.db.prepare('UPDATE local_tracks SET listed=0 WHERE id=?')
    const removed = []
    for (const row of rows) {
      if (retained.has(row.id)) detached.run(row.id)
      else {
        this.remove(row.id)
        removed.push(row.id)
      }
    }
    for (const root of this.db.prepare('SELECT dir FROM music_roots').all()) {
      const rel = path.relative(dir, root.dir)
      if (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep))
        this.db.prepare('DELETE FROM music_roots WHERE dir=?').run(root.dir)
    }
    return removed
  }
  setMembership(playlist, track, added) {
    if (typeof playlist !== 'string' || typeof track !== 'string' || typeof added !== 'boolean')
      throw Error('歌单操作无效')
    this.row(track)
    if (!this.db.prepare('SELECT 1 FROM playlists WHERE id=?').get(playlist))
      throw Error('未找到歌单')
    if (added)
      this.db.prepare('INSERT OR IGNORE INTO playlist_tracks VALUES(?,?)').run(playlist, track)
    else
      this.db
        .prepare('DELETE FROM playlist_tracks WHERE playlist=? AND track=?')
        .run(playlist, track)
    this.changed?.()
  }
  row(id) {
    const row = this.db.prepare('SELECT * FROM local_tracks WHERE id=?').get(id)
    if (!row) throw Error('歌曲已移除')
    return row
  }
  async verify(row) {
    const ok = !row.unplayable && (await regularFile(row.file))
    if (Number(ok) !== row.available)
      this.db
        .prepare('UPDATE local_tracks SET available=? WHERE id=? AND file=?')
        .run(Number(ok), row.id, row.file)
    return ok
  }
  async refresh() {
    this.refreshing ??= (async () => {
      const rows = this.db.prepare('SELECT id,file,available,unplayable FROM local_tracks').all()
      for (let i = 0; i < rows.length; i += 16)
        await Promise.all(rows.slice(i, i + 16).map((r) => this.verify(r)))
    })().finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }
  remove(id) {
    this.db.prepare('DELETE FROM local_tracks WHERE id=?').run(id)
  }
  start(paths, folder, replacing) {
    if (this.worker) throw Error('导入正在进行')
    if (replacing) this.row(replacing)
    const worker = new Worker(new URL('./library-worker.mjs', import.meta.url), {
      workerData: { paths, folder },
    })
    if (folder)
      this.db
        .prepare('INSERT OR IGNORE INTO music_roots(dir) VALUES(?)')
        .run(path.resolve(paths[0]))
    this.worker = worker
    const job = {
      started: true,
      running: true,
      added: 0,
      duplicates: 0,
      failed: 0,
      cancelled: false,
    }
    this.job = job
    worker.on('message', ({ rows, failed }) => {
      if (job.cancelled) return
      job.failed += failed
      for (const row of rows) {
        try {
          if (this.upsert(row, replacing)) job.duplicates++
          else job.added++
        } catch {
          job.failed++
        }
      }
    })
    worker.on('error', () => {
      job.failed++
    })
    worker.on('exit', () => {
      job.running = false
      this.worker = null
    })
  }
  cancel() {
    if (this.worker) {
      this.job.cancelled = true
      void this.worker.terminate()
    }
  }
}
