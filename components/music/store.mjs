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
const songKey = (title, artist) =>
  JSON.stringify([
    'song',
    ...[title, artist].map((v) => v.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()),
  ])
const recordingKey = (platform, id) => JSON.stringify(['recording', platform, id])
function legacyDigest(track) {
  return /^online-[a-f0-9]{64}$/.test(track) ? track.slice(7) : null
}
const cutoff = 24 * 60 * 60 * 1000
export class MusicStore {
  constructor(root) {
    mkdirSync(root, { recursive: true })
    this.cache = path.join(root, 'audition-cache')
    mkdirSync(this.cache, { recursive: true })
    this.db = new DatabaseSync(path.join(root, 'music.sqlite'))
    this.db.exec(`CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS recording_feedback(identity TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS dismissed_items(item TEXT PRIMARY KEY);
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
    this.db.exec(`CREATE TABLE IF NOT EXISTS recommendation_runs(batch TEXT PRIMARY KEY,targetCount INTEGER NOT NULL,state TEXT NOT NULL,message TEXT);
      UPDATE recommendation_runs SET state='cancelled',message='上次生成已中断' WHERE state='running'`)
    this.jobs = new Map()
    this.active = null
    this.db.exec("UPDATE items SET status='中断' WHERE status IN ('等候','下载中')")
    for (const { id } of this.db.prepare('SELECT id FROM items').all())
      this.removeCache(id, '.part')
    this.library = new LocalLibrary(this)
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS recent_daily_sources(source TEXT NOT NULL, platform TEXT NOT NULL, PRIMARY KEY(source,platform));`,
    )
    if (!this.get('daily-source-history-v1')) {
      this.db.exec(`INSERT OR IGNORE INTO recent_daily_sources SELECT source,platform FROM recording_copies
        WHERE automatic=1 AND source IS NOT NULL AND platform IS NOT NULL GROUP BY source,platform ORDER BY MAX(rowid)`)
      this.set('daily-source-history-v1', 1)
    }
    this.db.exec(`CREATE TABLE IF NOT EXISTS daily_downloads(
      local TEXT PRIMARY KEY REFERENCES local_tracks(id) ON DELETE CASCADE,
      batch TEXT NOT NULL,file TEXT NOT NULL,digest TEXT NOT NULL,identity TEXT);
      CREATE TABLE IF NOT EXISTS pending_trash(local TEXT PRIMARY KEY,file TEXT NOT NULL);`)
    if (
      !this.db
        .prepare('PRAGMA table_info(pending_trash)')
        .all()
        .some((c) => c.name === 'lyric')
    ) {
      this.db.exec(
        'ALTER TABLE pending_trash ADD COLUMN lyric TEXT; ALTER TABLE pending_trash ADD COLUMN recycled INTEGER NOT NULL DEFAULT 0',
      )
    }
    // Older downloads never recorded the original filesystem identity. Leave these files in place.
    if (!this.get('latest-daily-run')) {
      const prior = this.db
        .prepare('SELECT batch FROM recommendation_runs ORDER BY rowid DESC LIMIT 1')
        .get()
      if (prior) this.set('latest-daily-run', prior.batch)
    }
    this.db.exec(`CREATE TABLE IF NOT EXISTS recommended_songs(title TEXT,artist TEXT,PRIMARY KEY(title,artist));
      INSERT OR IGNORE INTO recommended_songs SELECT i.title,i.artist FROM items i
      JOIN recommended_items r ON r.item=i.id WHERE i.status != '已在曲库'`)
    this.migrateFeedbackDigests()
    this.db.exec(
      "UPDATE items SET status='待重试' WHERE id IN (SELECT item FROM recommended_items) AND status IN ('正在匹配','正在保存','正在校验','待处理','待选录音')",
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
  sidebarOrder(group) {
    const raw = this.get('sidebar-order-' + group)
    if (!raw) return []
    try {
      const ids = JSON.parse(raw)
      return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []
    } catch {
      return []
    }
  }
  moveSidebarItem(group, id, target, after) {
    if (!['folders', 'playlists'].includes(group) || typeof after !== 'boolean')
      throw Error('无效的曲库分组')
    const entries =
      group === 'folders'
        ? [
            ...new Map(
              this.library
                .list()
                .filter((r) => r.folder)
                .map((r) => [r.folder.id, r.folder]),
            ).values(),
          ].sort((a, b) => a.name.localeCompare(b.name))
        : this.library.playlists()
    const valid = new Set(entries.map((e) => e.id))
    if (!valid.has(id) || !valid.has(target)) throw Error('曲库分组已变化，请重新排序')
    if (id === target) return
    const order = [
      ...new Set([...this.sidebarOrder(group).filter((key) => valid.has(key)), ...valid]),
    ].filter((key) => key !== id)
    order.splice(order.indexOf(target) + Number(after), 0, id)
    this.set('sidebar-order-' + group, JSON.stringify(order))
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
  migrateFeedbackDigests() {
    if (this.get('feedback-digests-v1')) return
    this.db.exec('BEGIN')
    try {
      const marked = this.db
        .prepare(
          `SELECT i.title,i.artist,i.track,EXISTS(SELECT 1 FROM recommended_items r JOIN recording_copies c ON c.local=r.local WHERE r.item=i.id AND c.sourceId IS NOT NULL AND c.platform IS NOT NULL) AS knownCopy
        FROM dismissed_items d JOIN items i ON i.id=d.item`,
        )
        .all()
      const unresolved = new Set(
        marked
          .filter(
            (r) =>
              !r.knownCopy && !legacyDigest(r.track) && !catalogue.some((t) => t.id === r.track),
          )
          .map((r) => songKey(r.title, r.artist)),
      )
      for (const row of marked) {
        const digest = legacyDigest(row.track)
        if (!digest) continue
        this.db
          .prepare('INSERT OR IGNORE INTO recording_feedback VALUES(?)')
          .run(recordingKey('content', digest))
        const oldKey = songKey(row.title, row.artist)
        if (!unresolved.has(oldKey))
          this.db.prepare('DELETE FROM recording_feedback WHERE identity=?').run(oldKey)
      }
      this.set('feedback-digests-v1', 1)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }
  feedbackIds() {
    return new Set(
      this.db
        .prepare('SELECT identity FROM recording_feedback')
        .all()
        .map((r) => r.identity),
    )
  }
  ignoresRecording(platform, id) {
    return !!this.db
      .prepare('SELECT 1 FROM recording_feedback WHERE identity=?')
      .get(recordingKey(platform, id))
  }
  dismiss(id) {
    if (typeof id !== 'string') throw Error('无效推荐记录')
    const byLocal = id.startsWith('local-')
    const matches = byLocal
      ? this.db
          .prepare(
            'SELECT i.*,r.local FROM items i JOIN recommended_items r ON r.item=i.id JOIN local_tracks t ON t.id=r.local WHERE r.local=?',
          )
          .all(id)
      : this.db
          .prepare(
            'SELECT i.*,r.local FROM items i LEFT JOIN recommended_items r ON r.item=i.id WHERE i.id=?',
          )
          .all(id)
    if (!matches.length) throw Error('该歌曲没有推荐记录')
    const blocked = this.db.prepare('INSERT OR IGNORE INTO recording_feedback VALUES(?)')
    this.db.exec('BEGIN')
    try {
      for (const row of matches) {
        this.db.prepare('INSERT OR IGNORE INTO dismissed_items VALUES(?)').run(row.id)
        if (
          ['待处理', '正在匹配', '正在保存', '正在校验', '待选录音', '待重试'].includes(row.status)
        )
          this.status(row.id, '已标记不感兴趣')
        const copies = row.local
          ? this.db
              .prepare(
                'SELECT platform,sourceId FROM recording_copies WHERE local=? AND platform IS NOT NULL AND sourceId IS NOT NULL',
              )
              .all(row.local)
          : []
        if (copies.length)
          for (const copy of copies) blocked.run(recordingKey(copy.platform, copy.sourceId))
        else if (legacyDigest(row.track))
          blocked.run(recordingKey('content', legacyDigest(row.track)))
        else if (catalogue.some((t) => t.id === row.track))
          blocked.run(recordingKey('offline', row.track))
        else blocked.run(songKey(row.title, row.artist))
      }
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
    return matches.map((r) => r.id)
  }
  snapshot() {
    const today = day()
    this.expireRecommendations(today)
    const feedback = this.feedbackIds()
    const dismissed = new Set(
      this.db
        .prepare('SELECT item FROM dismissed_items')
        .all()
        .map((r) => r.item),
    )
    const localIds = new Set(
      this.db
        .prepare('SELECT local,platform,sourceId,digest FROM recording_copies')
        .all()
        .filter(
          (r) =>
            feedback.has(recordingKey(r.platform, r.sourceId)) ||
            feedback.has(recordingKey('content', r.digest)),
        )
        .map((r) => r.local),
    )
    const batches = this.db
      .prepare(
        'SELECT b.*,r.targetCount,r.state,r.message FROM batches b LEFT JOIN recommendation_runs r ON b.id=r.batch WHERE b.day=? ORDER BY b.rowid DESC',
      )
      .all(today)
    const diagnostics =
      this.db.prepare(`SELECT i.title,i.artist,i.status,r.summary,r.error FROM items i
      JOIN recommended_items r ON r.item=i.id WHERE i.batch=? AND i.status NOT IN ('已入库','正在匹配','正在保存','正在校验','待处理') ORDER BY i.rowid DESC LIMIT 50`)
    const activeItems = this.db.prepare(
      "SELECT title,status FROM items WHERE batch=? AND status IN ('正在匹配','正在保存','正在校验') ORDER BY rowid",
    )
    for (const batch of batches) {
      if (batch.state === 'running') {
        const active = activeItems.all(batch.id)
        const descriptions = []
        for (const [status, label] of [
          ['正在保存', '正在下载'],
          ['正在校验', '正在校验录音'],
          ['正在匹配', '正在匹配录音'],
        ]) {
          const titles = active.filter((row) => row.status === status).map((row) => row.title)
          if (titles.length)
            descriptions.push(
              label + (status === '正在匹配' ? '' : '《' + titles.join('》《') + '》'),
            )
        }
        if (descriptions.length) {
          if (batch.message.includes('补推')) descriptions.push(batch.message)
          batch.message = descriptions.join(' · ')
        }
      }
      batch.details = batch.targetCount
        ? diagnostics
            .all(batch.id)
            .map((i) => [i.title + ' · ' + i.artist, i.error || i.summary || i.status].join('：'))
            .join('\n')
        : null
    }
    const items = this.db
      .prepare(
        `SELECT i.*, t.title AS recordingTitle, t.artist AS recordingArtist,t.album AS recordingAlbum, COALESCE(t.duration,o.duration) AS audioDuration, r.item AS daily, r.local AS localId, r.error AS downloadError,r.summary AS downloadSummary,r.diagnosis AS diagnosis,r.attemptSources,t.available AS localAvailable FROM items i JOIN batches b ON b.id=i.batch LEFT JOIN online_recordings o ON i.track=o.track LEFT JOIN recommended_items r ON r.item=i.id LEFT JOIN local_tracks t ON t.id=r.local LEFT JOIN recommendation_runs run ON run.batch=b.id WHERE b.day=? AND i.status != '已跳过' AND (run.batch IS NULL OR (i.status='已入库' AND t.available=1)) ORDER BY b.rowid DESC,i.rowid`,
      )
      .all(today)
      .map((row) => ({
        ...row,
        title: row.recordingTitle || row.title,
        artist: row.recordingArtist || row.artist,
        notInterested:
          dismissed.has(row.id) ||
          localIds.has(row.localId) ||
          feedback.has(recordingKey('content', legacyDigest(row.track))) ||
          feedback.has(songKey(row.title, row.artist)) ||
          feedback.has(recordingKey('offline', row.track)),
        status: row.daily && row.status === '已入库' && !row.localAvailable ? '待重试' : row.status,
        online: row.status === '模型推荐' || row.track?.startsWith('online-') || false,
        candidates: catalogue.filter(
          (t) =>
            t.title === row.title &&
            t.artist === row.artist &&
            !feedback.has(recordingKey('offline', t.id)),
        ),
      }))
    return {
      sidebarOrder: {
        folders: this.sidebarOrder('folders'),
        playlists: this.sidebarOrder('playlists'),
      },
      localTracks: this.library.list().map((t) => ({ ...t, notInterested: localIds.has(t.id) })),
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
  expireRecommendations(today = day(), replaceDaily = false) {
    if (!replaceDaily && this.lastExpiryDay === today) return
    const expired = replaceDaily ? 'b.id IN (SELECT batch FROM recommendation_runs)' : 'b.day < ?'
    const args = replaceDaily ? [] : [today]
    const stale = this.db
      .prepare(
        `SELECT i.id,t.id AS local,l.file AS savedFile
      FROM items i JOIN batches b ON b.id=i.batch
      LEFT JOIN recommended_items r ON r.item=i.id LEFT JOIN local_tracks t ON t.id=r.local
      LEFT JOIN library l ON l.track=i.track
      WHERE ${expired}`,
      )
      .all(...args)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const replacements = new Map()
      for (const { id, local, savedFile } of stale) {
        this.jobs.get(id)?.abort()
        if (this.active === id) this.release()
        let localId = local
        if (!localId && savedFile)
          localId = this.db
            .prepare('SELECT id FROM local_tracks WHERE file=? COLLATE NOCASE')
            .get(path.join(this.get('root'), savedFile))?.id
        replacements.set(id, localId)
        if (/^[a-f0-9-]{36}$/.test(id)) {
          for (const ext of ['.wav', '.m4a', '.mp3', '.flac']) this.removeCache(id, ext)
        }
        if (local) {
          // Keep the link used by the local recommendation playlist and explicit feedback.
          this.db
            .prepare("UPDATE items SET batch=NULL,reason='',digest=NULL,checked=0 WHERE id=?")
            .run(id)
        } else {
          this.db.prepare('DELETE FROM recommended_items WHERE item=?').run(id)
          this.db.prepare('DELETE FROM dismissed_items WHERE item=?').run(id)
          this.db.prepare('DELETE FROM items WHERE id=?').run(id)
        }
      }
      if (replacements.size) {
        const current = this.get('current')
        if (replacements.has(current))
          this.checkpoint(
            replacements.get(current) || '',
            replacements.get(current) ? Number(this.get('position')) : 0,
          )
        const queue = JSON.parse(this.get('play-queue') || '[]')
        this.set(
          'play-queue',
          JSON.stringify(
            queue.map((id) => (replacements.has(id) ? replacements.get(id) : id)).filter(Boolean),
          ),
        )
      }
      this.db
        .prepare(`DELETE FROM batches WHERE id IN (SELECT b.id FROM batches b WHERE ${expired})`)
        .run(...args)
      this.db.exec('DELETE FROM recommendation_runs WHERE batch NOT IN (SELECT id FROM batches)')
      if (stale.length)
        this.db.exec(`DELETE FROM online_recordings WHERE
        NOT EXISTS(SELECT 1 FROM items WHERE items.track=online_recordings.track) AND
        NOT EXISTS(SELECT 1 FROM library WHERE library.track=online_recordings.track) AND
        NOT EXISTS(SELECT 1 FROM saves WHERE saves.track=online_recordings.track)`)
      this.db.exec('COMMIT')
      this.lastExpiryDay = today
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  generate(preference, summary) {
    return this.saveSuggestions(preference, offlineSuggestions(preference, summary), '待匹配')
  }
  saveSuggestions(preference, rows, status, existingBatch, targetCount) {
    const feedback = this.feedbackIds()
    const accepted = rows.filter((row) => {
      if (feedback.has(songKey(row.title, row.artist))) return false
      if (status !== '待匹配') return true
      const candidates = catalogue.filter((t) => t.title === row.title && t.artist === row.artist)
      return (
        !candidates.length || candidates.some((t) => !feedback.has(recordingKey('offline', t.id)))
      )
    })
    const batch = existingBatch ?? randomUUID()
    this.db.exec('BEGIN')
    try {
      if (existingBatch) {
        if (!this.db.prepare('SELECT 1 FROM batches WHERE id=? AND day=?').get(batch, day()))
          throw Error('推荐已过期')
      } else this.db.prepare('INSERT INTO batches VALUES(?,?,?)').run(batch, day(), preference)
      if (targetCount)
        this.db
          .prepare("INSERT INTO recommendation_runs VALUES(?,?,'running','正在准备推荐')")
          .run(batch, targetCount)
      if (targetCount) this.set('latest-daily-run', batch)
      for (const row of accepted) {
        const id = randomUUID()
        this.db
          .prepare(
            'INSERT INTO items(id,batch,title,artist,reason,status,used) VALUES(?,?,?,?,?,?,?)',
          )
          .run(
            id,
            batch,
            row.title,
            row.artist,
            row.reason,
            row.collision ? '已在曲库' : status,
            Date.now(),
          )
        if (status === '待处理') {
          if (!row.collision)
            this.db
              .prepare('INSERT OR IGNORE INTO recommended_songs VALUES(?,?)')
              .run(row.title, row.artist)
          this.db
            .prepare('INSERT INTO recommended_items(item,error,diagnosis) VALUES(?,?,?)')
            .run(
              id,
              row.collision ? '本地曲库已有这首歌，本次未重复下载' : '',
              row.collision ? 'duplicate' : '',
            )
        }
      }
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
      const hits = catalogue.filter(
        (t) =>
          t.title === row.title &&
          t.artist === row.artist &&
          !this.ignoresRecording('offline', t.id),
      )
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
    // A renderer can still report progress for a recommendation that expired during playback.
    if (id && !id.startsWith('local-')) {
      const row = this.db
        .prepare(
          'SELECT i.batch,r.local FROM items i LEFT JOIN recommended_items r ON r.item=i.id WHERE i.id=?',
        )
        .get(id)
      if (!row || (!row.batch && !row.local)) return
      if (!row.batch) id = row.local
    }
    this.db
      .prepare("INSERT OR REPLACE INTO state VALUES ('current',?),('position',?)")
      .run(id, String(position))
  }
  cleanup(now) {
    this.expireRecommendations()
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
