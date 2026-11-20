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
for (let i = 1; i <= 261; i++) {
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
async function musicWindow(app) {
  const locate = () => app.windows().find((page) => page.url().includes('/music/index.html'))
  await expect.poll(() => Boolean(locate())).toBe(true)
  return locate()
}
let app = await launch()
try {
  let page = await musicWindow(app)
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
  await expect(tiles).toHaveCount(261)
  await expect(page.getByText('261 张专辑', { exact: true })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: '只看 2 首及以上' })).toHaveCount(0)
  const initialHeight = await scroll.evaluate((s) => s.scrollHeight)
  await scroll.evaluate((s) => (s.scrollTop = s.scrollHeight))
  await expect(tiles.last()).toBeInViewport()
  await expect(tiles.last()).toContainText('Album 261')
  assert.equal(await scroll.evaluate((s) => s.scrollHeight), initialHeight)
  await page.screenshot({ path: path.join(root, '261-albums-bottom.png') })
  const offset = await scroll.evaluate((s) => s.scrollTop)
  await tiles.last().click()
  await expect(page.getByRole('region', { name: '专辑曲目' })).toBeVisible()
  assert.equal(await scroll.evaluate((s) => s.scrollTop), 0)
  await button('返回专辑').click()
  await expect(tiles).toHaveCount(261)
  assert.ok(Math.abs((await scroll.evaluate((s) => s.scrollTop)) - offset) <= 1)
  const sort = page.getByRole('button', { name: '专辑排序' })
  await sort.scrollIntoViewIfNeeded()
  await sort.click()
  await page.getByRole('menuitemradio', { name: '曲数从多到少' }).click()
  await expect(tiles.first()).toContainText('Album 110')
  await expect(tiles.first()).toContainText('3 首')
  await sort.click()
  await page.getByRole('menuitemradio', { name: '曲数从少到多' }).click()
  await expect(tiles.first()).toContainText('Album 001')
  await expect(tiles.last()).toContainText('Album 110')
  const search = page.getByRole('searchbox', { name: '搜索本地专辑' })
  await search.fill('Album 261')
  await expect(tiles).toHaveCount(1)
  await expect(tiles.first()).toContainText('Album 261')
  await search.fill('Album 110')
  await page.screenshot({
    scale: 'css',
    path: path.join(root, 'album-sort.png'),
  })
  const big = button('Album 110 · Artist')
  await big.click()
  await button('播放整张').click()
  const player = page.locator('audio')
  await expect.poll(() => player.evaluate((a) => !a.paused && a.currentTime > 0)).toBe(true)
  await button('返回专辑').click()
  await page.locator('.music-order').click()
  await player.evaluate((a) => (a.currentTime = 3))
  await big.click({ button: 'right' })
  const insertAlbum = page.getByRole('menuitem', { name: '下一首播放整张' })
  await expect(insertAlbum).toBeVisible()
  await page.screenshot({
    scale: 'css',
    animations: 'disabled',
    path: path.join(root, 'album-menu.png'),
  })
  await insertAlbum.click()
  const s = await state()
  const byTitle = (title) => s.localTracks.find((t) => t.title === 'Album 110-' + title).id
  const [a, b, c] = [1, 2, 3].map(byTitle)
  await expect.poll(async () => (await state()).queue).toEqual([a, a, b, c])
  await expect.poll(() => player.evaluate((el) => !el.paused && el.currentTime >= 3)).toBe(true)
  await button('播放队列').click()
  await expect(page.locator('.music-queue ol li strong')).toHaveText([
    'Album 110-1',
    'Album 110-2',
    'Album 110-3',
  ])
  await page.locator('.music-queue ol li .row-play').first().click()
  await expect.poll(async () => (await state()).queueOccurrence).toBe(1)
  assert.ok(await player.evaluate((el) => !el.paused && el.currentTime < 2))
  await page.locator('.queue-current .row-play').click()
  await expect.poll(() => player.evaluate((el) => el.paused)).toBe(true)
  await page.locator('.queue-current .row-play').click()
  await expect.poll(() => player.evaluate((el) => !el.paused)).toBe(true)
  await page.keyboard.press('Escape')
  await button('下一首').click()
  await expect.poll(async () => (await state()).current).toBe(b)
  await button('上一首').click()
  await expect.poll(async () => (await state()).queueOccurrence).toBe(1)
  await app.close()
  app = await launch()
  page = await musicWindow(app)
  page.setDefaultTimeout(7000)
  await page.waitForSelector('.music-shell')
  await expect.poll(async () => (await state()).queueOccurrence).toBe(1)
  await button('播放队列').click()
  await expect(page.locator('.music-queue ol li strong')).toHaveText(['Album 110-2', 'Album 110-3'])
  await page.keyboard.press('Escape')
  await button('下一首').click()
  await expect.poll(async () => (await state()).current).toBe(b)
  await button('下一首').click()
  await expect.poll(async () => (await state()).current).toBe(c)
  const mode = page.locator('.music-order')
  await mode.click()
  await mode.click()
  await expect(mode).toHaveText('单曲循环')
  await button('专辑').click()
  await page.getByRole('searchbox', { name: '搜索本地专辑' }).fill('Album 100')
  const insert = async () => {
    await button('Album 100 · Artist').click({ button: 'right' })
    await page.getByRole('menuitem', { name: '下一首播放整张' }).click()
  }
  await insert()
  const other = s.localTracks.filter((row) => row.album === 'Album 100').map((row) => row.id)
  const finish = async () => {
    const audio = page.locator('audio')
    await expect.poll(() => audio.evaluate((el) => !el.paused && el.currentTime > 0)).toBe(true)
    await audio.evaluate(
      (el) =>
        new Promise((resolve) => {
          el.addEventListener('ended', resolve, { once: true })
          el.currentTime = el.duration - 0.15
        }),
    )
  }
  await expect.poll(async () => (await state()).pendingAlbum).toEqual(other)
  await finish()
  await expect.poll(async () => (await state()).current).toBe(other[0])
  await expect.poll(async () => (await state()).pendingAlbum).toEqual([other[1]])
  await app.close()
  app = await launch()
  page = await musicWindow(app)
  await expect(page.locator('.music-order')).toHaveText('单曲循环')
  await page
    .locator('.music-transport')
    .getByRole('button', { name: /从 .* 秒继续|^播放$/ })
    .click()
  await finish()
  await expect.poll(async () => (await state()).current).toBe(other[1])
  await expect.poll(async () => (await state()).pendingAlbum).toEqual([])
  await finish()
  await expect
    .poll(() => page.locator('audio').evaluate((el) => !el.paused && el.currentTime < 2))
    .toBe(true)
  assert.equal((await state()).current, other[1])
  await button('专辑').click()
  await page.getByRole('searchbox', { name: '搜索本地专辑' }).fill('Album 100')
  await insert()
  await expect.poll(async () => (await state()).pendingAlbum).toEqual(other)
  await button('Album 100 · Artist').click()
  await button('播放整张').click()
  await expect.poll(async () => (await state()).pendingAlbum).toEqual([])
  console.log(
    'PASS 261 张专辑首次全量、一步到底、返回偏移、全量排序和搜索、随机模式插播整张、重复曲目上下首、单曲循环自然接续与重开。',
    root,
  )
} finally {
  await app.close()
}
