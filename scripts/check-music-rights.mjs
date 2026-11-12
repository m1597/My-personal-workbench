import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs/promises'
import { _electron as electron, expect } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
import { MusicStore } from '../components/music/store.mjs'
import { lyricPath } from '../examples/component-host/music-lyrics.mjs'
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
  "// @name 授权夹具\nlx.on('request',({action,info})=> action==='lyric' ? {lyric:'[00:00.00]录音 '+info.musicInfo.id} : 'https://1.1.1.1/audio');lx.send('inited',{sources:{wy:{actions:['musicUrl'],qualitys:['320k'],allowPermanentSave:true}}})"
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
const suggestion = { title: '允许保存', artist: '艺人', reason: '旧版摘要身份' }
const oldBatch = store.saveSuggestions('旧在线推荐', [suggestion], '模型推荐')
const oldItem = store.db.prepare('SELECT id FROM items WHERE batch=?').get(oldBatch).id
const oldAudio = path.join(root, 'old-audio.part')
await fs.copyFile(path.resolve('tests/fixtures/local-music/tone.mp3'), oldAudio)
store.cacheOnline(oldItem, oldAudio, { ...suggestion, album: '旧版', duration: 4 }, '.mp3')
await fs.writeFile(lyricPath(store.file(oldItem)), '[00:00]旧队列缓存歌词')
store.checkpoint(rows.find((row) => row.title === '允许保存').id, 0)
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
          response = fs.createReadStream(globalThis.testAudioFile ?? file)
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
  const openWindow = app.waitForEvent('window')
  await page.getByRole('button', { name: '桌面歌词', exact: true }).click()
  const overlay = await openWindow
  await expect(overlay.locator('strong')).toHaveText('暂无同步歌词')
  for (const row of rows) await run(row.id)
  await expect(overlay.locator('strong')).toHaveText('录音 允许保存')
  assert.deepEqual(await page.evaluate((id) => window.music.lyrics(id), oldItem), [
    [0, '旧队列缓存歌词'],
  ])
  await page.getByRole('button', { name: '桌面歌词', exact: true }).click()
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
  const lrc = lyricPath(pathFor(automatic))
  assert.equal(await fs.readFile(lrc, 'utf8'), '[00:00.00]录音 允许保存')
  await fs.unlink(lrc)
  const initialCalls = await app.evaluate(() => globalThis.downloadCalls)
  await run(allowed.id)
  assert.equal(await app.evaluate(() => globalThis.downloadCalls), initialCalls)
  assert.equal(await fs.readFile(lrc, 'utf8'), '[00:00.00]录音 允许保存')
  await fs.writeFile(lrc, '[00:01]个人校订')
  await run(allowed.id)
  assert.equal(await fs.readFile(lrc, 'utf8'), '[00:01]个人校订')
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
  const oldActive = (await page.evaluate(() => window.music.lxSources())).active
  db.prepare('UPDATE music_sources SET payload=? WHERE id=?').run(JSON.stringify(src), oldActive)
  const oldCapabilities = await page.evaluate(() => window.music.lxSources())
  assert.equal(
    oldCapabilities.installed.find((entry) => entry.id === oldActive).permanentSave,
    null,
  )
  await run(allowed.id)
  const migrated = JSON.parse(
    db.prepare("SELECT value FROM state WHERE key='lx-source'").get().value,
  )
  assert.deepEqual(deniedWereSaved, [])
  assert.ok(provenance)
  assert.equal(counted, false)
  assert.equal(verifiedAgain, 1)
  assert.equal(migrated.permanentSave, true)
  const newCapabilities = await page.evaluate(() => window.music.lxSources())
  assert.equal(
    newCapabilities.installed.find((entry) => entry.id === oldActive).permanentSave,
    true,
  )
  await page.evaluate((id) => window.music.lxSelectSource(id), oldActive)
  assert.equal(
    JSON.parse(db.prepare("SELECT value FROM state WHERE key='lx-source'").get().value)
      .permanentSave,
    true,
  )
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
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, sourceFile)
  const pagedSource = `// @name 分页夹具
    lx.on('request',({action,info})=>{
      if(action==='musicUrl') return 'https://1.1.1.1/audio'
      if(info.page!==1 || info.limit!==20 || info.offset!==0) throw Error('推荐扩大了搜索范围')
      const [name,singer]=info.keyword.split(' ')
      const row={id:name,name,singer}
      if(name==='禁止落盘')return [{...row,singer:'同名歌的另一艺人',allowPermanentSave:false}]
      if(name==='允许保存')return {items:[row],total:30,hasMore:true}
      if(name==='试听片段')return {list:[{...row,trial:true}],hasMore:true}
      if(name==='明令禁止')return {songs:[{...row,allowPermanentSave:false}],total:11}
      if(name==='无匹配')return {items:[...Array.from({length:20},(_,i)=>({...row,id:i,name:'其他曲目'})),row],total:21}
      return []
    })
    lx.send('inited',{sources:{wy:{actions:['musicUrl','search'],qualitys:['320k'],allowPermanentSave:true}}})`
  await fs.writeFile(sourceFile, pagedSource)
  await page.evaluate(() => window.music.lxImport())
  for (const name of ['禁止落盘', '允许保存', '试听片段', '明令禁止', '无匹配'])
    await run(rows.find((r) => r.title === name).id)
  const cases = (await state()).items.filter((r) => r.batch === batch)
  assert.deepEqual(
    Object.fromEntries(
      cases
        .filter((r) => ['禁止落盘', '允许保存', '试听片段', '明令禁止', '无匹配'].includes(r.title))
        .map((r) => [r.title, r.diagnosis || r.status]),
    ),
    {
      禁止落盘: 'missing',
      允许保存: '已入库',
      试听片段: 'preview',
      明令禁止: 'denied',
      无匹配: 'missing',
    },
  )
  const legacyIdentity = JSON.stringify(['song', '允许保存', '艺人'])
  db.prepare('INSERT OR IGNORE INTO recording_feedback VALUES(?)').run(legacyIdentity)
  db.prepare('INSERT OR IGNORE INTO dismissed_items VALUES(?)').run(oldItem)
  db.prepare("DELETE FROM state WHERE key='feedback-digests-v1'").run()
  const upgraded = new MusicStore(musicRoot)
  assert.equal(
    db.prepare('SELECT 1 FROM recording_feedback WHERE identity=?').get(legacyIdentity),
    undefined,
  )
  await page.evaluate((id) => window.music.dismissRecommendation(id), oldItem)
  const postUpgrade = upgraded.saveSuggestions('升级后的同名推荐', [suggestion], '待处理')
  const next = upgraded.db.prepare('SELECT id FROM items WHERE batch=?').get(postUpgrade)?.id
  assert.ok(next, '有录音摘要时不能提前排除歌名和艺人相同的其他版本')
  upgraded.db.close()
  const beforeCopy = await app.evaluate(() => globalThis.downloadCalls)
  await run(next)
  assert.equal(db.prepare('SELECT status FROM items WHERE id=?').get(next).status, '已跳过')
  assert.equal(
    await app.evaluate(() => globalThis.downloadCalls),
    beforeCopy,
    '已知摘要相同的本地副本直接跳过',
  )
  await fs.writeFile(
    sourceFile,
    pagedSource.replace('id:name,name,singer', 'id:name+"-发行版",name,singer'),
  )
  await page.evaluate(() => window.music.lxImport())
  await run(next)
  assert.equal(db.prepare('SELECT status FROM items WHERE id=?').get(next).status, '已跳过')
  assert.equal(
    await app.evaluate(() => globalThis.downloadCalls),
    beforeCopy + 1,
    '新来源 ID 的内容相同也须过滤',
  )
  assert.equal(
    (await state()).items.some((r) => r.id === next),
    false,
  )
  await app.evaluate((_e, file) => {
    globalThis.testAudioFile = file
  }, path.resolve('tests/fixtures/local-music/tone.flac'))
  await run(next)
  assert.equal((await state()).items.find((r) => r.id === next).status, '已入库')
  assert.equal((await state()).items.find((r) => r.id === next).notInterested, false)
  const noLyricFile = pathFor((await state()).items.find((r) => r.id === next).localId)
  assert.deepEqual(await fs.readFile(noLyricFile), await fs.readFile(replacement))
  await assert.rejects(fs.access(lyricPath(noLyricFile)), { code: 'ENOENT' })
  console.log('PASS 每日推荐下载匹配歌词、已验证副本补词且不重复下载、保留用户校订、缺词仍入库')
  console.log('PASS 内置目录逐曲许可、同版不同本地副本、文件换曲与旧源迁移 ' + root)
} finally {
  db.close()
  await app.close()
}
