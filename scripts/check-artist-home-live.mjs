import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs/promises'
import { backup, DatabaseSync } from 'node:sqlite'
import { _electron as electron, expect } from '@playwright/test'
import { isolateRecommendationProfile } from './isolate-recommendation-profile.mjs'

const root = await fs.mkdtemp(path.resolve('tmp/artist-home-live-'))
console.log(root)
const evidence = {},
  profile = path.join(root, 'profile'),
  directory = path.join(profile, 'fitbay-music')
let app
try {
  await fs.mkdir(directory, { recursive: true })
  const source = new DatabaseSync(path.resolve('local/desktop-profile/fitbay-music/music.sqlite'), {
    readOnly: true,
  })
  try {
    await backup(source, path.join(directory, 'music.sqlite'))
  } finally {
    source.close()
  }
  const db = new DatabaseSync(path.join(directory, 'music.sqlite'))
  try {
    const row = db
      .prepare(
        "SELECT * FROM local_tracks WHERE title='One Last Kiss' AND artist='宇多田光' LIMIT 1",
      )
      .get()
    assert.ok(row)
    const dest = path.join(root, 'One Last Kiss' + path.extname(row.file))
    await fs.copyFile(row.file, dest)
    isolateRecommendationProfile(db, directory)
    db.prepare(
      'UPDATE local_tracks SET file=?,path_key=?,available=1,awaitingLocation=0 WHERE id=?',
    ).run(dest, dest.toLowerCase(), row.id)
    db.prepare("UPDATE state SET value='done' WHERE key='lx-bootstrap'").run()
    const set = db.prepare('INSERT OR REPLACE INTO state(key,value) VALUES(?,?)')
    for (const [key, value] of [
      ['music-guide-v1', '1'],
      ['music-media-keys', 'off'],
      ['music-global-keys', 'off'],
      ['music-muted', 'on'],
    ])
      set.run(key, value)
  } finally {
    db.close()
  }
  app = await electron.launch({
    args: [
      path.resolve(process.env.FITBAY_TEST_HOST || 'dist/component-prototype/host'),
      '--mode=music',
      '--mute-audio',
      '--user-data-dir=' + profile,
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
  const page = await app.firstWindow()
  assert.ok(
    await app.evaluate(({ app, BaseWindow, screen }) => {
      const left = Math.min(...screen.getAllDisplays().map((s) => s.bounds.x))
      return (
        app.commandLine.hasSwitch('mute-audio') &&
        BaseWindow.getAllWindows().every(
          (w) => !w.isFocusable() && w.getBounds().x + w.getBounds().width <= left,
        )
      )
    }),
  )
  await page.waitForSelector('.music-shell')
  const list = '相似歌手试听'
  const listId = await page.evaluate((name) => window.music.createPlaylist(name), list)
  await page.reload()
  const button = (root, name) => root.getByRole('button', { name, exact: true })
  const home = page.getByRole('region', { name: '歌手主页' })
  const box = page.getByRole('searchbox', { name: '搜索本地歌曲' })
  await box.fill('One Last Kiss')
  await button(
    page.locator('.library-row').filter({ hasText: 'One Last Kiss' }).first(),
    '宇多田光',
  ).click()
  await expect(home.getByRole('heading', { name: '宇多田光', exact: true })).toBeVisible()
  const follow = button(home, '关注宇多田光')
  await expect(follow).toBeEnabled({ timeout: 90000 })
  await button(home, '查找相似歌手').click()
  const similar = home.getByRole('region', { name: '相似歌手' })
  await expect(similar.locator('.release-event-head').first()).toBeVisible({ timeout: 120000 })
  evidence.unfollowedSimilar = await similar
    .locator('.release-event-head .catalog-text-link')
    .allTextContents()
  await follow.click()
  evidence.similarWhileUnfollowed = true
  await expect(button(home, '取消关注宇多田光')).toBeVisible()
  await page.screenshot({ path: path.join(root, '未离开主页关注与相似歌手.png') })
  const candidates = similar.locator('.release-event')
  const attempts = []
  for (let i = 0; i < Math.min(await candidates.count(), 5) && !evidence.played; i++) {
    const candidate = candidates.nth(i)
    await button(candidate, '代表作').click()
    const rows = candidate.locator('.highlight-recording')
    try {
      await rows.first().waitFor({ timeout: 30000 })
    } catch {
      continue
    }
    for (let j = 0; j < Math.min(4, await rows.count()); j++) {
      const row = rows.nth(j),
        title = await row.locator('.catalog-song-title').first().textContent()
      await row.dispatchEvent('dblclick')
      try {
        await expect
          .poll(
            async () => [
              await page.locator('.music-title-row strong').first().textContent(),
              await page.locator('audio').evaluate((a) => !a.paused && a.currentTime > 0.2),
            ],
            { timeout: 12000 },
          )
          .toEqual([title, true])
        await button(row, '加入歌单').click()
        await page.getByRole('menuitem', { name: list, exact: true }).click()
        await expect
          .poll(() =>
            page.evaluate(
              async (id) =>
                (await window.music.state()).playlists.find((l) => l.id === id)?.tracks.length,
              listId,
            ),
          )
          .toBe(1)
        evidence.played = title
        break
      } catch {
        attempts.push(title)
      }
    }
  }
  evidence.skippedAttempts = attempts
  await button(home, '查找相似歌手').click()
  await home
    .locator('.catalog-releases button')
    .filter({ hasText: 'One Last Kiss' })
    .first()
    .click()
  const album = page.getByRole('region', { name: '专辑主页' })
  await expect(album.getByRole('heading', { name: 'One Last Kiss', exact: true })).toBeVisible()
  await button(album.locator('header'), '宇多田光').click({ timeout: 15000 })
  await expect(button(home, '取消关注宇多田光')).toBeEnabled({ timeout: 60000 })
  await page.getByRole('tab', { name: '歌手', exact: true }).click()
  const cards = page.locator('.followed-artist-card')
  await expect(cards.filter({ hasText: /宇多田|Utada/ })).toHaveCount(1)
  const gem = cards.filter({ hasText: /紫棋/ })
  await expect(gem.locator('img')).toHaveAttribute('src', /^data:image/)
  const measurements = await cards.evaluateAll((cards) =>
    cards.map((c) => {
      const b = c.querySelector('.artist-follow-button').getBoundingClientRect(),
        r = c.getBoundingClientRect(),
        image = c.querySelector('img')
      return {
        top: r.top,
        y: b.y,
        name: c.querySelector('.artist-home-link').textContent,
        origin: getComputedStyle(image).objectPosition,
        width: image.naturalWidth,
        height: image.naturalHeight,
      }
    }),
  )
  for (const card of measurements)
    assert.ok(
      measurements.filter((c) => c.top === card.top).every((c) => Math.abs(c.y - card.y) < 1),
    )
  evidence.cards = measurements
  await gem.screenshot({ path: path.join(root, '邓紫棋圆形头像.png') })
  await page.screenshot({ path: path.join(root, '关注卡片.png') })
  await button(
    cards.filter({ hasText: /宇多田|Utada/ }),
    measurements.find((c) => /宇多田|Utada/.test(c.name))?.name,
  ).click()
  await expect(home.locator('header .artist-follow-button')).toContainText('已关注')
  await home.locator('header .artist-follow-button').click()
  await expect(home.locator('header .artist-follow-button')).toHaveText('关注')
  await button(home, '返回').click()
  await expect(cards.filter({ hasText: /宇多田|Utada/ })).toHaveCount(0)
  evidence.unfollowSynced = true
  assert.ok(evidence.played)
  evidence.passed = true
} finally {
  await fs.writeFile(path.join(root, '验收.json'), JSON.stringify(evidence, null, 2))
  if (app) {
    const page = await app.firstWindow()
    console.log((await page.locator('body').textContent()).slice(-1000))
    await app.close()
  }
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 4 })
  console.log(JSON.stringify(evidence))
}
