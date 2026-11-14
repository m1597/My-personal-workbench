import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs/promises'
import { backup, DatabaseSync } from 'node:sqlite'
import { _electron as electron, expect } from '@playwright/test'
import { isolateRecommendationProfile } from './isolate-recommendation-profile.mjs'
import { openDiscovery } from './discovery-fixture.mjs'

const platform = process.argv[2] || process.env.FITBAY_TEST_PLATFORM
const label = { wy: '网易云音乐', tx: 'QQ 音乐', kg: '酷狗音乐' }[platform]
assert.ok(label, '请选择 wy、tx 或 kg')
const root = await fs.mkdtemp(path.resolve('tmp/public-playlists-' + platform + '-'))
console.log(root)
const profile = path.join(root, 'profile')
const directory = path.join(profile, 'fitbay-music')
const evidence = { platform }
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
    isolateRecommendationProfile(db, directory)
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
  evidence.source = await page.evaluate(() => window.music.lxInfo())
  const listName = '公开歌单验收 ' + label
  const id = await page.evaluate((name) => window.music.createPlaylist(name), listName)
  await page.reload()
  await openDiscovery(page, false)
  await page.getByRole('tab', { name: '公开歌单', exact: true }).click()
  const panel = page.getByRole('region', { name: '公开歌单' })
  await panel.getByRole('tab', { name: label, exact: true }).click()
  const genre = panel.getByRole('combobox', { name: '歌单风格' })
  await genre.click()
  await page.getByRole('option', { name: '流行', exact: true }).click({ timeout: 30000 })
  const cards = panel.locator('.public-cards button')
  await expect(cards.first()).toBeVisible({ timeout: 45000 })
  evidence.cards = await cards.count()

  const input = panel.getByRole('textbox', { name: '搜索公开歌单' })
  await input.fill('流行')
  for (const detail of [{ isComposing: true, keyCode: 229 }, { repeat: true }])
    assert.equal(
      await input.evaluate(
        (el, flags) =>
          el.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Enter',
              bubbles: true,
              cancelable: true,
              ...flags,
            }),
          ),
        detail,
      ),
      false,
    )
  assert.equal(await cards.count(), evidence.cards)
  await input.press('Enter')
  await expect(panel.getByRole('heading', { name: '搜索结果' })).toBeVisible()
  await expect(cards.first()).toBeVisible({ timeout: 45000 })
  evidence.searchHit = await cards.first().locator('strong').textContent()
  await genre.click()
  await page.getByRole('option', { name: '流行', exact: true }).click()
  await expect(panel.getByRole('heading', { name: '热门歌单' })).toBeVisible()
  await expect(cards.first()).toBeVisible({ timeout: 45000 })
  const card = cards.nth(Number(process.env.FITBAY_TEST_LIST_INDEX || 0))
  evidence.list = await card.locator('strong').textContent()
  await card.click()
  const rows = panel.locator('.public-songs li')
  await expect(rows.nth(1)).toBeVisible({ timeout: 60000 })
  const titles = await rows.locator('strong').allTextContents()
  evidence.count = titles.length
  evidence.first = titles.slice(0, 4)
  console.log(label, evidence.list, titles.length, titles.slice(0, 3))
  await page.evaluate(() => delete document.documentElement.dataset.backdrop)
  await page.screenshot({ path: path.join(root, '歌单.png') })
  for (const index of [0, 1]) await rows.nth(index).getByRole('checkbox').check()
  await panel.getByRole('combobox', { name: '加入自己的歌单' }).click()
  await page.getByRole('option', { name: listName, exact: true }).click()
  const libraryState = () =>
    page.evaluate(async (id) => {
      const state = await window.music.state()
      const byId = new Map(
        [...state.localTracks, ...state.onlineTracks].map((t) => [t.id, t.title]),
      )
      return {
        saved: state.playlists.find((p) => p.id === id)?.tracks.map((i) => byId.get(i)),
        queue: state.queue.map((i) => byId.get(i)),
        current: byId.get(state.current),
      }
    }, id)
  await expect.poll(async () => (await libraryState()).saved).toEqual(titles.slice(0, 2))
  evidence.added = (await libraryState()).saved
  const audio = page.locator('audio')
  async function measure(title) {
    await expect
      .poll(
        async () => [
          await page.locator('.music-player .music-title-row strong').textContent(),
          await audio.evaluate((a) => !a.paused && a.readyState >= 2 && a.currentTime > 0.12),
        ],
        { timeout: 50000 },
      )
      .toEqual([title, true])
    const start = await audio.evaluate((a) => a.currentTime)
    await expect
      .poll(() => audio.evaluate((a) => a.currentTime), { timeout: 6000 })
      .toBeGreaterThan(start + 0.25)
    return audio.evaluate((a) => ({
      time: a.currentTime,
      duration: a.duration,
      protocol: new URL(a.currentSrc).protocol,
    }))
  }
  await rows
    .nth(1)
    .getByRole('button', { name: '播放 ' + titles[1], exact: true })
    .click()
  try {
    evidence.single = await measure(titles[1])
  } catch (e) {
    evidence.singleError = String(e).slice(0, 500)
  }
  await panel.getByRole('button', { name: '播放全部', exact: true }).click()
  try {
    evidence.all = await measure(titles[0])
  } catch (e) {
    evidence.allError = String(e).slice(0, 500)
  }
  const actual = await libraryState()
  evidence.queue = {
    count: actual.queue.length,
    first: actual.queue.slice(0, 4),
    sameOrder: JSON.stringify(actual.queue) === JSON.stringify(titles),
  }
  evidence.status = await page
    .locator('footer [role=status],.public-playlists [role=alert]')
    .allTextContents()
  assert.ok(evidence.single && evidence.all && evidence.queue.sameOrder, JSON.stringify(evidence))
  evidence.passed = true
} finally {
  await fs.writeFile(path.join(root, '验证.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(evidence))
  await app?.close()
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 300 })
}
