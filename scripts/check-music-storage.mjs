import assert from 'node:assert/strict'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import path from 'node:path'
import os from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { MusicStore } from '../components/music/store.mjs'
import { validateSuggestions } from '../components/music/offline-source.mjs'
fs.mkdirSync('tmp', { recursive: true })
const root = fs.mkdtempSync(path.resolve('tmp/music-storage-'))
const target = fs.mkdtempSync(path.join(os.tmpdir(), 'fitbay-library-'))
let store = new MusicStore(root)
const restart = () => {
  store.db.close()
  store = new MusicStore(root)
}
const settle = async () => {
  while (store.jobs.size) await delay(5)
}
try {
  store.db.exec(`CREATE TABLE recording_versions(version TEXT PRIMARY KEY, local TEXT NOT NULL, automatic INTEGER NOT NULL);
    INSERT INTO recording_versions VALUES('old-version','old-copy',1)`)
  restart()
  assert.deepEqual(
    { ...store.db.prepare("SELECT * FROM recording_copies WHERE version='old-version'").get() },
    {
      version: 'old-version',
      local: 'old-copy',
      automatic: 1,
      source: null,
      platform: null,
      sourceId: null,
      quality: null,
      digest: null,
      artScope: null,
    },
  )
  restart()
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM recording_copies').get().n, 1)
  const batch = store.generate('电子')
  let rows = store.snapshot().items
  assert.equal(rows.length, 5)
  assert.ok(rows.every((r) => r.status === '待匹配'))
  store.match(batch)
  assert.equal(store.jobs.size, 2)
  const busy = [...store.jobs.keys()][0]
  store.cancel(busy)
  await settle()
  assert.equal(store.item(busy).status, '已取消')
  store.choose(busy, store.item(busy).track)
  await settle()
  rows = store.snapshot().items
  const ready = rows.filter((r) => r.status === '就绪')
  const [first, second] = ready
  assert.equal(rows.filter((r) => r.status === '待选版本').length, 1)
  store.set('root', target)
  const copy = fs.copyFileSync
  try {
    fs.copyFileSync = (_src, dest) => {
      fs.writeFileSync(dest, 'partial')
      throw Object.assign(Error('test'), { code: 'ENOSPC' })
    }
    syncBuiltinESMExports()
    assert.throws(() => store.keep(first.id), { code: 'ENOSPC' })
  } finally {
    fs.copyFileSync = copy
    syncBuiltinESMExports()
  }
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM library').get().n, 0)
  restart()
  store.keep(first.id)
  store.keep(first.id)
  assert.equal(fs.readdirSync(target).length, 1)
  const finish = store.finish
  store.finish = () => {
    throw Error('模拟复制后中断')
  }
  assert.throws(() => store.keep(second.id), /模拟复制后中断/)
  store.finish = finish
  restart()
  assert.ok(store.local(second.track))
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM saves').get().n, 0)
  store.bytes(first.id)
  store.db.exec('UPDATE items SET used=0,checked=1')
  store.cleanup(false)
  assert.ok(fs.existsSync(store.file(first.id)))
  assert.equal(store.item(ready[2].id).checked, 0)
  store.active = null
  store.cleanup(true)
  assert.ok(!fs.existsSync(store.file(first.id)))
  assert.ok(store.bytes(first.id).length > 44)
  fs.unlinkSync(store.local(first.track))
  store.active = null
  assert.throws(() => store.bytes(first.id), /缺失/)
  store.choose(first.id, first.track)
  await settle()
  store.keep(first.id)
  const next = store.generate('氛围', store.summary())
  store.match(next)
  await settle()
  assert.equal(
    store.snapshot().items.find((r) => r.batch === next && r.track === first.track).status,
    '已入库',
  )
  store.db.prepare("UPDATE items SET status='下载中' WHERE id=?").run(first.id)
  fs.writeFileSync(store.file(first.id, '.part'), 'partial')
  restart()
  assert.equal(store.item(first.id).status, '中断')
  assert.ok(!fs.existsSync(store.file(first.id, '.part')))
  assert.throws(() =>
    validateSuggestions(
      Array(5).fill({ title: 'a', artist: 'b', reason: 'c', url: 'https://example.invalid' }),
    ),
  )
  const oldDaily = store.saveSuggestions(
    '跨日验收',
    [
      { title: '保留录音', artist: '测试艺人', reason: '首次推荐' },
      { title: '错过录音', artist: '测试艺人', reason: '首次推荐' },
    ],
    '待处理',
  )
  const [saved, missed] = store.db
    .prepare('SELECT id FROM items WHERE batch=? ORDER BY rowid')
    .all(oldDaily)
  const permanentFile = path.join(target, 'retained.mp3')
  fs.copyFileSync('tests/fixtures/local-music/tone.mp3', permanentFile)
  store.library.upsert({
    file: permanentFile,
    title: '保留录音',
    artist: '测试艺人',
    album: '',
    duration: 1,
  })
  const localId = store.db.prepare('SELECT id FROM local_tracks WHERE file=?').get(permanentFile).id
  store.db.prepare('UPDATE recommended_items SET local=? WHERE item=?').run(localId, saved.id)
  store.db.prepare("UPDATE batches SET day='2000-01-01' WHERE id=?").run(oldDaily)
  store.set('play-queue', JSON.stringify([missed.id, saved.id]))
  store.checkpoint(saved.id, 0.5)
  fs.writeFileSync(store.file(missed.id, '.mp3'), 'temporary')
  const feedback = store.feedbackIds()
  // Simulate upgrading a database that predates cross-day song identities.
  store.db.exec('DROP TABLE recommended_songs')
  restart()
  const later = store.snapshot()
  assert.ok(!later.batches.some((b) => b.id === oldDaily))
  assert.ok(!later.items.some((r) => [missed.id, saved.id].includes(r.id)))
  assert.throws(() => store.item(missed.id))
  assert.ok(
    store.db
      .prepare('SELECT 1 FROM recommended_songs WHERE title=? AND artist=?')
      .get('错过录音', '测试艺人'),
  )
  assert.deepEqual(later.queue, [localId])
  assert.equal(later.current, localId)
  assert.equal(later.position, 0.5)
  store.checkpoint(missed.id, 1)
  assert.equal(store.get('current'), localId)
  assert.equal(Number(store.get('position')), 0.5)
  store.checkpoint(saved.id, 0.8)
  assert.equal(store.get('current'), localId)
  assert.equal(Number(store.get('position')), 0.8)
  assert.ok(later.localTracks.some((t) => t.id === localId))
  assert.deepEqual(
    later.playlists.flatMap((p) => (p.system ? p.tracks : [])),
    [],
  )
  assert.ok(fs.existsSync(permanentFile) && !fs.existsSync(store.file(missed.id, '.mp3')))
  assert.deepEqual(store.feedbackIds(), feedback)
  console.log('PASS 跨日过期清理、旧成员退出系统歌单、永久文件及队列保留、未下载条目无负反馈')
  console.log(
    'PASS 并发、取消、失效选择、同版本本地命中、缺失重取、目标卷 ENOSPC 注入、重复入库、复制后中断恢复。缓存卷 ' +
      path.parse(root).root +
      '，库卷 ' +
      path.parse(target).root,
  )
} finally {
  store.db.close()
  if (
    path.dirname(target) === path.resolve(os.tmpdir()) &&
    path.basename(target).startsWith('fitbay-library-')
  )
    fs.rmSync(target, { recursive: true })
}
