import assert from 'node:assert/strict'
import { link, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron, expect } from '@playwright/test'
import { recording } from '../components/music/offline-source.mjs'
import { MusicStore } from '../components/music/store.mjs'

await mkdir('tmp', { recursive: true })
const root = await mkdtemp(path.resolve('tmp/album-actions-'))
const profile = path.join(root, 'profile')
const store = new MusicStore(path.join(profile, 'fitbay-music'))
store.set('music-guide-v1', '1')
store.set('music-muted', 'on')
store.set('music-media-keys', 'off')
const tone = path.join(root, 'tone.wav')
await writeFile(tone, recording('fitbay-tone-1'))
for (let i = 1; i <= 110; i++) {
  const album = 'Album ' + String(i).padStart(3, '0')
  for (const n of i === 110 ? [3, 2, 1] : i === 100 ? [2, 1] : [1]) {
    const title = album + '-' + n
    const file = path.join(root, title + '.wav')
    await link(tone, file)
    store.library.upsert({
      title,
      file,
      album,
      artist: 'Artist',
      albumArtist: 'Artist',
      duration: 20,
      discNumber: n === 3 ? 2 : 1,
      trackNumber: n === 3 ? 1 : n,
    })
  }
}
store.db.close()
async function launch() {
  return electron.launch({
    args: [
      path.resolve('dist/component-prototype/host'),
      '--mode=music',
      '--mute-audio',
      '--user-data-dir=' + profile,
      '--workbench=' + path.resolve('out/renderer/index.html'),
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
}
let app = await launch()
try {
  let page = await app.firstWindow()
  const button = (name) => page.getByRole('button', { name, exact: true })
  const state = () => page.evaluate(() => window.music.state())
  page.setDefaultTimeout(7000)
  await page.waitForSelector('.music-shell')
  await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].setContentSize(1040, 720))
  // Renderer screenshots omit the Windows compositor; capture the genuine dark fallback.
  await page.evaluate(() => {
    document.documentElement.style.backgroundColor = getComputedStyle(
      document.documentElement,
    ).getPropertyValue('--base')
  })
  await button('专辑').click()
  const tiles = page.locator('.album-tile')
  const scroll = page.locator('.music-scroll')
  await expect(tiles).toHaveCount(48)
  for (const size of [96, 110]) {
    await scroll.evaluate((s) => (s.scrollTop = s.scrollHeight - s.clientHeight - 100))
    await expect(tiles).toHaveCount(size)
  }
  await tiles.nth(91).scrollIntoViewIfNeeded()
  const offset = await scroll.evaluate((s) => s.scrollTop)
  await tiles.nth(91).click()
  await expect(page.getByRole('region', { name: '专辑曲目' })).toBeVisible()
  assert.equal(await scroll.evaluate((s) => s.scrollTop), 0)
  await button('返回专辑').click()
  await expect(tiles).toHaveCount(110)
  assert.ok(Math.abs((await scroll.evaluate((s) => s.scrollTop)) - offset) <= 1)
  const sort = page.getByRole('button', { name: '专辑排序' })
  await sort.scrollIntoViewIfNeeded()
  await sort.click()
  await page.getByRole('menuitemradio', { name: '曲数从多到少' }).click()
  await expect(tiles.first()).toContainText('Album 110')
  await expect(tiles.first()).toContainText('3 首')
  const filter = page.getByRole('checkbox', { name: '只看 2 首及以上' })
  await filter.check()
  await expect(tiles).toHaveCount(2)
  await sort.scrollIntoViewIfNeeded()
  await sort.click()
  await page.getByRole('menuitemradio', { name: '曲数从少到多' }).click()
  await expect(tiles.first()).toContainText('Album 100')
  await filter.uncheck()
  await expect(tiles.first()).toContainText('Album 001')
  await filter.check()
  await page.screenshot({ scale: 'css', path: path.join(root, 'album-sort.png') })
  const big = button('Album 110 · Artist')
  await big.click()
  await button('播放整张').click()
  const player = page.locator('audio')
  await expect.poll(() => player.evaluate((a) => !a.paused && a.currentTime > 0)).toBe(true)
  await button('返回专辑').click()
  await page.locator('.music-order').click()
  await player.evaluate((a) => (a.currentTime = 3))
  await big.click({ button: 'right' })
  await page.screenshot({ scale: 'css', path: path.join(root, 'album-menu.png') })
  await page.getByRole('menuitem', { name: '下一首播放整张' }).click()
  const s = await state()
  const byTitle = (title) => s.localTracks.find((t) => t.title === 'Album 110-' + title).id
  const [a, b, c] = [1, 2, 3].map(byTitle)
  await expect.poll(async () => (await state()).queue).toEqual([a, a, b, c])
  await expect.poll(() => player.evaluate((el) => !el.paused && el.currentTime >= 3)).toBe(true)
  await button('播放队列').click()
  await expect(page.locator('.music-queue li')).toHaveText([
    'Album 110-1 · Artist',
    'Album 110-2 · Artist',
    'Album 110-3 · Artist',
  ])
  await page.keyboard.press('Escape')
  await button('下一首').click()
  await expect.poll(async () => (await state()).queueOccurrence).toBe(1)
  assert.ok(await player.evaluate((el) => !el.paused && el.currentTime < 2))
  await button('下一首').click()
  await expect.poll(async () => (await state()).current).toBe(b)
  await button('上一首').click()
  await expect.poll(async () => (await state()).queueOccurrence).toBe(1)
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  page.setDefaultTimeout(7000)
  await page.waitForSelector('.music-shell')
  await expect.poll(async () => (await state()).queueOccurrence).toBe(1)
  await button('播放队列').click()
  await expect(page.locator('.music-queue li')).toHaveText([
    'Album 110-2 · Artist',
    'Album 110-3 · Artist',
  ])
  await page.keyboard.press('Escape')
  await button('下一首').click()
  await expect.poll(async () => (await state()).current).toBe(b)
  await button('下一首').click()
  await expect.poll(async () => (await state()).current).toBe(c)
  console.log(
    'PASS 110 张专辑自动追加两批、返回偏移、全量排序、过滤、随机模式插播整张、重复曲目上下首及重开。',
    root,
  )
} finally {
  await app.close()
}
