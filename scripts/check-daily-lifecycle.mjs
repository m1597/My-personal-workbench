import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { lyricPath, ownedLyrics, saveLyrics } from '../examples/component-host/music-lyrics.mjs'

await mkdir('tmp', { recursive: true })
const root = await mkdtemp(path.resolve('tmp/daily-lifecycle-'))
const profile = path.join(root, 'profile'),
  music = path.join(profile, 'fitbay-music')
const daily = path.join(root, '推荐'),
  existing = path.join(root, '古典'),
  fresh = path.join(root, '新分类')
for (const dir of [daily, existing, fresh]) await mkdir(dir)
const original = path.resolve('tests/fixtures/local-music/tone.mp3')
const hash = createHash('sha256')
  .update(await readFile(original))
  .digest('hex')
const store = new MusicStore(music)
const batch = store.saveSuggestions('第一轮', [], '待处理', undefined, 9)
const list = store.library.createPlaylist('普通歌单')
store.set('music-recommend-dir', daily)
const tracks = {}
for (const title of [
  '普通歌单歌曲',
  '已有副本',
  '已改文件',
  '同内容替换',
  '旧版无身份',
  '已有分类',
  '新建分类',
  '冲突',
  '无模型',
  '越界',
  '用户歌词',
  '回收失败',
]) {
  const file = path.join(daily, title + '.mp3')
  await copyFile(original, file)
  store.saveSuggestions('第一轮', [{ title, artist: '艺人', reason: '测试' }], '待处理', batch)
  const item = store.db.prepare('SELECT id FROM items WHERE title=?').get(title).id
  store.library.upsert({
    file,
    title,
    artist: '艺人',
    album: '',
    language: title === '已有分类' ? 'jpn' : undefined,
    duration: 4,
  })
  const id = store.db.prepare('SELECT id FROM local_tracks WHERE file=?').get(file).id
  store.db.prepare("UPDATE items SET status='已入库' WHERE id=?").run(item)
  store.db.prepare('UPDATE recommended_items SET local=? WHERE item=?').run(id, item)
  if (title !== '已有副本') {
    const s = await stat(file, { bigint: true })
    store.db
      .prepare('INSERT INTO daily_downloads VALUES(?,?,?,?,?)')
      .run(
        id,
        batch,
        file,
        hash,
        title === '旧版无身份' ? null : [s.dev, s.ino, s.birthtimeNs].join(':'),
      )
  }
  if (['已有分类', '新建分类', '冲突', '无模型', '越界'].includes(title))
    store.db.prepare('UPDATE local_tracks SET favorite=1 WHERE id=?').run(id)
  store.library.setMembership(list, id, true)
  store.library.heard(id)
  if (title === '已改文件') await writeFile(file, '已替换')
  if (title === '同内容替换' || title === '旧版无身份') {
    await rename(file, file + '.old')
    await copyFile(original, file)
  }
  if (title === '用户歌词') await writeFile(lyricPath(file), '用户歌词')
  else await saveLyrics(store.db, file, async () => '[00:00]我的歌词')
  tracks[title] = { file, id, item }
}
await writeFile(path.join(existing, '分类样本.mp3'), await readFile(original))
store.library.upsert({
  file: path.join(existing, '分类样本.mp3'),
  title: '示例',
  artist: '示例',
  album: '',
  duration: 4,
})
await writeFile(path.join(existing, '冲突.mp3'), '冲突文件')
store.set('play-queue', JSON.stringify([tracks['普通歌单歌曲'].item, tracks['已有分类'].id]))
store.checkpoint(tracks['普通歌单歌曲'].item, 1)
store.db.close()
const launch = () =>
  electron.launch({
    args: [
      path.resolve('dist/component-prototype/host'),
      '--mode=music',
      '--mute-audio',
      '--user-data-dir=' + profile,
      '--workbench=' + path.resolve('out/renderer/index.html'),
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
const app = await launch()
try {
  const page = await app.firstWindow()
  await page.evaluate(() => window.music.state())
  await page.evaluate(() => window.music.configureModel('deepseek', 'test', 'test-fixture', false))
  await app.evaluate(
    ({ shell, dialog, net }, { root, fresh }) => {
      const fs = process.getBuiltinModule('node:fs/promises')
      const path = process.getBuiltinModule('node:path')
      globalThis.fixture = { requests: [], trashed: [], roots: 0 }
      const dns = process.getBuiltinModule('node:dns/promises')
      net.fetch = async () => {
        throw Error('测试仓库离线')
      }
      dns.lookup = async () => {
        throw Error('上游离线夹具')
      }
      process.getBuiltinModule('node:module').syncBuiltinESMExports()
      dialog.showOpenDialog = async (opts) => {
        if (opts.title !== '选择收藏歌曲分类根目录') throw Error('unexpected directory prompt')
        globalThis.fixture.roots++
        return { canceled: false, filePaths: [fresh] }
      }
      shell.trashItem = async (file) => {
        if (!file.startsWith(root + path.sep)) throw Error('fixture path escape')
        if (path.basename(file) === '回收失败.mp3') throw Error('模拟失败')
        if (!globalThis.fixture.trashed.length) await new Promise((r) => setTimeout(r, 180))
        await fs.unlink(file)
        globalThis.fixture.trashed.push(file)
      }
      globalThis.fetch = async (_url, { body }) => {
        const payload = JSON.parse(JSON.parse(body).messages[1].content)
        if (!payload.categories) return new Response('', { status: 503 })
        globalThis.fixture.requests.push(payload)
        if (payload.title === '无模型') return new Response('', { status: 503 })
        const category = payload.categories.find((c) => c.name === '古典').id
        const response =
          payload.title === '越界'
            ? { newCategory: '../escape' }
            : payload.title === '新建分类'
              ? { newCategory: '器乐' }
              : { category }
        return Response.json({ choices: [{ message: { content: JSON.stringify(response) } }] })
      }
    },
    { root, fresh },
  )
  const generate = page.evaluate(() => window.music.generate('离线测试', 'auto', false, 1))
  await expect
    .poll(() => page.evaluate(async () => (await window.music.state()).batches[0]?.preference))
    .toBe('离线测试')
  await assert.rejects(
    page.evaluate(() => window.music.generate('重复', 'auto', false, 1)),
    /请先结束/,
  )
  await generate
  await expect.poll(() => app.evaluate(() => globalThis.fixture.requests.length)).toBe(5)
  const fixture = await app.evaluate(() => globalThis.fixture)
  assert.equal(fixture.roots, 1)
  for (const request of fixture.requests) {
    const fields = ['album', 'artist', 'categories', 'title']
    if (request.title === '已有分类') {
      assert.equal(request.language, 'jpn')
      fields.push('language')
    }
    assert.deepEqual(Object.keys(request).sort(), fields.sort())
    for (const cat of request.categories) assert.deepEqual(Object.keys(cat).sort(), ['id', 'name'])
    assert.ok(!JSON.stringify(request).includes(root))
  }
  const s = await page.evaluate(() => window.music.state())
  assert.equal(s.batches.length, 1)
  assert.equal(s.batches[0].state, 'blocked')
  assert.match(s.batches[0].message, /未能完整回收/)
  assert.equal(s.current, '')
  assert.deepEqual(s.queue, [tracks['已有分类'].id])
  assert.equal(
    s.localTracks.some((t) => t.id === tracks['普通歌单歌曲'].id),
    false,
  )
  assert.equal(await readFile(lyricPath(tracks['用户歌词'].file), 'utf8'), '用户歌词')
  assert.deepEqual(
    fixture.trashed.sort(),
    [
      tracks['普通歌单歌曲'].file,
      lyricPath(tracks['普通歌单歌曲'].file),
      tracks['用户歌词'].file,
    ].sort(),
  )
  for (const title of ['已有副本', '冲突', '无模型', '越界', '回收失败', '已改文件'])
    assert.ok((await stat(tracks[title].file)).isFile())
  assert.equal(await readFile(path.join(existing, '冲突.mp3'), 'utf8'), '冲突文件')
  const db = new MusicStore(music)
  try {
    assert.equal(db.db.prepare('SELECT count(*) AS n FROM recommended_songs').get().n, 12)
    for (const title of ['同内容替换', '旧版无身份']) {
      assert.equal(db.library.row(tracks[title].id).file, tracks[title].file)
      assert.deepEqual(await readFile(tracks[title].file), await readFile(original))
    }
    assert.equal(
      db.db
        .prepare('SELECT count(*) AS n FROM local_play_history WHERE track=?')
        .get(tracks['普通歌单歌曲'].id).n,
      0,
    )
    for (const [title, target] of [
      ['已有分类', existing],
      ['新建分类', path.join(fresh, '器乐')],
    ]) {
      const { id, file } = tracks[title]
      const moved = path.join(target, path.basename(file))
      assert.equal(db.library.row(id).file, moved)
      assert.equal(db.library.row(id).favorite, 1)
      assert.ok(
        db.library
          .playlists()
          .find((p) => p.id === list)
          .tracks.includes(id),
      )
      assert.ok(db.db.prepare('SELECT 1 FROM local_play_history WHERE track=?').get(id))
      assert.equal(await ownedLyrics(db.db, moved), lyricPath(moved))
      await assert.rejects(stat(file), { code: 'ENOENT' })
      await assert.rejects(stat(lyricPath(file)), { code: 'ENOENT' })
    }
  } finally {
    db.db.close()
  }
  for (const title of ['已有分类', '新建分类', '冲突', '无模型', '越界']) {
    const ok = await page.evaluate(async (id) => {
      const url = await window.music.localSource(id)
      const audio = new Audio(url)
      audio.muted = true
      await audio.play()
      const ok = audio.duration > 0 && !audio.paused
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      return ok
    }, tracks[title].id)
    assert.equal(ok, true)
  }
  await page.evaluate(() => window.music.generate('第三轮', 'auto', false, 1))
  assert.deepEqual((await app.evaluate(() => globalThis.fixture.trashed)).sort(), fixture.trashed)
  console.log(
    'PASS 原生成入口即时清轮、同轮重入、失败、文件身份、普通歌单、复用副本、分类及回放。' + root,
  )
} finally {
  await app.close()
}
// Simulate power loss between the OS recycle result and SQLite acknowledgement.
const journal = new MusicStore(music)
for (const title of ['回收失败', '已有副本']) {
  const { id, file } = tracks[title]
  journal.db
    .prepare('INSERT INTO pending_trash(local,file,lyric) VALUES(?,?,?)')
    .run(id, file, lyricPath(file))
}
await unlink(tracks['回收失败'].file)
journal.db.close()
const restarted = await launch()
try {
  const page = await restarted.firstWindow()
  const state = await page.evaluate(() => window.music.state())
  assert.ok(!state.localTracks.some((r) => r.id === tracks['回收失败'].id))
  assert.ok(state.localTracks.some((r) => r.id === tracks['已有副本'].id))
  assert.ok(!state.playlists.find((p) => p.id === list).tracks.includes(tracks['回收失败'].id))
  await assert.rejects(stat(lyricPath(tracks['回收失败'].file)), { code: 'ENOENT' })
  assert.ok((await stat(lyricPath(tracks['已有副本'].file))).isFile())
  console.log('PASS 中断重开按回收日志与实际文件恢复；未回收副本保留。')
} finally {
  await restarted.close()
}
