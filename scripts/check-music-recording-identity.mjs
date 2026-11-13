import { offlineSourceRepository } from './music-source-fixture.mjs'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron, expect } from '@playwright/test'
import { parseFile } from 'music-metadata'
import { MusicStore } from '../components/music/store.mjs'
import { writeFixtureRecording } from './music-recording-fixture.mjs'

await fs.mkdir('tmp', { recursive: true })
const root = await fs.mkdtemp(path.resolve('tmp/recording-identity-'))
const profile = path.join(root, 'profile')
const output = path.join(root, 'downloads')
await fs.mkdir(output)
const [original, encoded] = process.argv.slice(2)
assert.equal(Boolean(original), Boolean(encoded), '真实验收提供原录音与独立转码文件')
const owned = path.join(root, '我的收藏' + (original ? path.extname(original) : '.wav'))
if (original) await fs.copyFile(original, owned)
else await writeFixtureRecording(owned, 81, 24)
const bytes = await fs.readFile(owned)
const hash = (data) => createHash('sha256').update(data).digest('hex')
const before = hash(bytes)
const duration = (await parseFile(owned, { duration: true })).format.duration
const titles = [
  '别名甲',
  '标签乙',
  '转码丙',
  '另一录音',
  '第一首新歌',
  '第二首新歌',
  '第三首新歌',
  '第四首新歌',
]
const files = [owned, path.join(root, 'changed-tags' + path.extname(owned)), encoded]
const tagged = Buffer.alloc(128)
tagged.write('TAGanother title')
await fs.writeFile(files[1], Buffer.concat([bytes, tagged]))
if (!encoded) {
  files[2] = path.join(root, 'converted.wav')
  // Encode PCM as stereo at a different gain, preserving the underlying recording.
  const stereo = Buffer.alloc(44 + 2 * (bytes.length - 44))
  bytes.copy(stereo, 0, 0, 44)
  stereo.writeUInt32LE(stereo.length - 8, 4)
  stereo.writeUInt16LE(2, 22)
  stereo.writeUInt32LE(32000, 28)
  stereo.writeUInt16LE(4, 32)
  stereo.writeUInt32LE(stereo.length - 44, 40)
  for (let i = 44; i < bytes.length; i += 2) {
    const v = Math.round(bytes.readInt16LE(i) * 0.65)
    stereo.writeInt16LE(v, 44 + 2 * (i - 44))
    stereo.writeInt16LE(v, 46 + 2 * (i - 44))
  }
  await fs.writeFile(files[2], stereo)
}
for (const n of [3, 4, 5, 6, 7]) {
  files[n] = path.join(root, 'new-' + n + '.wav')
  await writeFixtureRecording(files[n], n, n === 3 ? duration : 4 + n)
}
assert.notEqual(hash(await fs.readFile(files[1])), before)
assert.notEqual(hash(await fs.readFile(files[2])), before)
const store = new MusicStore(path.join(profile, 'fitbay-music'))
store.library.upsert({
  file: owned,
  title: '我给它改的名字',
  artist: '我自己的分类',
  album: '收藏',
  size: bytes.length,
  duration,
})
await store.library.refresh()
const originalRow = store.db.prepare('SELECT * FROM local_tracks').get()
const list = store.library.createPlaylist('保留原歌单')
store.library.setMembership(list, originalRow.id, true)
const originalMembership = store.db
  .prepare('SELECT * FROM playlist_tracks WHERE playlist=?')
  .all(list)
