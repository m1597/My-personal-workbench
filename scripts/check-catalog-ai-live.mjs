import { _electron as electron, expect } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, mkdtemp, copyFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { MusicStore } from '../components/music/store.mjs'

const root = await mkdtemp(path.resolve('tmp/catalog-ai-live-')),
  profile = path.join(root, 'profile'),
  original = path.resolve('local/desktop-profile')
let app
try {
  await mkdir(profile)
  const db = new MusicStore(path.join(profile, 'fitbay-music')),
    source = new DatabaseSync(path.join(original, 'fitbay-music/music.sqlite'), { readOnly: true })
  try {
    db.set(
      'recommendation-providers',
      source.prepare("SELECT value FROM state WHERE key='recommendation-providers'").get().value,
    )
    db.set('music-guide-v1', '1')
    db.set('music-global-keys', 'off')
    db.set('music-media-keys', 'off')
  } finally {
    source.close()
    db.db.close()
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
  await page.getByRole('tab', { name: '歌手', exact: true }).click()
  const field = page.getByLabel('要关注的歌手')
  await field.fill('周杰伦')
  await field.press('Enter')
  await expect(page.getByRole('button', { name: '关注周杰倫', exact: true })).toBeVisible({
    timeout: 45000,
  })
  assert.equal((await calls()).filter((x) => x.model).length, 0)
  await page.getByRole('button', { name: 'AI 搜索歌手' }).click()
  await field.fill('唱《晴天》和《稻香》的台湾男歌手')
  await field.press('Enter')
  await expect
    .poll(async () => (await calls()).filter((x) => x.model).length, { timeout: 70000 })
    .toBe(1)
  await expect(page.getByRole('button', { name: '关注周杰倫', exact: true })).toBeVisible({
    timeout: 40000,
  })
  await page.getByRole('button', { name: '关注周杰倫', exact: true }).click()
  const artist = await page.evaluate(() => window.music.followedArtists())
  assert.equal(artist[0].id, 'a223958d-5c56-4b2c-a30a-87e357bc121b')
  await page.getByRole('tab', { name: '找歌', exact: true }).click()
  await page.getByRole('tab', { name: '公开歌单', exact: true }).click()
  const panel = page.getByRole('region', { name: '公开歌单' }),
    ai = panel.getByRole('button', { name: 'AI 推荐' }),
    input = panel.getByRole('textbox')
  if ((await ai.getAttribute('aria-pressed')) === 'true') await ai.click()
  await input.fill('爵士')
  await input.press('Enter')
  await expect(panel.locator('.public-list-card').first()).toBeVisible({ timeout: 35000 })
  assert.equal((await calls()).filter((x) => x.model).length, 1)
  await ai.click()
  await input.fill('想找几张适合安静咖啡店听的爵士歌单')
  await input.press('Enter')
  await expect
    .poll(async () => (await calls()).filter((x) => x.model).length, { timeout: 75000 })
    .toBe(2)
  await expect(panel.getByRole('button', { name: '推荐歌单' })).toBeEnabled({ timeout: 35000 })
  await expect(panel.locator('.public-list-card').first()).toBeVisible({ timeout: 35000 })
  const cards = await panel.locator('.public-list-card').allTextContents()
  await panel.locator('.public-list-card').first().click()
  await expect(panel.locator('.public-songs li').first()).toBeVisible({ timeout: 45000 })
  const report = {
    artist: artist.map(({ id, name }) => ({ id, name })),
    calls: await calls(),
    playlists: cards.slice(0, 4),
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
