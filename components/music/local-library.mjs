import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { catalogue } from './offline-source.mjs'
import { pathKey, regularFile } from './local-files.mjs'

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
    const t = catalogue.find((i) => i.id === track),
      root = this.store.get('root')
    if (t && root && path.basename(filename) === filename)
      this.upsert({
        file: path.join(root, filename),
        title: t.title,
        artist: t.artist,
        album: t.album,
        duration: 20,
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
          'UPDATE local_tracks SET path_key=?,file=?,title=?,artist=?,album=?,duration=?,available=1,unplayable=0 WHERE id=?',
        )
        .run(...values, replacing ?? existing.id)
    else
      this.db
        .prepare(
          'INSERT INTO local_tracks(path_key,file,title,artist,album,duration,id) VALUES(?,?,?,?,?,?,?)',
        )
        .run(...values, 'local-' + randomUUID())
    return !!(existing || replacing)
  }
  list() {
    return this.db
      .prepare(
        'SELECT id,title,artist,album,duration,available FROM local_tracks ORDER BY title COLLATE NOCASE,artist,id',
      )
      .all()
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
