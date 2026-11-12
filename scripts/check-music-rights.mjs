import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs/promises'
import { _electron as electron, expect } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
import { MusicStore } from '../components/music/store.mjs'
import { MusicTaste } from '../examples/component-host/music-taste.mjs'

await fs.mkdir('tmp', { recursive: true })
const root = await fs.mkdtemp(path.resolve('tmp/music-rights-')),
  profile = path.join(root, 'profile')
const musicRoot = path.join(profile, 'fitbay-music'),
  output = path.join(root, 'recommended'),
  manual = path.join(root, 'manual')
await Promise.all([fs.mkdir(output), fs.mkdir(manual)])
// Start from the previous release's schema before the first current-version open.
await fs.mkdir(musicRoot, { recursive: true })
const old = new DatabaseSync(path.join(musicRoot, 'music.sqlite'))
old.exec(`CREATE TABLE recording_versions(version TEXT PRIMARY KEY,local TEXT NOT NULL,automatic INTEGER NOT NULL,source TEXT,platform TEXT,sourceId TEXT,quality TEXT);
INSERT INTO recording_versions VALUES('legacy','local-legacy',1,'旧源','wy','旧版本','320k')`)
old.close()
const store = new MusicStore(musicRoot)
const migratedCopy = store.db.prepare("SELECT * FROM recording_copies WHERE version='legacy'").get()
assert.equal(migratedCopy.automatic, 1)
assert.equal(migratedCopy.source, '旧源')
assert.equal(migratedCopy.digest, null)
store.set('music-manual-dir', manual)
store.set('music-recommend-dir', output)
const code =
  "// @name 授权夹具\nlx.on('request',()=> 'https://1.1.1.1/audio');lx.send('inited',{sources:{wy:{actions:['musicUrl'],qualitys:['320k'],allowPermanentSave:true}}})"
