import path from 'node:path'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { writeFixtureRecording } from './music-recording-fixture.mjs'
const root = await fs.mkdtemp(path.resolve('tmp/artist-credits-')),
  profile = path.join(root, 'profile')
const store = new MusicStore(path.join(profile, 'fitbay-music'))
store.set('music-guide-v1', 1)
const ids = ['7bc36add-4c91-4a0e-ae85-034b04211eaa', 'dd75fbd5-3112-44f4-8cb7-4e07a2e56a1b']
const artists = ['A & B', '歌手乙']
const rows = []
for (const [title, artist, artistCredits] of [
  ['合作录音', artists.join(' & '), artists.map((name, i) => ({ name, id: ids[i] }))],
  ['无署名录音', '未知艺人', undefined],
]) {
  const file = path.join(root, title + '.wav')
  await writeFixtureRecording(file, 123, 30)
  store.library.upsert({ file, title, artist, artistCredits, album: '小碟', duration: 30 })
  rows.push(store.db.prepare('SELECT id FROM local_tracks WHERE file=?').get(file).id)
}
store.library.createPlaylist('署名验收', rows)
store.db.close()
const app = await electron.launch({
  args: [
    path.resolve('dist/component-prototype/host'),
    '--mode=music',
    '--mute-audio',
    '--user-data-dir=' + profile,
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 850 })
  await app.evaluate(() => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ artists: [], recordings: [], 'release-groups': [], 'recording-count': 0 }),
        { status: 200 },
      )
  })
  const button = (name) => page.getByRole('button', { name, exact: true })
  const song = (title) => page.locator('.library-row').filter({ hasText: title })
  await page.getByRole('tab', { name: '曲库', exact: true }).press('Enter')
  for (const name of artists) {
    const link = song('合作录音').getByRole('button', { name, exact: true })
    await link.press('Enter')
    const home = page.getByRole('region', { name: '歌手主页' })
    await expect(home.getByRole('heading', { name, exact: true })).toBeVisible()
    const collab = home.locator('.catalog-recording').filter({ hasText: '合作录音' })
    await expect(collab).toBeVisible()
    await expect(collab.getByRole('button', { name: '查看文件所在位置' })).toBeVisible()
    await expect(collab.getByRole('button', { name: '加入歌单' })).toBeVisible()
    await collab.getByRole('button', { name: '播放合作录音' }).press('Enter')
    await expect
      .poll(() => page.locator('audio').evaluate((a) => !a.paused && a.currentTime > 0.1))
      .toBe(true)
    await home.screenshot({ path: path.join(root, name + '.png') })
    await home.getByRole('button', { name: '返回', exact: true }).press('Enter')
  }
  await expect(song('合作录音').getByRole('button', { name: 'A', exact: true })).toHaveCount(0)
  for (const scope of ['曲库', '歌单']) {
    await page.getByRole('tab', { name: scope, exact: true }).press('Enter')
    if (scope === '歌单') await button('署名验收').press('Enter')
    const unknown = song('无署名录音')
    await expect(unknown).toContainText('未知艺人')
    await expect(unknown.getByRole('button', { name: '未知艺人' })).toHaveCount(0)
    if (await unknown.getByRole('button', { name: '播放无署名录音' }).count())
      await unknown.getByRole('button', { name: '播放无署名录音' }).press('Enter')
    await expect
      .poll(() => page.locator('audio').evaluate((a) => !a.paused && a.currentTime > 0.1))
      .toBe(true)
  }
  await button('打开歌词页').press('Enter')
  await expect(page.locator('.now-playing')).toContainText('未知艺人')
  await expect(button('未知艺人')).toHaveCount(0)
  await page.screenshot({ path: path.join(root, '无署名播放.png') })
  assert.equal((await page.evaluate(() => window.music.state())).current, rows[1])
  console.log('PASS', root)
} finally {
  await app.close()
}
