import { createHash } from 'node:crypto'
import { watch } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import path from 'node:path'
import {
  isDirectPath,
  confirmedMissing,
  pathKey,
  fileIdentity,
  openAudio,
} from './music/local-files.mjs'

const watchStamp = (info) => [info.dev, info.ino, info.size, info.mtimeNs].join(':')
async function digestFile(row, stamp) {
  const handle = await openAudio(row.file, row.identity)
  try {
    const hash = createHash('sha256')
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk)
    if (watchStamp(await handle.stat({ bigint: true })) === stamp) return hash.digest('hex')
  } finally {
    await handle.close()
  }
}

// Reconcile on startup/reconnection. During normal operation, enumerate only a dirty directory.
export class WatchedLibrary {
  constructor(library, notify, interval = 5000, onMove = () => {}) {
    this.library = library
    this.copyObservations = new Map()
    library.db.exec(`CREATE TABLE IF NOT EXISTS watched_recording_digests(
      local TEXT PRIMARY KEY REFERENCES local_tracks(id) ON DELETE CASCADE,
      stamp TEXT NOT NULL, digest TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS watched_recording_digest ON watched_recording_digests(digest);`)
    this.notify = notify
    this.onMove = onMove
    this.directories = new Map()
    this.timer = setInterval(() => this.schedule(), interval)
    this.timer.unref()
    this.schedule()
  }
  schedule() {
    if (!this.closed && !this.pending)
      this.pending = setTimeout(() => {
        this.pending = null
        void this.run().catch(() => {}) // The next health check retries inaccessible volumes.
      }, 200)
  }
  close() {
    this.closed = true
    clearInterval(this.timer)
    clearTimeout(this.pending)
    for (const dir of this.directories.values()) dir.watcher?.close()
    this.directories.clear()
  }
  async run() {
    if (this.closed || this.running || this.library.job.running) return
    this.running = true
    try {
      const roots = this.library.db
        .prepare('SELECT dir FROM watched_music_roots WHERE dir IN (SELECT dir FROM music_roots)')
        .all()
      const active = new Set(roots.map(({ dir }) => dir.toLowerCase()))
      for (const [key, state] of this.directories) {
        if (!active.has(state.root.toLowerCase())) {
          state.watcher?.close()
          this.directories.delete(key)
        }
      }
      const remember = (dir, root) => {
        const key = dir.toLowerCase()
        if (!this.directories.has(key)) this.directories.set(key, { dir, root, dirty: true })
      }
      for (const { dir } of roots) remember(dir, dir)
      let music = false,
        lyrics = false
      // Map iteration also visits newly discovered subdirectories in this pass.
      for (const [key, state] of this.directories) {
        if (this.closed) return
        const { dir, root } = state
        try {
          if (!(await this.library.acceptsVolume(dir))) throw Error('请连接原音乐盘')
          const info = await lstat(dir, { bigint: true })
          if (!info.isDirectory() || !(await isDirectPath(dir))) throw Error()
          if (this.closed) return
          const identity = [info.dev, info.ino, info.birthtimeNs].join(':')
          if (state.identity !== identity || !state.watcher) {
            state.watcher?.close()
            state.identity = identity
            state.dirty = true
            const dirty = () => {
              state.dirty = true
              this.schedule()
            }
            try {
              state.watcher = watch(dir, { persistent: false }, dirty)
              state.watcher.on('error', () => {
                state.watcher?.close()
                state.watcher = null
                dirty()
              })
            } catch {
              state.watcher = null
            }
          }
          if (!state.dirty && state.mtime === info.mtimeNs && !(state.retryAt <= Date.now()))
            continue
          state.dirty = false
          state.mtime = info.mtimeNs
          const entries = await readdir(dir, { withFileTypes: true })
          if (this.closed) return
          state.offline = false
          const files = []
          for (const entry of entries) {
            const file = path.join(dir, entry.name)
            if (entry.isDirectory()) remember(file, root)
            else if (entry.isFile() && /\.(mp3|flac|m4a|wav|lrc)$/i.test(entry.name))
              files.push(file)
          }
          const result = await this.reconcile(dir, files)
          // A writer may release an exclusive handle without a second filesystem event.
          if (result.retry) {
            state.retryDelay = Math.min(300_000, (state.retryDelay ?? 2500) * 2)
            state.retryAt = Date.now() + state.retryDelay
          } else {
            state.retryDelay = undefined
            state.retryAt = undefined
          }
          music ||= result.music
          lyrics ||= result.lyrics
        } catch (error) {
          if (this.closed) return
          state.dirty = true
          state.watcher?.close()
          state.watcher = null
          if (!state.offline) music = this.setUnavailable(dir) || music
          state.offline = true
          if (key !== root.toLowerCase() && ['ENOENT', 'ENOTDIR'].includes(error.code))
            this.directories.delete(key)
        }
      }
      if (!this.closed && (music || lyrics)) this.notify({ music, lyrics })
    } finally {
      this.running = false
    }
  }
  setUnavailable(dir) {
    const prefix = (dir.endsWith(path.sep) ? dir : dir + path.sep).toLowerCase()
    return Boolean(
      this.library.db
        .prepare(
          'UPDATE local_tracks SET available=0 WHERE available=1 AND substr(path_key,1,length(?))=?',
        )
        .run(prefix, prefix).changes,
    )
  }
  async reconcile(dir, files) {
    const db = this.library.db
    const known = new Map(
      db
        .prepare('SELECT file,stamp FROM watched_music_files WHERE dir=?')
        .all(dir.toLowerCase())
        .map((r) => [r.file, r.stamp]),
    )
    const changed = new Map()
    let music = false,
      lyrics = false
    const save = db.prepare(
      'INSERT OR REPLACE INTO watched_music_files(dir,file,stamp) VALUES(?,?,?)',
    )
    for (const file of files) {
      const key = file.toLowerCase()
      const old = known.get(key)
      known.delete(key)
      const info = await lstat(file, { bigint: true }).catch(() => null)
      if (this.closed) return {}
      if (!info?.isFile()) continue
      const stamp = watchStamp(info)
      if (/\.lrc$/i.test(file)) {
        if (old !== stamp) {
          save.run(dir.toLowerCase(), key, stamp)
          lyrics = true
        }
      } else if (
        old !== stamp ||
        !db
          .prepare(
            'SELECT 1 FROM watched_recording_digests d JOIN local_tracks t ON t.id=d.local WHERE t.path_key=? AND d.stamp=?',
          )
          .get(key, stamp)
      ) {
        // Do not open a file that is still being copied by an application move.
        if (
          !db.prepare('SELECT 1 FROM favorite_moves WHERE destination=? COLLATE NOCASE').get(file)
        )
          changed.set(file, stamp)
      } else {
        const restored = db
          .prepare(
            'UPDATE local_tracks SET available=1 WHERE path_key=? AND available=0 AND unplayable=0 AND awaitingLocation=0',
          )
          .run(key)
        music ||= Boolean(restored.changes)
      }
    }
    if (this.closed || !(await this.library.acceptsVolume(dir))) return {}
    for (const file of known.keys()) {
      this.copyObservations.delete(file)
      db.prepare('DELETE FROM watched_music_files WHERE file=?').run(file)
      if (/\.lrc$/i.test(file)) lyrics = true
      else {
        const missing = db
          .prepare('UPDATE local_tracks SET available=0 WHERE path_key=? AND available=1')
          .run(file)
        music ||= Boolean(missing.changes)
      }
    }
    let processed = 0
    if (changed.size) {
      const rows = await this.library.scanFiles([...changed.keys()])
      if (this.closed) return {}
      for (const row of rows) {
        // A move in progress has not switched the index yet. Retry after its journal closes.
        if (
          db
            .prepare(
              'SELECT 1 FROM favorite_moves WHERE original=? OR destination=? COLLATE NOCASE',
            )
            .get(row.file, row.file)
        )
          continue
        const current = await lstat(row.file, { bigint: true }).catch(() => null)
        if (!current || fileIdentity(current) !== row.identity) continue
        const stamp = changed.get(row.file)
        if (watchStamp(current) !== stamp) continue
        const key = pathKey(row.file)
        const existing = db.prepare('SELECT id FROM local_tracks WHERE path_key=?').get(key)
        const cached =
          existing &&
          db
            .prepare('SELECT digest FROM watched_recording_digests WHERE local=? AND stamp=?')
            .get(existing.id, stamp)
        const digest = cached?.digest || (await digestFile(row, stamp).catch(() => null))
        if (!digest || this.closed) continue
        let candidates = row.identity
          ? db
              .prepare('SELECT id,file FROM local_tracks WHERE fileIdentity=? AND path_key<>?')
              .all(row.identity, pathKey(row.file))
          : []
        if (!existing && !candidates.length) {
          candidates = db
            .prepare(
              'SELECT t.id,t.file,t.fileIdentity FROM watched_recording_digests d JOIN local_tracks t ON t.id=d.local WHERE digest=?',
            )
            .all(digest)
          // A cross-volume move is initially visible as a copy. Give the file manager
          // time to remove the source; a lasting duplicate gets an independent ID.
          if (
            candidates.length === 1 &&
            candidates[0].fileIdentity?.split(':')[0] !== String(current.dev) &&
            !(await confirmedMissing(candidates[0].file))
          ) {
            const first = this.copyObservations.get(key) ?? Date.now()
            this.copyObservations.set(key, first)
            if (Date.now() - first < 3000) continue
          }
        }
        this.copyObservations.delete(key)
        const original = candidates.length === 1 ? candidates[0] : null
        const missing =
          original &&
          (await this.library.acceptsVolume(original.file)) &&
          (await confirmedMissing(original.file))
        const final = await lstat(row.file, { bigint: true }).catch(() => null)
        if (!final || watchStamp(final) !== stamp || this.closed) continue
        if (
          db
            .prepare(
              'SELECT 1 FROM favorite_moves WHERE original=? COLLATE NOCASE OR destination=? COLLATE NOCASE',
            )
            .get(row.file, row.file)
        )
          continue
        if (
          missing &&
          !db.prepare('SELECT 1 FROM local_tracks WHERE path_key=?').get(key) &&
          db
            .prepare('SELECT 1 FROM local_tracks WHERE id=? AND file=?')
            .get(original.id, original.file)
        ) {
          this.library.upsert(row, original.id)
          this.library.restoreMovedMembership(original.id)
          this.onMove(original.id, row.file)
          db.prepare('DELETE FROM daily_downloads WHERE local=? AND file=?').run(
            original.id,
            original.file,
          )
        } else this.library.upsert(row)
        db.prepare(
          'INSERT OR REPLACE INTO watched_recording_digests(local,stamp,digest) SELECT id,?,? FROM local_tracks WHERE path_key=?',
        ).run(stamp, digest, key)
        save.run(dir.toLowerCase(), key, stamp)
        music = true
        processed++
      }
    }
    return { music, lyrics, retry: processed < changed.size }
  }
}