store.set('music-recommend-dir', output)
const source = path.join(root, 'fixture.js')
await fs.writeFile(
  source,
  `// @name 录音身份测试源
lx.on('request',({action,info})=>{
 if(action==='musicUrl') return 'https://1.1.1.1/audio/'+info.musicInfo.id;
 const [name,singer]=info.keyword.split(' ')
 return [{name,singer,id:String(${JSON.stringify(titles)}.indexOf(name))}]
});
lx.send('inited',{sources:{wy:{actions:['search','musicUrl'],qualitys:['320k'],allowPermanentSave:true}}})`,
)
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
  await offlineSourceRepository(app)
  const page = await app.firstWindow()
  await app.evaluate(
    ({ dialog }, { source, files, titles }) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] })
      const fs = process.getBuiltinModule('node:fs')
      const https = process.getBuiltinModule('node:https')
      const { EventEmitter } = process.getBuiltinModule('node:events')
      const http = https.request
      https.request = (url, opts, cb) => {
        if (url.hostname !== '1.1.1.1') return http(url, opts, cb)
        const req = new EventEmitter()
        req.end = () =>
          cb(
            Object.assign(fs.createReadStream(files[Number(url.pathname.split('/').pop())]), {
              statusCode: 200,
              headers: {},
              setTimeout() {},
            }),
          )
        return req
      }
      globalThis.identityRounds = 0
      globalThis.fetch = async () => {
        const songs = (
          globalThis.identityRounds++ === 0 ? titles.slice(0, 5) : titles.slice(5)
        ).map((title) => ({ title, artist: '目录艺人', reason: '录音测试' }))
        return Response.json({ choices: [{ message: { content: JSON.stringify({ songs }) } }] })
      }
    },
    { source, files, titles },
  )
  await page.evaluate(async () => {
    await window.music.lxImport()
    await window.music.configureModel('deepseek', 'fixture', 'fixture', false)
  })
  await page.reload()
  await page.getByRole('tab', { name: '每日推荐' }).click()
  await page.getByLabel('想让 AI 推荐什么？（选填）').fill('只听目录艺人本人的作品')
  await page.getByRole('button', { name: '生成推荐', exact: true }).click()
  await expect(page.getByRole('button', { name: '生成推荐', exact: true })).toBeEnabled({
    timeout: 180000,
  })
  const rows = store.db
    .prepare(
      'SELECT i.title,i.status,r.error,r.local FROM items i JOIN recommended_items r ON r.item=i.id ORDER BY i.rowid',
    )
    .all()
  console.log('逐曲判定', JSON.stringify(rows))
  assert.equal(await app.evaluate(() => globalThis.identityRounds), 2)
  assert.match(rows[0].error, /SHA-256/)
  assert.match(rows[1].error, /音频指纹/)
  assert.match(rows[2].error, /音频指纹/)
  assert.ok(rows.slice(0, 3).every((r) => !r.local && r.status === '已在曲库'))
  assert.ok(rows.slice(3).every((r) => r.local && r.status === '已入库'))
  const shown = await page.locator('.music-list ol li strong').allTextContents()
  assert.deepEqual(shown, titles.slice(3))
  await expect(page.getByText(/已下载 5\/5/)).toBeVisible()
  const saved = await fs.readdir(output)
  assert.equal(saved.length, 5)
  assert.ok(saved.every((file) => !file.endsWith('.part')))
  const after = hash(await fs.readFile(owned))
  assert.equal(after, before)
  assert.deepEqual(
    store.db.prepare('SELECT * FROM local_tracks WHERE id=?').get(originalRow.id),
    originalRow,
  )
  assert.deepEqual(
    store.db.prepare('SELECT * FROM playlist_tracks WHERE playlist=?').all(list),
    originalMembership,
  )
  await page.screenshot({
    path: path.join(root, '补推结果.png'),
    style: ':root {background:var(--base) !important}',
  })
  const last = rows.at(-1)
  const savedPath = store.db
    .prepare('SELECT file FROM local_tracks WHERE id=?')
    .get(last.local).file
  const priorDigest = hash(await fs.readFile(savedPath))
  await fs.unlink(savedPath)
  await page.evaluate(
    (id) => window.music.prepareRecommendation(id),
    store.db.prepare('SELECT id FROM items WHERE title=?').get(last.title).id,
  )
  assert.equal(hash(await fs.readFile(savedPath)), priorDigest)
  const restored = await fs.stat(savedPath, { bigint: true })
  assert.equal(
    store.db.prepare('SELECT identity FROM daily_downloads WHERE local=?').get(last.local).identity,
    [restored.dev, restored.ino, restored.birthtimeNs].join(':'),
  )
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM local_tracks').get().n, 6)
  // Replace audio while preserving duration. The middle edit lies between two
  // detailed sample windows; its detection depends on the continuous trace.
  const long = path.join(root, 'long-original.wav'),
    contrast = path.join(root, 'long-alternate.wav')
  await writeFixtureRecording(long, 90, 180)
  await writeFixtureRecording(contrast, 92, 180)
  const sourceBytes = await fs.readFile(long),
    other = await fs.readFile(contrast)
  const variants = []
  for (const [name, start, end] of [
    ['intro', 0, 12],
    ['middle', 72, 73],
    ['tail', 168, 180],
  ]) {
    const edited = Buffer.from(sourceBytes)
    other.copy(edited, 44 + start * 16000, 44 + start * 16000, 44 + end * 16000)
    const file = path.join(root, name + '.wav')
    await fs.writeFile(file, edited)
    variants.push(file)
  }
  const short = path.join(root, 'short.wav'),
    taggedShort = path.join(root, 'short-tagged.wav')
  await writeFixtureRecording(short, 44, 2)
  await fs.writeFile(taggedShort, Buffer.concat([await fs.readFile(short), tagged]))
  const controls = await app.evaluate(
    async (_electron, { host, long, variants, short, taggedShort }) => {
      const load = process.getBuiltinModule('node:module').createRequire(host + '/main.mjs')
      const { verifyAudio } = load('./lx-audio-check.mjs')
      const { sameWaveform } = load('./music-recording-identity.mjs')
      const sample = (file, duration) => verifyAudio(file, new AbortController().signal, duration)
      const reference = await sample(long, 180)
      const edits = []
      for (const file of variants) edits.push(sameWaveform(reference, await sample(file, 180)))
      const small = await sample(short, 2)
      return { edits, shortTag: sameWaveform(small, await sample(taggedShort, 2)) }
    },
    { host: path.resolve('dist/component-prototype/host'), long, variants, short, taggedShort },
  )
  assert.deepEqual(controls, { edits: [false, false, false], shortTag: true })
  await fs.writeFile(
    path.join(root, 'result.json'),
    JSON.stringify(
      {
        controls,
        before,
        after,
        original: original || 'synthetic',
        duration,
        owned,
        shown,
        rows,
        saved,
      },
      null,
      2,
    ),
  )
  console.log('PASS 同字节、改标签和转码去重，独立录音入库、补推、原文件和歌单保留', root)
} finally {
  await app.close()
  store.db.close()
}
