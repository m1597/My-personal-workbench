import path from 'node:path'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { openDiscovery } from './discovery-fixture.mjs'
import { recording } from '../components/music/offline-source.mjs'
await mkdir('tmp', { recursive: true })
const root = await mkdtemp(path.resolve('tmp/public-cards-')),
  profile = path.join(root, 'profile')
const store = new MusicStore(path.join(profile, 'fitbay-music'))
store.set('music-guide-v1', 1)
store.set('lx-bootstrap', 'done')
for (const id of [101, 102, 103]) {
  const file = path.join(root, id + '.wav')
  await writeFile(file, recording('fitbay-tone-1'))
  store.library.upsert({
    file,
    title: '录音' + id,
    artist: '艺人',
    album: '专辑',
    duration: 20,
  })
  store.db
    .prepare(
      'INSERT INTO recording_copies(version,local,automatic,platform,sourceId) VALUES(?,?,0,?,?)',
    )
    .run(
      'public-' + id,
      store.db.prepare('SELECT id FROM local_tracks WHERE file=?').get(file).id,
      'wy',
      String(id),
    )
}
store.set(
  'lx-source',
  JSON.stringify({
    name: '测试目录',
    code: 'fixture',
    quality: ['128k'],
    platform: 'wy',
    platforms: { wy: { platform: 'wy', quality: ['128k'], search: false } },
    permissionsVersion: 1,
    catalogVersion: 2,
  }),
)
store.db.close()
const english = process.env.FITBAY_TEST_LANGUAGE === 'en'
const label = (zh, en) => (english ? en : zh)
await writeFile(path.join(profile, 'interface-language'), english ? 'en' : 'zh-CN')
const app = await electron.launch({
  args: [
    path.resolve(process.env.FITBAY_TEST_HOST || 'dist/component-prototype/host'),
    '--mode=music',
    '--mute-audio',
    '--user-data-dir=' + profile,
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  const page = await app.firstWindow()
  await app.evaluate(async ({ app }) => {
    if (!app.commandLine.hasSwitch('mute-audio')) throw Error('未静音')
    const https = process.getBuiltinModule('https')
    const { Readable } = process.getBuiltinModule('stream')
    const { EventEmitter } = process.getBuiltinModule('events')
    const orig = https.request
    globalThis.fixtureCycle = 0
    https.request = function (url, opts, cb) {
      if (url.hostname !== 'music.163.com') return orig.call(this, url, opts, cb)
      const req = new EventEmitter()
      req.end = () =>
        setTimeout(() => {
          let data,
            code = 200
          if (url.pathname.endsWith('/catalogue')) data = { sub: [] }
          else if (url.pathname.endsWith('/list'))
            data = {
              playlists: [
                '短片',
                '夜色与街道的音乐：在高架桥上看完整场雨',
                '钢琴',
                '夜间散步',
                '山间慢跑',
                '工作时听',
              ].map((name, i) => ({
                id: i + 1,
                name,
                creator: { nickname: i % 2 ? '策展人和他的朋友们' : 'A' },
                playCount: 8,
              })),
            }
          else if (url.pathname.endsWith('/detail')) {
            if (globalThis.fixtureCycle === 1) code = 503
            const ids = globalThis.fixtureCycle >= 2 ? [101, 102, 103] : [101, 102]
            data = {
              playlist: {
                tracks: ids.map((id) => ({
                  id,
                  name: '录音' + id,
                  ar: [{ name: '艺人' }],
                  al: { name: '专辑' },
                  dt: 10000,
                })),
                trackIds: ids.map((id) => ({ id })),
              },
            }
          } else throw Error(url.pathname)
          const stream = Readable.from([Buffer.from(JSON.stringify(data))])
          stream.statusCode = code
          cb(stream)
        }, 400)
      return req
    }
  })
  await openDiscovery(page, false)
  await page.getByRole('tab', { name: '公开歌单', exact: true }).click()
  const panel = page.getByRole('region', { name: '公开歌单' }),
    cards = panel.locator('.public-cards article'),
    first = cards.first()
  await expect(cards).toHaveCount(6)
  const results = []
  for (const width of [1120, 460]) {
    await app.evaluate(({ BaseWindow }, width) => {
      const w = BaseWindow.getAllWindows().find((w) => w.getTitle() === 'Music')
      w.setMinimumSize(320, 400)
      w.setContentSize(width, 840)
    }, width)
    await expect
      .poll(async () => Math.abs((await page.evaluate(() => innerWidth)) - width))
      .toBeLessThan(20)
    const pos = await cards.evaluateAll((els) =>
      els.map((el) => ({
        top: el.offsetTop,
        bottom: el.offsetTop + el.offsetHeight,
        button: el.querySelector('.public-import button').getBoundingClientRect().y,
      })),
    )
    const row = pos.filter((p) => p.top === pos[0].top)
    assert.ok(
      row.every((p) => Math.abs(p.button - row[0].button) < 1 && p.bottom === row[0].bottom),
    )
    results.push(row.length)
    await panel.locator('.public-cards').screenshot({
      path: path.join(root, 'cards-' + width + '.png'),
      style: ':root{background:var(--base)!important}',
    })
  }
  assert.ok(results[0] > results[1])
  const action = () =>
    first
      .getByRole('button', { name: label('导入到我的歌单', 'Import to my playlists'), exact: true })
      .click()
  const status = first.getByRole('status')
  await action()
  await expect(status).toContainText(label('正在导入', 'Importing'))
  await expect(status).toHaveText(
    label('已导入 · 新增 2 首，跳过 0 首', 'Imported · 2 added, 0 skipped'),
  )
  await app.evaluate(() => {
    globalThis.fixtureCycle = 1
  })
  await action()
  await expect(first.getByRole('alert')).toContainText(
    label('503', 'The service returned HTTP 503'),
  )
  await app.evaluate(() => {
    globalThis.fixtureCycle = 2
  })
  await first.getByRole('button', { name: label('重试导入', 'Retry import') }).click()
  await expect(status).toHaveText(
    label('已导入 · 新增 1 首，跳过 2 首', 'Imported · 1 added, 2 skipped'),
  )
  await expect(first.getByRole('alert')).toHaveCount(0)
  await action()
  await expect(status).toHaveText(
    label('已导入 · 全部重复，3 首均已在歌单中', 'No new tracks · All 3 already in the playlist'),
  )
  await expect(cards.nth(1).getByRole('status')).toBeEmpty()
  await first.locator('.public-list-card').click()
  await expect(
    panel.getByRole('status').filter({ hasText: label('全部重复', 'No new tracks') }),
  ).toBeVisible()
  await panel
    .getByRole('button', { name: label('导入到我的歌单', 'Import to my playlists'), exact: true })
    .click()
  await expect(
    panel.getByRole('status').filter({ hasText: label('全部重复', 'No new tracks') }),
  ).toBeVisible()
  const saved = await page.evaluate(async () => {
    const s = await window.music.state()
    const p = s.playlists.filter((p) => p.name === '短片')
    return p.map((p) => p.tracks.map((id) => s.onlineTracks.find((t) => t.id === id).title))
  })
  assert.deepEqual(saved, [['录音101', '录音102', '录音103']])
  const importLayout = await panel.locator('.public-actions .public-import').evaluate((el) => {
    const button = el.querySelector('button').getBoundingClientRect()
    const status = el.querySelector('small').getBoundingClientRect()
    return { buttonBottom: button.bottom, statusTop: status.top }
  })
  assert.ok(importLayout.statusTop >= importLayout.buttonBottom, JSON.stringify(importLayout))
  const audio = page.locator('audio')
  await panel.getByRole('button', { name: '播放全部', exact: true }).click()
  await expect.poll(() => audio.evaluate((a) => !a.paused && a.currentTime > 0.2)).toBe(true)
  const row = panel.locator('.public-recording').first()
  await expect(row.getByRole('button', { name: '暂停录音101', exact: true })).toBeVisible()
  await row.getByRole('button', { name: '暂停录音101', exact: true }).click()
  await expect.poll(() => audio.evaluate((a) => a.paused)).toBe(true)
  // Online playback releases its audio URL while paused; the saved position is authoritative.
  await expect
    .poll(() => page.evaluate(async () => (await window.music.state()).position))
    .toBeGreaterThan(0.2)
  const pausedTime = await page.evaluate(async () => (await window.music.state()).position)
  await row.getByRole('button', { name: '播放录音101', exact: true }).click()
  await expect.poll(() => audio.evaluate((a) => a.currentTime)).toBeGreaterThan(pausedTime + 0.1)
  await panel
    .getByRole('button', { name: label('返回热门歌单', 'Back to popular playlists'), exact: true })
    .click()
  await first.locator('.public-list-card').click()
  await expect(row.getByRole('button', { name: '暂停录音101', exact: true })).toBeVisible()
  await expect(row.getByRole('button', { name: '查看文件所在位置', exact: true })).toBeVisible()
  const metadata = await page.evaluate(() => window.music.publicListSongs('wy', '1'))
  assert.ok(metadata.every((song) => song.onlineId && song.localId))
  const importedIds = await page.evaluate(async () => {
    const state = await window.music.state()
    return state.playlists.find((list) => list.name === '短片').tracks
  })
  assert.deepEqual(
    metadata.map((song) => song.onlineId),
    importedIds,
  )
  await page.screenshot({
    path: path.join(root, 'public-row-playing.png'),
    style: ':root{background:var(--base)!important}',
  })
  await writeFile(
    path.join(root, 'results.json'),
    JSON.stringify({ columns: results, saved, importLayout, pausedTime, metadata }, null, 2),
  )
  console.log('PASS 宽窄卡片、逐卡反馈、增量导入、整单播放及返回后的暂停续播与本地定位', root)
} finally {
  await app.close()
}
