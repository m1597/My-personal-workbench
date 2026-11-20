import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, mkdtemp, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { recording } from '../components/music/offline-source.mjs'
import { offlineSourceRepository } from './music-source-fixture.mjs'

await mkdir('tmp', { recursive: true })
const root = await mkdtemp(path.resolve('tmp/playlist-download-all-'))
const dir = path.join(root, 'downloads')
const profile = path.join(root, 'profile')
const tone = path.join(root, 'fixture.wav')
const script = path.join(root, 'source.js')
await mkdir(dir)
await writeFile(tone, recording('fitbay-tone-1'))
await writeFile(
  script,
  `// @name 队列验收
lx.on('request',({action,info})=>action==='search' ? ['已有','成功','失败'].map(name=>({id:name,name,singer:'艺人',allowPermanentSave:true})) : action==='lyric' ? {lyric:'[00:01.00]队列歌词'} : 'https://1.1.1.1/test.wav?id='+encodeURIComponent(info.musicInfo.id));
lx.send('inited',{sources:{wy:{actions:['search','musicUrl','lyric'],qualitys:['320k'],allowPermanentSave:true}}})`,
)
const store = new MusicStore(path.join(profile, 'fitbay-music'))
store.set('music-guide-v1', 1)
store.set('music-manual-dir', dir)
store.set('player-option-lrcSave', 'on')
store.library.upsert({ file: tone, title: '本地', artist: '艺人', album: '', duration: 20 })
const local = store.library.list()[0].id
const list = store.library.createPlaylist('队列验收')
store.db.close()
let expectedLinks
const app = await electron.launch({
  args: [
    path.resolve('dist/component-prototype/host'),
    '--mode=music',
    '--mute-audio',
    '--workbench=' + path.resolve('out/renderer/index.html'),
    '--user-data-dir=' + profile,
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  await offlineSourceRepository(app)
  await app.evaluate(
    ({ dialog }, { script, tone }) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [script] })
      const https = process.getBuiltinModule('node:https')
      const fs = process.getBuiltinModule('node:fs')
      const { EventEmitter } = process.getBuiltinModule('node:events')
      const original = https.request
      globalThis.received = []
      globalThis.fail = true
      https.request = (url, options, done) => {
        if (url.pathname !== '/test.wav') return original(url, options, done)
        const req = new EventEmitter()
        req.end = () => {
          const id = url.searchParams.get('id')
          globalThis.received.push(id)
          const send = () =>
            done(
              Object.assign(fs.createReadStream(id === '另源' ? tone + '.other.wav' : tone), {
                statusCode: globalThis.offline || (id === '失败' && globalThis.fail) ? 503 : 200,
                headers: { 'content-type': 'audio/wav' },
                setTimeout() {},
              }),
            )
          if (id === '成功' && globalThis.hold) globalThis.resume = send
          else send()
        }
        return req
      }
    },
    { script, tone },
  )
  const page = await app.firstWindow()
  const button = (name) => page.getByRole('button', { name, exact: true })
  const ids = await page.evaluate(
    async ({ list, local }) => {
      await window.music.lxImport()
      const found = await window.music.lxSearch({ title: '队列', artist: '' }, 'wy')
      const ids = []
      for (const row of found.items) ids.push(await window.music.rememberOnline(row.key))
      await window.music.setMembership(list, [local, ...ids], true)
      const [existing] = await window.music.downloadSelection([ids[0]])
      if (existing.status !== 'saved') throw Error(JSON.stringify(existing))
      return ids
    },
    { list, local },
  )
  await page.reload()
  await page.getByRole('tab', { name: '歌单', exact: true }).click()
  await button('歌单导航').click()
  await button('队列验收').click()
  const download = button('下载全部')
  await expect(download).toBeVisible()
  assert.equal(await download.evaluate((el) => el.previousElementSibling?.textContent), '播放全部')
  await download.hover()
  await expect(page.getByRole('tooltip')).toHaveText('下载全部')
  await app.evaluate(() => {
    globalThis.hold = true
    globalThis.received = []
  })
  await download.click()
  await expect(page.getByRole('status').filter({ hasText: '入队 2 首 · 跳过 2 首' })).toBeVisible()
  await download.click()
  await expect(page.getByRole('status').filter({ hasText: '入队 0 首 · 跳过 4 首' })).toBeVisible()
  await expect.poll(() => app.evaluate(() => !!globalThis.resume)).toBe(true)
  await app.evaluate(() => {
    globalThis.hold = false
    globalThis.resume()
  })
  await expect(button('仅重试失败项')).toBeVisible()
  assert.deepEqual(await app.evaluate(() => globalThis.received), ['成功', '失败'])
  await page.screenshot({
    path: path.join(root, 'partial-failure.png'),
    style: ':root { background: var(--base) !important }',
  })
  await app.evaluate(() => {
    globalThis.fail = false
    globalThis.received = []
  })
  await button('仅重试失败项').click()
  await expect(
    page.getByRole('status').filter({ hasText: '已下载 1 首 · 已跳过 0 首 · 失败 0 首' }),
  ).toBeVisible()
  assert.deepEqual(await app.evaluate(() => globalThis.received), ['失败'])
  const state = await page.evaluate(() => window.music.state())
  assert.deepEqual(state.playlists.find((p) => p.id === list).tracks, [local, ...ids])
  const saved = state.onlineTracks.find((row) => row.id === ids[1]).localCopy
  assert.ok(saved)
  await page.evaluate((id) => window.music.setFavorite(id, true), saved)
  await unlink(path.join(dir, '艺人 - 成功.wav'))
  await page.reload()
  await page.getByRole('tab', { name: '歌单', exact: true }).click()
  await expect(page.getByRole('heading', { name: '歌单 / 我的收藏' })).toBeVisible()
  await download.click()
  await expect(
    page.getByRole('status').filter({ hasText: '已下载 1 首 · 已跳过 0 首 · 失败 0 首' }),
  ).toBeVisible()
  const after = await page.evaluate(() => window.music.state())
  assert.ok(after.localTracks.find((row) => row.id === saved)?.favorite)
  assert.deepEqual(after.playlists.find((p) => p.id === list).tracks, [local, ...ids])
  assert.equal(after.onlineTracks.find((row) => row.id === ids[1]).localCopy, saved)
  assert.ok((await readdir(dir)).includes('艺人 - 成功.lrc'))
  await app.evaluate(() => {
    globalThis.offline = true
    globalThis.received = []
  })
  await button('歌单导航').click()
  await button('队列验收').click()
  await button('播放成功').click()
  await expect
    .poll(() => page.locator('audio').evaluate((el) => !el.paused && el.currentTime > 0))
    .toBe(true)
  assert.deepEqual(await app.evaluate(() => globalThis.received), [])
  await page.screenshot({
    path: path.join(root, 'offline.png'),
    style: ':root { background: var(--base) !important }',
  })
  const imported = path.join(root, '导入样本.m3u8')
  await writeFile(imported, '#EXTM3U\n' + tone + '\n')
  await page.locator('input[type=file][accept*="m3u"]').setInputFiles(imported)
  await page.getByRole('dialog').getByRole('button', { name: '创建歌单' }).click()
  await expect(page.getByRole('heading', { name: '歌单 / 导入样本' })).toBeVisible()
  await download.click()
  await expect(page.getByRole('status').filter({ hasText: '入队 0 首 · 跳过 1 首' })).toBeVisible()
  const otherScript = path.join(root, 'other.js')
  await writeFile(tone + '.other.wav', recording('fitbay-tone-2'))
  await writeFile(
    otherScript,
    `// @name 另一个私有目录
lx.on('request',({action})=>action==='search' ? [{id:'成功',name:'第二首',singer:'艺人',allowPermanentSave:true}] : action==='lyric' ? null : 'https://1.1.1.1/test.wav?id='+encodeURIComponent('另源'));
lx.send('inited',{sources:{wy:{actions:['search','musicUrl'],qualitys:['320k'],allowPermanentSave:true}}})`,
  )
  await app.evaluate(({ dialog }, file) => {
    globalThis.offline = false
    globalThis.received = []
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, otherScript)
  const otherId = await page.evaluate(async () => {
    await window.music.lxImport()
    const found = await window.music.lxSearch({ title: '第二首', artist: '' }, 'wy')
    if (found.items[0].localId) throw Error('不同目录误认成本地')
    return window.music.rememberOnline(found.items[0].key)
  })
  assert.notEqual(otherId, ids[1])
  const copies = () =>
    page.evaluate(async () =>
      Object.fromEntries(
        (await window.music.state()).onlineTracks.map((row) => [row.id, row.localCopy]),
      ),
    )
  assert.equal((await copies())[otherId], null)
  await unlink(path.join(dir, '艺人 - 成功.wav'))
  const both = [ids[1], otherId]
  const receipt = await page.evaluate(
    (ids) => window.music.queuePlaylistDownload(ids, 'scope-check'),
    both,
  )
  assert.equal(receipt.queued, 2)
  await expect.poll(async () => (await copies())[otherId], { timeout: 20000 }).toBeTruthy()
  const scopeCopies = await copies()
  assert.equal(scopeCopies[ids[1]], saved)
  assert.notEqual(scopeCopies[otherId], saved)
  const sourceBFile = path.join(dir, '艺人 - 第二首.wav')
  assert.deepEqual(await readFile(sourceBFile), recording('fitbay-tone-2'))
  assert.deepEqual(await readFile(path.join(dir, '艺人 - 成功.wav')), recording('fitbay-tone-1'))
  await expect
    .poll(
      () =>
        page.evaluate(
          async (taskId) =>
            (await window.music.downloadTasks()).find((t) => t.id === taskId)?.status,
          receipt.taskId,
        ),
      { timeout: 20000 },
    )
    .toBe('已完成')
  await unlink(sourceBFile)
  const retry = await page.evaluate(
    (ids) => window.music.queuePlaylistDownload(ids, 'scope-check'),
    both,
  )
  assert.equal(retry.queued, 1)
  assert.equal(retry.skipped, 1)
  await expect
    .poll(async () => (await copies())[otherId], { timeout: 20000 })
    .toBe(scopeCopies[otherId])
  assert.deepEqual(await readFile(sourceBFile), recording('fitbay-tone-2'))
  assert.deepEqual(await app.evaluate(() => globalThis.received), ['成功', '另源', '另源'])
  expectedLinks = both.map((id) => [id, scopeCopies[id]])
  console.log(
    'PASS 下载全部、重复点击、仅重试失败项、收藏缺失歌曲恢复、顺序引用、歌词及断网本地播放',
    root,
  )
} finally {
  await app.close()
}
// Reopen an earlier profile whose online rows and local copies used the previous schema.
const earlier = new MusicStore(path.join(profile, 'fitbay-music'))
earlier.db.exec(
  "UPDATE online_recording_sources SET identifiers=json_remove(identifiers,'$.catalogScope'); UPDATE recording_copies SET artScope=NULL",
)
earlier.db.close()
const migrated = new MusicStore(path.join(profile, 'fitbay-music'))
for (const [online, local] of expectedLinks)
  assert.equal((await migrated.library.onlineCopy(online)).id, local)
migrated.db.close()
console.log('PASS 来源范围、两份不同音频、单独恢复原本地引用、旧 profile 升级', root)
