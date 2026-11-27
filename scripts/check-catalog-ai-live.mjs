import { _electron as electron, expect } from '@playwright/test'
import { backup, DatabaseSync } from 'node:sqlite'
import { mkdir, mkdtemp, copyFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { isolateRecommendationProfile } from './isolate-recommendation-profile.mjs'

const root = await mkdtemp(path.resolve('tmp/catalog-ai-live-')),
  profile = path.join(root, 'profile'),
  original = path.resolve('local/desktop-profile')
let app
try {
  const directory = path.join(profile, 'fitbay-music')
  await mkdir(directory, { recursive: true })
  const source = new DatabaseSync(path.join(original, 'fitbay-music/music.sqlite'), {
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
      ['followed-musicbrainz-artists', '[]'],
    ])
      set.run(key, value)
  } finally {
    db.close()
  }
  await copyFile(path.join(original, 'Local State'), path.join(profile, 'Local State'))
  app = await electron.launch({
    args: [
      path.resolve(process.env.FITBAY_TEST_HOST || 'dist/component-prototype/host'),
      '--mode=music',
      '--mute-audio',
      '--user-data-dir=' + profile,
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
  await app.evaluate(() => {
    const fetchOriginal = globalThis.fetch
    globalThis.calls = []
    globalThis.fetch = async (url, ...args) => {
      const response = await fetchOriginal(url, ...args)
      if (new URL(url).hostname === 'api.deepseek.com')
        globalThis.calls.push({ model: true, status: response.status })
      if (new URL(url).hostname === 'musicbrainz.org' && new URL(url).pathname.endsWith('/artist'))
        globalThis.calls.push({ artist: new URL(url).searchParams.get('query') })
      return response
    }
  })
  const page = await app.firstWindow(),
    calls = () => app.evaluate(() => globalThis.calls)
  await page.getByRole('tab', { name: '曲库', exact: true }).click()
  const reference = page.getByRole('button', { name: 'AI 搜索', exact: true })
  const color = (button) =>
    button.evaluate(async (el) => {
      await new Promise(requestAnimationFrame)
      await Promise.allSettled(el.getAnimations().map((animation) => animation.finished))
      return getComputedStyle(el).backgroundColor
    })
  const libraryTab = page.getByRole('tab', { name: '曲库', exact: true })
  await libraryTab.hover()
  const offColor = await color(reference)
  await reference.click()
  await libraryTab.hover()
  const onColor = await color(reference)
  assert.notEqual(onColor, offColor)
  await reference.click()
  const artistTab = page.getByRole('tab', { name: '歌手', exact: true })
  await artistTab.click()
  const field = page.getByLabel('要关注的歌手')
  async function ime(input) {
    for (const init of [
      { isComposing: true, keyCode: 13 },
      { isComposing: false, keyCode: 229 },
    ])
      assert.equal(
        await input.evaluate(
          (el, init) =>
            el.dispatchEvent(
              new KeyboardEvent('keydown', {
                ...init,
                key: 'Enter',
                bubbles: true,
                cancelable: true,
              }),
            ),
          init,
        ),
        false,
      )
  }
  await field.fill('周杰伦')
  await field.press('Enter')
  await expect(page.getByRole('button', { name: '关注周杰倫', exact: true })).toBeVisible({
    timeout: 45000,
  })
  assert.equal((await calls()).filter((x) => x.model).length, 0)
  const toggleArtist = page.getByRole('button', { name: 'AI 搜索歌手' })
  const checkMode = async (enabled) => {
    await artistTab.hover()
    await expect(toggleArtist).toHaveAttribute('aria-pressed', String(enabled))
    await expect(toggleArtist).toHaveCSS('background-color', enabled ? onColor : offColor)
  }
  await checkMode(false)
  await toggleArtist.click()
  await checkMode(true)
  await field.fill('唱《晴天》和《稻香》的台湾男歌手')
  await ime(field)
  assert.equal((await calls()).filter((x) => x.model).length, 0)
  await field.press('Enter')
  await expect
    .poll(async () => (await calls()).filter((x) => x.model).length, { timeout: 70000 })
    .toBe(1)
  await expect(page.getByRole('button', { name: '关注周杰倫', exact: true })).toBeVisible({
    timeout: 40000,
  })
  await checkMode(true)
  const capture = (mode) =>
    field.locator('..').screenshot({
      path: path.join(root, 'artist-ai-' + mode + '.png'),
      style: ':root { background: var(--base) !important }',
    })
  await capture('on')
  await toggleArtist.click()
  await checkMode(false)
  await field.fill('周杰伦')
  await field.press('Enter')
  await expect(page.getByRole('button', { name: '关注周杰倫', exact: true })).toBeVisible({
    timeout: 45000,
  })
  await checkMode(false)
  await capture('off')
  assert.equal((await calls()).filter((x) => x.model).length, 1)
  await page.getByRole('button', { name: '关注周杰倫', exact: true }).click()
  const artist = await page.evaluate(() => window.music.followedArtists())
  assert.equal(artist[0].id, 'a223958d-5c56-4b2c-a30a-87e357bc121b')
  await page.getByRole('tab', { name: '找歌', exact: true }).click()
  await page.getByRole('tab', { name: '公开歌单', exact: true }).click()
  const panel = page.getByRole('region', { name: '公开歌单' }),
    input = panel.getByRole('textbox')
  await page.getByRole('tab', { name: '普通搜索', exact: true }).click()
  await input.fill('爵士')
  await input.press('Enter')
  await expect(panel.locator('.public-list-card').first()).toBeVisible({ timeout: 35000 })
  assert.equal((await calls()).filter((x) => x.model).length, 1)
  await page.getByRole('tab', { name: 'AI 推荐', exact: true }).click()
  await page.getByRole('tab', { name: '公开歌单', exact: true }).click()
  await input.fill('想找几张适合安静咖啡店听的爵士歌单')
  await ime(input)
  await input.press('Enter')
  await expect
    .poll(async () => (await calls()).filter((x) => x.model).length, { timeout: 75000 })
    .toBe(2)
  await expect(panel.getByRole('button', { name: '推荐歌单' })).toBeEnabled({ timeout: 35000 })
  await expect(panel.locator('.public-list-card').first()).toBeVisible({ timeout: 35000 })
  const cards = await panel.locator('.public-list-card').allTextContents()
  await panel.locator('.public-list-card').first().click()
  await expect(panel.locator('.public-songs li').first()).toBeVisible({ timeout: 45000 })
  const title = await panel.locator('h2').textContent()
  const rows = panel.locator('.public-songs li'),
    titles = await rows.locator('strong').allTextContents()
  let played
  for (const index of Array.from({ length: Math.min(titles.length, 8) }, (_, i) => i)) {
    await rows
      .nth(index)
      .getByRole('button', { name: '播放 ' + titles[index], exact: true })
      .click()
    try {
      const audio = page.locator('audio')
      await expect
        .poll(
          async () => [
            await page.locator('.music-player .music-title-row strong').textContent(),
            await audio.evaluate((a) => !a.paused && a.readyState >= 2 && a.currentTime > 0.15),
          ],
          { timeout: 25000 },
        )
        .toEqual([titles[index], true])
      const start = await audio.evaluate((a) => a.currentTime)
      await expect.poll(() => audio.evaluate((a) => a.currentTime)).toBeGreaterThan(start + 0.3)
      played = {
        title: titles[index],
        start,
        ...(await audio.evaluate((a) => ({
          end: a.currentTime,
          duration: a.duration,
          protocol: new URL(a.currentSrc).protocol,
        }))),
      }
      break
    } catch {
      console.log('试听未取得完整录音', titles[index])
    }
  }
  assert.ok(played)
  await panel.getByRole('button', { name: '导入到我的歌单', exact: true }).click()
  await expect(panel.getByRole('status').filter({ hasText: /已导入 · 新增|全部重复/ })).toBeVisible(
    { timeout: 60000 },
  )
  const imported = await page.evaluate(async (title) => {
    const s = await window.music.state(),
      p = s.playlists.find((p) => p.name === title),
      names = new Map([...s.localTracks, ...s.onlineTracks].map((t) => [t.id, t.title]))
    return p?.tracks.map((id) => names.get(id))
  }, title)
  assert.deepEqual(imported, titles)
  const report = {
    artist: artist.map(({ id, name }) => ({ id, name })),
    calls: await calls(),
    playlists: cards.slice(0, 4),
    played,
    imported: { title, count: imported.length, sameOrder: true },
    imePrevented: true,
    openedSongs: await panel.locator('.public-songs li').count(),
  }
  await writeFile(path.join(root, '验收.json'), JSON.stringify(report, null, 2))
  console.log(
    'PASS 普通歌手与公开歌单无模型请求，两个 AI 入口各调用一次模型并返回真实目录实体',
    root,
    JSON.stringify(report),
  )
} finally {
  await app?.close()
  await rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 300 })
}
