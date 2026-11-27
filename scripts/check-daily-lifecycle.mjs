import { openDiscovery } from './discovery-fixture.mjs'
import { openMusicSettings, selectMusicSettings } from './music-settings-fixture.mjs'
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
const manual = path.join(fresh, '手动目录')
await mkdir(manual)
await mkdir(path.join(fresh, '古典'))
await writeFile(path.join(fresh, '古典', '目录冲突.mp3'), '保留这个文件')
await writeFile(path.join(fresh, '古典', '歌词冲突.wav'), '另一首录音')
const original = path.resolve('tests/fixtures/local-music/tone.mp3')
const hash = createHash('sha256')
  .update(await readFile(original))
  .digest('hex')
const store = new MusicStore(music)
store.set('music-guide-v1', '1')
const batch = store.saveSuggestions('第一轮', [], '待处理', undefined, 16)
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
  '即时归类',
  '手选分类',
  '目录匹配',
  '目录冲突',
  '歌词冲突',
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
    album: ['目录匹配', '目录冲突', '歌词冲突'].includes(title) ? '古典' : '',
    language: ['已有分类', '即时归类'].includes(title) ? 'jpn' : undefined,
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
  if (['新建分类', '冲突', '无模型', '越界'].includes(title))
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
const favoriteSession = await launch()
try {
  const page = await favoriteSession.firstWindow()
  await page.waitForSelector('.music-shell')
  await favoriteSession.evaluate(({ BaseWindow }) =>
    BaseWindow.getAllWindows()
      .find((window) => window.getTitle() === 'Music')
      .setContentSize(1060, 700),
  )
  await openDiscovery(page, true)
  await page.getByRole('button', { name: '试听已有分类', exact: true }).click()
  const heart = page.getByRole('button', { name: '收藏当前歌曲' })
  await expect(heart).toHaveAttribute('aria-pressed', 'false')
  await heart.click()
  await expect(heart).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('tab', { name: '歌单', exact: true }).click()
  const navigation = page.getByRole('button', { name: '歌单导航' })
  if (await navigation.isVisible()) await navigation.click()
  await page.getByRole('button', { name: '我的收藏', exact: true }).click()
  const row = page
    .locator('.library-row')
    .filter({ has: page.getByText('已有分类', { exact: true }) })
  await expect(row).toBeVisible()
  await heart.click()
  await expect(row).toHaveCount(0)
  await heart.click()
  await expect(row).toBeVisible()
  await openMusicSettings(page)
  await selectMusicSettings(page, '下载')
  const enabled = page.getByRole('checkbox', { name: '收藏推荐歌曲后自动归类' })
  await expect(enabled).not.toBeChecked()
  await enabled.check()
  await favoriteSession.evaluate(
    ({ dialog }, { fresh, manual }) => {
      dialog.showOpenDialog = async (options) => ({
        canceled: false,
        filePaths: [options.title === '选择收藏歌曲分类根目录' ? fresh : manual],
      })
    },
    { fresh, manual },
  )
  await page.getByRole('button', { name: '选择分类根目录' }).click()
  await expect(page.getByText(fresh, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await openDiscovery(page, true)
  await page.getByRole('button', { name: '试听即时归类', exact: true }).click()
  await page.getByRole('button', { name: '收藏当前歌曲' }).click()
  const moved = path.join(fresh, '日语', '即时归类.mp3')
  await expect
    .poll(() =>
      stat(moved).then(
        () => true,
        () => false,
      ),
    )
    .toBe(true)
  await expect
    .poll(() =>
      stat(tracks['即时归类'].file).then(
        () => true,
        () => false,
      ),
    )
    .toBe(false)
  assert.equal(await readFile(lyricPath(moved), 'utf8'), '[00:00]我的歌词')
  for (const title of ['目录匹配', '目录冲突', '歌词冲突']) {
    await page.getByRole('button', { name: '试听' + title, exact: true }).click()
    await page.getByRole('button', { name: '收藏当前歌曲' }).click()
    await expect(page.getByRole('button', { name: '收藏当前歌曲' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  }
  assert.equal(
    await readFile(lyricPath(path.join(fresh, '古典', '目录匹配.mp3')), 'utf8'),
    '[00:00]我的歌词',
  )
  assert.equal(await readFile(path.join(fresh, '古典', '目录冲突.mp3'), 'utf8'), '保留这个文件')
  assert.ok((await stat(tracks['目录冲突'].file)).isFile())
  assert.equal(await readFile(lyricPath(tracks['歌词冲突'].file), 'utf8'), '[00:00]我的歌词')
  await assert.rejects(stat(path.join(fresh, '古典', '歌词冲突.lrc')), { code: 'ENOENT' })
  await page.getByRole('button', { name: '试听手选分类', exact: true }).click()
  await page.getByRole('button', { name: '收藏当前歌曲' }).click()
  await openMusicSettings(page)
  await selectMusicSettings(page, '下载')
  await expect(page.getByRole('button', { name: '为目录冲突选择文件夹' })).toBeVisible()
  await page.screenshot({
    path: path.join(root, '收藏归类设置.png'),
    style: ':root {background:var(--base)!important}',
  })
  await page.getByRole('button', { name: '为手选分类选择文件夹' }).click()
  await expect
    .poll(() =>
      stat(path.join(manual, '手选分类.mp3')).then(
        () => true,
        () => false,
      ),
    )
    .toBe(true)
  await enabled.uncheck()
} finally {
  await favoriteSession.close()
}
// The next phase starts with a queued non-favorite and verifies cleanup of that playback state.
const checkpoint = new MusicStore(music)
// An interrupted copy can be edited in place by its owner while Music is closed.
const interrupted = tracks['目录冲突']
const partial = path.join(manual, '未完成.mp3')
await writeFile(partial, 'incomplete')
const idOf = (s) => [s.dev, s.ino, s.birthtimeNs].join(':')
const versionOf = (s) => [idOf(s), s.size, s.mtimeNs].join(':')
checkpoint.db
  .prepare('INSERT INTO favorite_moves VALUES(?,?,?,?,?)')
  .run(
    interrupted.id,
    interrupted.file,
    partial,
    JSON.stringify([[partial, idOf(await stat(partial, { bigint: true })), true]]),
    JSON.stringify([[interrupted.file, versionOf(await stat(interrupted.file, { bigint: true }))]]),
  )
checkpoint.set('play-queue', JSON.stringify([tracks['普通歌单歌曲'].item, tracks['已有分类'].id]))
checkpoint.checkpoint(tracks['普通歌单歌曲'].item, 1)
checkpoint.db.close()
await writeFile(partial, '用户重新写入的文件')
const app = await launch()
try {
  const page = await app.firstWindow()
  await page.evaluate(() => window.music.state())
  assert.equal(await readFile(partial, 'utf8'), '用户重新写入的文件')
  assert.ok((await stat(interrupted.file)).isFile())
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
        if (payload.categories) globalThis.fixture.requests.push(payload)
        return new Response('', { status: 503 })
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
  const fixture = await app.evaluate(() => globalThis.fixture)
  assert.equal(fixture.roots, 0)
  assert.deepEqual(fixture.requests, [])
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
    assert.equal(db.db.prepare('SELECT count(*) AS n FROM recommended_songs').get().n, 17)
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
    for (const title of ['已有分类', '新建分类', '无模型', '越界']) {
      const { id, file } = tracks[title]
      assert.equal(db.library.row(id).file, file)
      assert.equal(db.library.row(id).favorite, 1)
      assert.equal(await ownedLyrics(db.db, file), lyricPath(file))
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
  await page.getByRole('tab', { name: '歌单', exact: true }).click()
  const navigation = page.getByRole('button', { name: '歌单导航' })
  if (await navigation.isVisible()) await navigation.click()
  await page.getByRole('button', { name: '普通歌单', exact: true }).click()
  const track = page
    .locator('.library-row')
    .filter({ has: page.getByText('即时归类', { exact: true }) })
  await track.getByRole('button', { name: '播放即时归类', exact: true }).click()
  await expect
    .poll(() => page.locator('audio').evaluate((a) => !a.paused && a.currentTime > 0.2))
    .toBe(true)
  const restored = await page.evaluate(
    async (id) => ({ state: await window.music.state(), lyrics: await window.music.lyrics(id) }),
    tracks['即时归类'].id,
  )
  assert.equal(restored.state.current, tracks['即时归类'].id)
  assert.ok(restored.state.queue.includes(tracks['即时归类'].id))
  assert.ok(JSON.stringify(restored.lyrics).includes('我的歌词'))
  assert.equal(restored.state.localTracks.find((t) => t.id === tracks['即时归类'].id).favorite, 1)
  await page.screenshot({
    path: path.join(root, '重启后原歌单播放.png'),
    style: ':root {background:var(--base)!important}',
  })
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
