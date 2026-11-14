import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { recording } from '../components/music/offline-source.mjs'
await mkdir('tmp', { recursive: true })
const root = await mkdtemp(path.resolve('tmp/artist-layout-')),
  profile = path.join(root, 'profile')
const store = new MusicStore(path.join(profile, 'fitbay-music'))
store.set('music-guide-v1', '1')
store.set('lx-bootstrap', 'done')
const artist = '一位拥有很长名字的歌手与他的乐队 ArtistWithAnUnusuallyLongUnbrokenNameForLayout'
for (let i = 0; i < 40; i++) {
  const file = path.join(root, 'song-' + i + '.wav')
  await writeFile(file, recording('fitbay-tone-1'))
  store.library.upsert({
    file,
    title: '音乐作品 ' + String(i).padStart(2, '0'),
    artist,
    album: '长专辑名与发行版本名称 LongAlbumWithoutSpacesForLayout',
    duration: 20,
  })
}
store.db.close()
const app = await electron.launch({
  args: [
    path.resolve(process.env.FITBAY_TEST_HOST_DIR || 'dist/component-prototype/host'),
    '--workbench=' + path.resolve('out/renderer/index.html'),
    '--mode=workbench',
    '--mute-audio',
    '--user-data-dir=' + profile,
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  const shell = await app.firstWindow()
  await shell.evaluate(() => window.musicDock.open())
  await expect
    .poll(() => app.windows().some((x) => x.url().includes('/music/index.html')))
    .toBe(true)
  const page = app.windows().find((x) => x.url().includes('/music/index.html'))
  await expect
    .poll(() => page.evaluate(async () => (await window.musicWindow.status()).mode))
    .toBe('docked')
  const size = async (width) =>
    app.evaluate(({ BrowserWindow }, width) => {
      const w = BrowserWindow.getAllWindows()[0]
      w.setMinimumSize(320, 400)
      w.setContentSize(width, 650)
    }, width)
  await size(1100)
  await app.evaluate(({ app }) => {
    if (!app.commandLine.hasSwitch('mute-audio')) throw Error('未静音')
    globalThis.fetch = async () => Response.json({ recordings: [], artists: [] })
  })
  const search = page.getByRole('searchbox', { name: '搜索本地歌曲' })
  await search.fill('音乐作品')
  const row = page.locator('li.library-row').nth(36)
  await row.locator('strong').click()
  const audio = page.locator('audio')
  await expect.poll(() => audio.evaluate((a) => !a.paused && a.currentTime > 0.15)).toBe(true)
  const link = row.getByRole('button', { name: artist, exact: true })
  await link.scrollIntoViewIfNeeded()
  const before = await page.locator('.music-scroll').evaluate((el) => el.scrollTop)
  assert.ok(before > 100)
  await link.click()
  const home = page.getByRole('region', { name: '歌手主页' }),
    back = home.getByRole('button', { name: '返回' })
  const metrics = () =>
    home.evaluate((el) => {
      const song = el.querySelector('.catalog-songs').getBoundingClientRect(),
        release = el.querySelector('.catalog-releases').getBoundingClientRect()
      return {
        cols: release.left > song.left + 30 ? 2 : 1,
        width: el.clientWidth,
        overflow: el.scrollWidth - el.clientWidth,
        viewport: innerWidth,
        scrollOverflow:
          el.closest('.music-scroll').scrollWidth - el.closest('.music-scroll').clientWidth,
      }
    })
  for (const target of [1100, 410, 1100]) {
    const start = await page.evaluate(() => innerWidth)
    await app.evaluate(
      async ({ BrowserWindow }, { target, start }) => {
        const w = BrowserWindow.getAllWindows()[0]
        for (let step = 1; step <= 16; step++) {
          w.setContentSize(Math.round(start + ((target - start) * step) / 16), 650)
          await new Promise((r) => setTimeout(r, 25))
        }
      },
      { start, target },
    )
    await expect.poll(async () => (await metrics()).cols).toBe(target === 410 ? 1 : 2)
    const m = await metrics()
    assert.ok(m.overflow <= 1 && m.scrollOverflow <= 1, JSON.stringify(m))
    await page.screenshot({
      path: path.join(root, 'artist-' + target + '.png'),
      style: ':root{background:var(--base)!important}',
    })
  }
  await back.click()
  await expect(search).toHaveValue('音乐作品')
  assert.equal(await page.locator('.music-scroll').evaluate((el) => el.scrollTop), before)
  await link.click()
  const position = await audio.evaluate((a) => a.currentTime)
  await page.getByRole('tab', { name: '曲库', exact: true }).click()
  await expect(home).toHaveCount(0)
  await expect(search).toHaveValue('')
  await expect.poll(() => audio.evaluate((a) => !a.paused && a.currentTime > 0)).toBe(true)
  assert.ok(await audio.evaluate((a, p) => a.currentTime >= p, position))
  const center = async (label) => {
    const b = await page.getByRole('button', { name: label, exact: true }).boundingBox()
    const offset = await app.evaluate(
      ({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]
          .contentView.children.find((v) => v.webContents?.getURL().includes('/music/index.html'))
          .getBounds().x,
    )
    return offset + b.x + b.width / 2
  }
  for (const width of [1100, 410]) {
    await size(width)
    const tabs = page.getByRole('tablist', { name: '音乐页面' })
    const items = tabs.getByRole('tab')
    const gaps = await items.evaluateAll((els) =>
      els
        .slice(1)
        .map((el, i) => el.getBoundingClientRect().left - els[i].getBoundingClientRect().right),
    )
    assert.ok(
      gaps.every((g) => g >= 0 && g <= 5),
      JSON.stringify(gaps),
    )
    const inactive = items.nth(1)
    await inactive.hover()
    assert.equal(await inactive.evaluate((el) => getComputedStyle(el, '::after').display), 'none')
    await page.screenshot({
      path: path.join(root, 'full-' + width + '.png'),
      style: ':root{background:var(--base)!important}',
    })
    const before = await center('只显示播放栏')
    await page.getByRole('button', { name: '只显示播放栏', exact: true }).click()
    await expect(page.getByRole('button', { name: '展开 Music' })).toBeVisible()
    const mini = await center('展开 Music')
    console.log('模式切换中心 X', width, before, mini)
    await page.screenshot({
      path: path.join(root, 'mini-' + width + '.png'),
      style: ':root{background:var(--base)!important}',
    })
    assert.ok(Math.abs(before - mini) <= 1, JSON.stringify({ width, before, mini }))
    await page.getByRole('button', { name: '展开 Music' }).click()
    await expect(page.getByRole('tab', { name: '曲库', exact: true })).toBeVisible()
    assert.ok(Math.abs(before - (await center('只显示播放栏'))) <= 1)
  }
  console.log('PASS 真实停靠窗口连续缩窄/拉宽、搜索滚动返回、重复点曲库与播放连续', root)
} finally {
  await app.close()
}
