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
// Simulate an earlier library index. The actual ID3 tag contains two artists.
const legacy = path.join(root, '旧库录音.mp3')
const original = await fs.readFile(path.resolve('tests/fixtures/local-music/tone.mp3'))
const oldSize = original.subarray(6, 10).reduce((n, b) => n * 128 + b, 0)
const value = Buffer.concat([Buffer.of(3), Buffer.from(artists.join('\0'))])
const frame = Buffer.alloc(10)
frame.write('TPE1')
frame[7] = value.length
const header = Buffer.from([73, 68, 51, 4, 0, 0, 0, 0, 0, value.length + 10])
await fs.writeFile(legacy, Buffer.concat([header, frame, value, original.subarray(oldSize + 10)]))
store.library.upsert({
  file: legacy,
  title: '旧库录音',
  artist: artists.join(' & '),
  album: '',
  duration: 2,
})
store.db.exec('DROP TABLE legacy_artist_credit_reads')
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
  const cover = (await fs.readFile('components/music/default-cover.png')).toString('base64')
  await app.evaluate(
    (_electron, { cover, ids, artists }) => {
      globalThis.fetch = async (input) => {
        const url = new URL(input)
        if (url.hostname === 'coverartarchive.org')
          return new Response(null, {
            status: 307,
            headers: { location: 'https://archive.org/download/fixture/cover.png' },
          })
        if (url.hostname === 'archive.org')
          return new Response(Buffer.from(cover, 'base64'), {
            headers: { 'content-type': 'image/png' },
          })
        return new Response(
          JSON.stringify({
            artists: [],
            recordings: [],
            'recording-count': 0,
            'release-groups': [
              {
                id: '038531e0-88d6-4dec-9df5-2d7852c891d2',
                title: '署名专辑',
                'primary-type': 'Album',
                'first-release-date': '2020-01-01',
                'artist-credit': artists.map((name, i) => ({
                  artist: { name, id: ids[i] },
                  name,
                  joinphrase: i ? '' : ' & ',
                })),
              },
            ],
          }),
        )
      }
    },
    { cover, ids, artists },
  )
  const button = (name) => page.getByRole('button', { name, exact: true })
  const song = (title) => page.locator('.library-row').filter({ hasText: title })
  await page.getByRole('tab', { name: '曲库', exact: true }).press('Enter')
  for (const name of artists) {
    await expect(song('旧库录音').getByRole('button', { name, exact: true })).toBeVisible()
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
    if (name === artists[0]) {
      await home.getByRole('button', { name: /署名专辑/ }).press('Enter')
      const album = page.getByRole('region', { name: '专辑主页' })
      await expect(album.locator('header img')).toHaveAttribute(
        'src',
        /^data:image\/jpeg;base64,/,
        { timeout: 12000 },
      )
      for (const credit of artists)
        await expect(
          album.locator('header').getByRole('button', { name: credit, exact: true }),
        ).toBeVisible()
      await album.screenshot({ path: path.join(root, '发行封面.png') })
      await album.getByRole('button', { name: '返回', exact: true }).press('Enter')
    }
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