const sourceFile = path.join(root, 'source.js')
await fs.writeFile(sourceFile, code)
const titles = [
  '禁止落盘',
  '允许保存',
  '拒绝下载',
  '试听片段',
  '逐曲试听权限',
  '明令禁止',
  '无匹配',
  '网络失败',
]
const batch = store.saveSuggestions(
  '测试',
  titles.map((title) => ({ title, artist: '艺人', reason: '测试' })),
  '待处理',
)
const rows = store.db.prepare('SELECT id,title FROM items WHERE batch=? ORDER BY rowid').all(batch)
store.db.close()
const db = new DatabaseSync(path.join(musicRoot, 'music.sqlite'))
const app = await electron.launch({
  args: [
    path.resolve('dist/component-prototype/host'),
    '--mode=music',
    '--mute-audio',
    '--user-data-dir=' + profile,
    '--workbench=' + path.resolve('out/renderer/index.html'),
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  const page = await app.firstWindow()
  await app.evaluate(
    ({ dialog }, { sourceFile, file }) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [sourceFile] })
      const dns = process.getBuiltinModule('node:dns/promises'),
        https = process.getBuiltinModule('node:https'),
        fs = process.getBuiltinModule('node:fs')
      const { Readable } = process.getBuiltinModule('node:stream'),
        { EventEmitter } = process.getBuiltinModule('node:events')
      const lookup = dns.lookup
      dns.lookup = (name, ...args) =>
        name === 'music.163.com'
          ? Promise.resolve([{ address: '1.1.1.1', family: 4 }])
          : lookup(name, ...args)
      process.getBuiltinModule('node:module').syncBuiltinESMExports()
      globalThis.downloadCalls = 0
      https.request = (url, _opts, done) => {
        let response
        if (url.hostname === 'music.163.com') {
          const title = url.searchParams.get('s').split(' ')[0]
          if (title === '网络失败') {
            const req = new EventEmitter()
            req.end = () => done(Object.assign(Readable.from([]), { statusCode: 503, headers: {} }))
            return req
          }
          const rights =
            {
              禁止落盘: { allowPermanentSave: false },
              拒绝下载: { downloadable: false },
              试听片段: { trial: true },
              逐曲试听权限: { freeTrialInfo: { start: 0, end: 10 } },
              明令禁止: { meta: { allowPermanentSave: false } },
            }[title] ?? {}
          response = Readable.from([
            Buffer.from(
              JSON.stringify({
                result: {
                  songs: [
                    {
                      id: title,
                      name: title === '无匹配' ? '完全不同的歌曲' : title,
                      artists: [{ name: '艺人' }],
                      album: { name: '专辑' },
                      ...rights,
                    },
                  ],
                },
              }),
            ),
          ])
        } else if (url.href === 'https://1.1.1.1/audio') {
          globalThis.downloadCalls++
          response = fs.createReadStream(file)
        } else throw Error('未预期的网络请求')
        const req = new EventEmitter()
        req.end = () =>
          done(Object.assign(response, { statusCode: 200, headers: {}, setTimeout() {} }))
        return req
      }
    },
    { sourceFile, file: path.resolve('tests/fixtures/local-music/tone.mp3') },
  )
  await page.evaluate(() => window.music.lxImport())
  const run = (id) => page.evaluate((id) => window.music.prepareRecommendation(id), id)
  const state = () => page.evaluate(() => window.music.state())
  for (const row of rows) await run(row.id)
  const initial = await state()
  const deniedWereSaved = initial.items
    .filter((r) => r.title !== '允许保存' && r.status === '已入库')
    .map((r) => r.title)
  for (const [title, diagnosis] of Object.entries({
    禁止落盘: 'denied',
    试听片段: 'preview',
    无匹配: 'missing',
    网络失败: 'network',
  }))
    assert.equal(initial.items.find((r) => r.title === title).diagnosis, diagnosis)
  const allowed = rows.find((r) => r.title === '允许保存')
  const automatic = initial.items.find((r) => r.id === allowed.id).localId
  assert.ok(automatic)
  const pathFor = (id) => db.prepare('SELECT file FROM local_tracks WHERE id=?').get(id).file
  await page.evaluate(async () => {
    const hits = await window.music.lxSearch({ title: '允许保存', artist: '艺人' })
    await window.music.lxDownload(hits.items[0].key, hits.quality[0])
  })
  const provenance = (await state()).localTracks.find(
    (t) => t.id === automatic,
  ).recommendationSource
  const local = new MusicStore(musicRoot)
  const taste = new MusicTaste(local, musicRoot, async () => '')
  // Ignore the legitimate manual import; only the original automatic copy is under test.
  const manualId = local.db
    .prepare('SELECT id FROM local_tracks WHERE file LIKE ?')
    .get(manual + '%').id
  local.db.prepare("UPDATE local_tracks SET title='手动副本' WHERE id=?").run(manualId)
  const counted = taste.delta({ incorporated: [] }).some((x) => x.data.title !== '手动副本')
  local.db.close()
  const before = await app.evaluate(() => globalThis.downloadCalls)
  const replacement = path.resolve('tests/fixtures/local-music/tone.flac')
  await fs.copyFile(replacement, pathFor(automatic))
  const relocated = path.join(root, 'relocated.flac')
  await fs.copyFile(replacement, relocated)
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, relocated)
  await page.evaluate((id) => window.music.relocateLocal(id), manualId)
  await expect.poll(() => pathFor(manualId)).toBe(relocated)
  await run(allowed.id)
  const verifiedAgain = (await app.evaluate(() => globalThis.downloadCalls)) - before
  const src = JSON.parse(db.prepare("SELECT value FROM state WHERE key='lx-source'").get().value)
  delete src.permanentSave
  delete src.permissionsVersion
  db.prepare("UPDATE state SET value=? WHERE key='lx-source'").run(JSON.stringify(src))
  await run(allowed.id)
  const migrated = JSON.parse(
    db.prepare("SELECT value FROM state WHERE key='lx-source'").get().value,
  )
  assert.deepEqual(deniedWereSaved, [])
  assert.ok(provenance)
  assert.equal(counted, false)
  assert.equal(verifiedAgain, 1)
  assert.equal(migrated.permanentSave, true)
  assert.deepEqual(await fs.readFile(pathFor(automatic)), await fs.readFile(replacement))
  db.prepare('UPDATE recording_copies SET digest=NULL').run()
  const beforeLegacy = await app.evaluate(() => globalThis.downloadCalls)
  await run(allowed.id)
  assert.equal(await app.evaluate(() => globalThis.downloadCalls), beforeLegacy + 1)
  const reset = db.prepare("UPDATE state SET value=? WHERE key='lx-source'")
  const withoutPermission = { ...src, code: src.code.replace(',allowPermanentSave:true', '') }
  reset.run(JSON.stringify(withoutPermission))
  await run(allowed.id)
  const readSource = () =>
    JSON.parse(db.prepare("SELECT value FROM state WHERE key='lx-source'").get().value)
  assert.equal(readSource().permissionsVersion, 1)
  assert.equal(readSource().permanentSave, undefined)
  assert.equal(await app.evaluate(() => globalThis.downloadCalls), beforeLegacy + 1)
  db.exec(
    "CREATE TRIGGER no_reparse BEFORE INSERT ON state WHEN NEW.key='lx-source' BEGIN SELECT RAISE(ABORT,'duplicate parse'); END",
  )
  await run(allowed.id)
  assert.match(
    (await state()).items.find((r) => r.id === allowed.id).downloadError,
    /未声明永久保存许可/,
  )
  db.exec('DROP TRIGGER no_reparse')
  reset.run(JSON.stringify({ ...src, code: 'invalid lx source!' }))
  await run(allowed.id)
  assert.equal(readSource().permissionsVersion, undefined)
  assert.equal((await state()).items.find((r) => r.id === allowed.id).status, '待重试')
  assert.equal(await app.evaluate(() => globalThis.downloadCalls), beforeLegacy + 1)
  console.log('PASS 内置目录逐曲许可、同版不同本地副本、文件换曲与旧源迁移 ' + root)
} finally {
  db.close()
  await app.close()
}
