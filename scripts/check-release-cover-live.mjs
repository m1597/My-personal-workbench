import { _electron as electron, expect } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { MusicStore } from '../components/music/store.mjs'
const root = await mkdtemp(path.resolve('tmp/release-cover-live-')),
  profile = path.join(root, 'profile')
const db = new MusicStore(path.join(profile, 'fitbay-music'))
db.set('music-guide-v1', '1')
db.set('lx-bootstrap', 'done')
db.set(
  'followed-musicbrainz-artists',
  JSON.stringify([
    {
      id: 'b0e4bc50-3062-4d31-afad-def6a6b7a8e9',
      name: 'Alan Walker',
      detail: 'Norwegian producer',
    },
  ]),
)
db.db.close()
console.log(root)
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
  page.setDefaultTimeout(30000)
  console.log('Music window', page.url())
  const resize = (width, height) =>
    app.evaluate(
      ({ BaseWindow }, size) => BaseWindow.getAllWindows()[0].setContentSize(...size),
      [width, height],
    )
  await resize(1100, 720)
  await page.evaluate(() => delete document.documentElement.dataset.backdrop)
  await page.getByRole('tab', { name: '歌手', exact: true }).click()
  await page
    .getByRole('region', { name: '我关注的歌手' })
    .getByRole('button', { name: 'Alan Walker', exact: true })
    .click()
  const home = page.getByRole('region', { name: '歌手主页' }),
    release = home
      .locator('.catalog-release-link')
      .filter({ hasText: /^All Falls DownAlan Walker/i })
      .first()
  await expect(release).toBeAttached({ timeout: 120000 })
  await release.scrollIntoViewIfNeeded()
  const thumbnail = release.locator('img')
  await expect(thumbnail).toHaveAttribute('src', /^data:image/, { timeout: 30000 })
  const artwork = await thumbnail.getAttribute('src')
  const shot = (file) =>
    page.screenshot({
      scale: 'css',
      style: ':root{background:var(--base)!important}',
      path: path.join(root, file),
    })
  await shot('真实发行缩略图.png')
  await release.click()
  const detail = page.getByRole('region', { name: '专辑主页' }),
    header = detail.locator('.album-detail-header'),
    cover = header.locator('img'),
    rows = detail.locator('.release-recording')
  await expect(cover).toHaveAttribute('src', artwork, { timeout: 30000 })
  await expect(rows.first()).toBeVisible({ timeout: 60000 })
  const target = await page.evaluate(async () => {
    const releases = await window.music.artistReleases('b0e4bc50-3062-4d31-afad-def6a6b7a8e9')
    const group = releases.find(
      (row) => row.title === 'All Falls Down' && row.artist.startsWith('Alan Walker'),
    )
    if (!group) throw Error('Target release metadata not found')
    const editions = await window.music.newsEditions(group.id)
    return { group: group.id, editions: editions.map((row) => row.id) }
  })
  await detail.getByRole('button', { name: '返回', exact: true }).click()
  await app.evaluate(() => {
    const original = globalThis.fetch
    globalThis.blockedCoverRequests = []
    globalThis.fetch = (input, options) => {
      if (new URL(input).hostname === 'coverartarchive.org') {
        globalThis.blockedCoverRequests.push(String(input))
        throw Error('Cover network disabled after initial load')
      }
      return original(input, options)
    }
  })
  const evidence = []
  for (const [width, height] of [
    [1100, 720],
    [440, 580],
  ]) {
    await resize(width, height)
    await release.scrollIntoViewIfNeeded()
    const before = await release.evaluate((el) => el.closest('.music-scroll').scrollTop)
    await release.click()
    await expect(cover).toHaveAttribute('src', artwork)
    await detail.locator('h2').evaluate((el) => el.closest('.music-scroll').scrollTo(0, 0))
    await expect(header.getByText('Alan Walker', { exact: true })).toBeInViewport()
    await expect(rows.first()).toBeInViewport()
    const bounds = await cover.boundingBox()
    assert.ok(
      Math.abs(bounds.width - bounds.height) < 1 && bounds.width <= 116,
      JSON.stringify(bounds),
    )
    await shot(width + '-在线专辑.png')
    const first = await rows.first().textContent()
    await detail.getByRole('button', { name: '返回', exact: true }).click()
    await expect(release).toBeInViewport()
    await expect(thumbnail).toHaveAttribute('src', artwork)
    const after = await release.evaluate((el) => el.closest('.music-scroll').scrollTop)
    assert.ok(Math.abs(before - after) <= 1, JSON.stringify({ before, after }))
    evidence.push({ width, height, cover: bounds, first, before, after })
    await shot(width + '-返回歌手.png')
  }
  const blockedCoverRequests = await app.evaluate(() => globalThis.blockedCoverRequests)
  // Resizing and restoring the artist list can reveal other lazy-loaded covers.
  // Only this already-loaded release and its editions must remain cached.
  const targetIds = new Set([target.group, ...target.editions])
  const targetRetries = blockedCoverRequests.filter((url) =>
    targetIds.has(new URL(url).pathname.split('/')[2]),
  )
  await writeFile(
    path.join(root, '验证.json'),
    JSON.stringify({ target, targetRetries, blockedCoverRequests, evidence }, null, 2),
  )
  assert.deepEqual(targetRetries, [])
  console.log('PASS Alan Walker 真实发行缩略图、专辑页头与首曲，宽窄窗', root)
} finally {
  await app.close()
}
