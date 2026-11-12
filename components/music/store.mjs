import { DatabaseSync } from 'node:sqlite'
import {
  mkdirSync,
  existsSync,
  readFileSync,
  unlinkSync,
  copyFileSync,
  constants,
  lstatSync,
  readdirSync,
} from 'node:fs'
import { writeFile, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { catalogue, recording, offlineSuggestions } from './offline-source.mjs'
import { LocalLibrary } from './local-library.mjs'
const hash = (b) => createHash('sha256').update(b).digest('hex')
const day = () => new Intl.DateTimeFormat('sv-SE').format(new Date())
// MoveFileW refuses an existing destination and renames within the selected volume.
import { createRequire } from 'node:module'
let moveFile
export function publish(temp, dest) {
  moveFile ??= createRequire(import.meta.url)('koffi')
    .load('kernel32.dll')
    .func('int __stdcall MoveFileW(str16, str16)')
  if (!moveFile(temp, dest)) throw Error('无法发布录音，请检查空间、目录权限与文件占用')
}
const cutoff = 24 * 60 * 60 * 1000
export class MusicStore {
  constructor(root) {
    mkdirSync(root, { recursive: true })
    this.cache = path.join(root, 'audition-cache')
    mkdirSync(this.cache, { recursive: true })
    this.db = new DatabaseSync(path.join(root, 'music.sqlite'))
    this.db.exec(`CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY,day TEXT,preference TEXT);
    CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY,batch TEXT,title TEXT,artist TEXT,reason TEXT,track TEXT,status TEXT,checked INTEGER DEFAULT 0,used INTEGER,digest TEXT);
    CREATE TABLE IF NOT EXISTS library(track TEXT PRIMARY KEY,file TEXT,digest TEXT,album TEXT,version TEXT);
    CREATE TABLE IF NOT EXISTS saves(track TEXT PRIMARY KEY,temp TEXT,file TEXT,digest TEXT);`)
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS online_recordings(track TEXT PRIMARY KEY,title TEXT,artist TEXT,album TEXT,duration REAL,ext TEXT)',
    )
    for (const file of readdirSync(this.cache)) {
      if (/^\.fitbay-[a-f0-9-]{36}\.part$/.test(file)) unlinkSync(path.join(this.cache, file))
    }
    this.jobs = new Map()
    this.active = null
    this.db.exec("UPDATE items SET status='中断' WHERE status IN ('等候','下载中')")
    for (const { id } of this.db.prepare('SELECT id FROM items').all())
      this.removeCache(id, '.part')
    this.library = new LocalLibrary(this)
    this.db.exec(
      "UPDATE items SET status='待重试' WHERE id IN (SELECT item FROM recommended_items) AND status IN ('正在匹配','正在保存','待处理','待选录音')",
    )
    this.recover()
    this.cleanup(false)
  }
  get(key) {
    return this.db.prepare('SELECT value FROM state WHERE key=?').get(key)?.value ?? ''
  }
  set(key, value) {
    this.db.prepare('INSERT OR REPLACE INTO state VALUES(?,?)').run(key, String(value))
  }
  metadata(track) {
    return (
      catalogue.find((t) => t.id === track) ??
      this.db
        .prepare('SELECT *, track AS id, album AS version FROM online_recordings WHERE track=?')
        .get(track)
    )
  }
  cacheOnline(id, temp, metadata, ext) {
    const row = this.item(id)
    if (
      !['模型推荐', '已过期', '文件缺失'].includes(row.status) ||
      this.active === id ||
      !['.wav', '.mp3', '.flac', '.m4a'].includes(ext)
    )
      throw Error('请重新选择推荐录音')
    const digest = hash(readFileSync(temp))
    const track = 'online-' + digest
    const dest = this.file(id, ext)
    // A crash between cache publication and the SQLite commit may leave this private file behind.
    if (existsSync(dest)) unlinkSync(dest)
    let published = false
    this.db.exec('BEGIN')
    try {
      this.db
        .prepare('INSERT OR REPLACE INTO online_recordings VALUES(?,?,?,?,?,?)')
        .run(track, metadata.title, metadata.artist, metadata.album, metadata.duration, ext)
      this.db
        .prepare("UPDATE items SET track=?,digest=?,status='就绪',used=? WHERE id=?")
        .run(track, digest, Date.now(), id)
      publish(temp, dest)
      published = true
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      if (published) unlinkSync(dest)
      throw e
    }
  }
  file(id, ext) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('未知曲目')
    return path.join(this.cache, id + (ext ?? this.metadata(this.item(id).track)?.ext ?? '.wav'))
  }
  removeCache(id, ext) {
    const f = this.file(id, ext)
    if (existsSync(f)) unlinkSync(f)
  }
  item(id) {
    const row = this.db.prepare('SELECT * FROM items WHERE id=?').get(id)
    if (!row) throw Error('未知曲目')
    return row
  }
  summary() {
    return this.db
      .prepare('SELECT title,artist FROM local_tracks ORDER BY rowid DESC LIMIT 5')
      .all()
      .map((t) => [t.title, t.artist].map((v) => v.slice(0, 100)).join(' · '))
  }
  preferenceSummary() {
    return this.db
      .prepare(
        'SELECT artist, COUNT(*) AS count FROM local_tracks GROUP BY artist ORDER BY count DESC,artist LIMIT 50',
      )
      .all()
      .map(({ artist, count }) => artist.slice(0, 100) + ' · ' + count + ' 首')
  }
  snapshot() {
    const batches = this.db.prepare('SELECT * FROM batches ORDER BY rowid DESC').all()
    const items = this.db
      .prepare(
        'SELECT i.*, COALESCE(t.duration,o.duration) AS audioDuration, r.item AS daily, r.local AS localId, r.error AS downloadError,r.diagnosis AS diagnosis,t.available AS localAvailable FROM items i LEFT JOIN online_recordings o ON i.track=o.track LEFT JOIN recommended_items r ON r.item=i.id LEFT JOIN local_tracks t ON t.id=r.local ORDER BY i.rowid',
      )
      .all()
      .map((row) => ({
        ...row,
        status: row.daily && row.status === '已入库' && !row.localAvailable ? '待重试' : row.status,
        online: row.status === '模型推荐' || row.track?.startsWith('online-') || false,
        candidates: catalogue.filter((t) => t.title === row.title && t.artist === row.artist),
      }))
    return {
      localTracks: this.library.list(),
      playlists: this.library.playlists(),
      importJob: this.library.job,
      queue: JSON.parse(this.get('play-queue') || '[]'),
      batches,
      items,
      summary: this.preferenceSummary(),

      draft: this.get('draft'),
      current: this.get('current'),
      position: Number(this.get('position')),
      hasLibrary: !!this.get('root'),
    }
  }
  generate(preference, summary) {
    return this.saveSuggestions(preference, offlineSuggestions(preference, summary), '待匹配')
  }
  saveSuggestions(preference, rows, status) {
    const batch = randomUUID()
    this.db.exec('BEGIN')
    try {
      this.db.prepare('INSERT INTO batches VALUES(?,?,?)').run(batch, day(), preference)
      for (const row of rows)
        this.db
          .prepare(
            'INSERT INTO items(id,batch,title,artist,reason,status,used) VALUES(?,?,?,?,?,?,?)',
          )
          .run(randomUUID(), batch, row.title, row.artist, row.reason, status, Date.now())
      if (status === '待处理')
        this.db
          .prepare('INSERT INTO recommended_items(item) SELECT id FROM items WHERE batch=?')
          .run(batch)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
    return batch
  }
  match(batch) {
    for (const row of this.db
      .prepare("SELECT * FROM items WHERE batch=? AND status='待匹配'")
      .all(batch)) {
      const hits = catalogue.filter((t) => t.title === row.title && t.artist === row.artist)
      if (hits.length === 1) this.choose(row.id, hits[0].id)
      else this.status(row.id, hits.length ? '待选版本' : '目录无此录音')
    }
  }
  status(id, s) {
    this.db
      .prepare(
        "UPDATE items SET status=?,used=?,checked=CASE WHEN ? IN ('文件缺失','已过期') THEN 0 ELSE checked END WHERE id=?",
      )
      .run(s, Date.now(), s, id)
  }
  local(track) {
    const r = this.db.prepare('SELECT * FROM library WHERE track=?').get(track)
    if (!r) return
    const f = path.join(this.get('root'), r.file)
    if (existsSync(f) && lstatSync(f).isFile() && hash(readFileSync(f)) === r.digest) return f
  }
  choose(id, track) {
    const row = this.item(id)
    if (this.jobs.has(id) || this.active === id) throw Error('曲目使用中')
    if (!catalogue.some((t) => t.id === track && t.title === row.title && t.artist === row.artist))
      throw Error('无此版本')
    this.db.prepare('UPDATE items SET track=?,digest=NULL WHERE id=?').run(track, id)
    this.status(id, this.local(track) ? '已入库' : '等候')
    this.pump()
  }
  pump() {
    for (const row of this.db
      .prepare("SELECT * FROM items WHERE status='等候' ORDER BY rowid")
      .all()) {
      if (this.jobs.size >= 2) break
      if (this.jobs.has(row.id)) continue
      const job = new AbortController()
      this.jobs.set(row.id, job)
      this.status(row.id, '下载中')
      void this.download(row, job.signal)
        .catch(() => this.status(row.id, job.signal.aborted ? '已取消' : '下载失败'))
        .finally(() => {
          this.jobs.delete(row.id)
          this.pump()
        })
    }
  }
  async download(row, signal) {
    const part = this.file(row.id, '.part'),
      data = recording(row.track)
    try {
      await writeFile(part, data, { signal })
      const got = await readFile(part)
      signal.throwIfAborted()
      // The synthetic source is canonical PCM16 WAV; byte equality also verifies its header and all samples.
      if (!got.equals(data)) throw Error('录音校验失败')
      await rename(part, this.file(row.id))
      signal.throwIfAborted()
      this.db
        .prepare("UPDATE items SET digest=?,status='就绪',used=? WHERE id=?")
        .run(hash(got), Date.now(), row.id)
    } finally {
      await rm(part, { force: true })
    }
  }
  cancel(id) {
    const row = this.item(id)
    if (row.status === '等候') this.status(id, '已取消')
    this.jobs.get(id)?.abort()
  }
  release() {
    if (this.active)
      this.db.prepare('UPDATE items SET used=? WHERE id=?').run(Date.now(), this.active)
    this.active = null
  }
  bytes(id) {
    const row = this.item(id)
    const local = this.local(row.track)
    const file = local ?? this.file(id)
    if (!existsSync(file) || (!local && (!row.digest || hash(readFileSync(file)) !== row.digest))) {
      this.status(id, '文件缺失')
      throw Error('文件缺失，请重新获取')
    }
    const data = readFileSync(file)
    this.release()
    this.active = id
    this.status(id, local ? '已入库' : '就绪')
    return data
  }
  checkpoint(id, position) {
    this.db
      .prepare("INSERT OR REPLACE INTO state VALUES ('current',?),('position',?)")
      .run(id, String(position))
  }
  cleanup(now) {
    for (const r of this.db
      .prepare(
        "SELECT * FROM items WHERE digest IS NOT NULL OR status IN ('已取消','中断','下载失败')",
      )
      .all()) {
      if (r.id === this.active || this.jobs.has(r.id) || (!now && Date.now() - r.used < cutoff))
        continue
      this.removeCache(r.id)
      this.db.prepare('UPDATE items SET digest=NULL WHERE id=?').run(r.id)
      this.status(r.id, this.local(r.track) ? '已入库' : '已过期')
    }
  }
  keep(id) {
    const row = this.item(id),
      t = this.metadata(row.track),
      root = this.get('root')
    if (!root || !t) throw Error('请先选择音乐库和版本')
    if (this.local(t.id)) {
      this.library.saved(
        t.id,
        this.db.prepare('SELECT file FROM library WHERE track=?').get(t.id).file,
      )
      this.status(id, '已入库')
      return
    }
    const src = this.file(id)
    if (!row.digest || !existsSync(src) || hash(readFileSync(src)) !== row.digest)
      throw Error('请先重新获取完整录音')
    let op = this.db.prepare('SELECT * FROM saves WHERE track=?').get(t.id)
    if (!op) {
      const uuid = randomUUID()
      op = {
        track: t.id,
        temp: '.fitbay-' + uuid + '.part',
        file: t.id + '-' + uuid + (t.ext ?? '.wav'),
        digest: row.digest,
      }
      this.db
        .prepare('INSERT INTO saves VALUES(?,?,?,?)')
        .run(op.track, op.temp, op.file, op.digest)
    }
    const temp = path.join(root, op.temp)
    if (existsSync(temp) && hash(readFileSync(temp)) !== op.digest) unlinkSync(temp)
    if (!existsSync(temp)) copyFileSync(src, temp, constants.COPYFILE_EXCL)
    this.finish(op)
    this.status(id, '已入库')
  }
  finish(op) {
    const root = this.get('root'),
      temp = path.join(root, op.temp),
      dest = path.join(root, op.file)
    if (!existsSync(dest)) {
      if (!existsSync(temp) || hash(readFileSync(temp)) !== op.digest) throw Error('暂存不完整')
      publish(temp, dest)
    }
    if (!lstatSync(dest).isFile() || hash(readFileSync(dest)) !== op.digest)
      throw Error('目标校验失败')
    const t = this.metadata(op.track)
    this.db
      .prepare('INSERT OR REPLACE INTO library VALUES(?,?,?,?,?)')
      .run(t.id, op.file, op.digest, t.album, t.version)
    this.library.saved(t.id, op.file)
    if (existsSync(temp)) unlinkSync(temp)
    this.db.prepare('DELETE FROM saves WHERE track=?').run(t.id)
  }
  recover() {
    for (const op of this.db.prepare('SELECT * FROM saves').all()) {
      try {
        this.finish(op)
      } catch {}
    }
  }
}
