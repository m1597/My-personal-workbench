import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdtemp, copyFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { MusicStore } from '../components/music/store.mjs'

const root = await mkdtemp(path.resolve('tmp/artist-catalog-ui-'))
const profile = path.join(root, 'profile'),
  music = path.join(profile, 'fitbay-music')
await mkdir(music, { recursive: true })
const artist = { name: '周杰倫', id: 'a223958d-5c56-4b2c-a30a-87e357bc121b', detail: 'TW · Person' }
const db = new MusicStore(music)
db.set('followed-musicbrainz-artists', JSON.stringify([artist]))
db.set('music-guide-v1', '1')
const file = path.join(root, '离线试听.mp3')
await copyFile(path.resolve('tests/fixtures/local-music/tone.mp3'), file)
db.library.upsert({ file, title: '离线试听', artist: artist.name, album: '离线', duration: 4 })
db.db.close()
const launch = () =>
  electron.launch({
    args: [
      path.resolve(process.env.FITBAY_TEST_HOST || 'dist/component-prototype/host'),
      '--mode=music',
      '--mute-audio',
      '--user-data-dir=' + profile,
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
async function home(app) {
  const page = await app.firstWindow()
  await page.getByRole('tab', { name: '歌手', exact: true }).click()
  await page
    .getByRole('region', { name: '我关注的歌手' })
    .getByRole('button', { name: artist.name, exact: true })
    .click()
  return page
}
let app = await launch()
try {
  const page = await home(app)
  const all = page.getByRole('region', { name: '全部歌曲' })
  await expect(all.getByRole('listitem')).toHaveCount(30, { timeout: 90000 })
  const first = await all.getByRole('listitem').allTextContents()
  await all.getByRole('button', { name: '下一页' }).click()
  await expect(all.getByRole('listitem')).toHaveCount(30, { timeout: 60000 })
  const second = await all.getByRole('listitem').allTextContents()
  assert.notDeepEqual(first, second)
  await writeFile(
    path.join(root, '实网录音页.json'),
    JSON.stringify(
      { artist, total: await all.getByRole('heading').textContent(), first, second },
      null,
      2,
    ),
  )
  await page.screenshot({
    path: path.join(root, '真实目录第二页.png'),
    style: ':root{background:var(--base)!important}',
  })
} finally {
  await app.close()
}
app = await launch()
try {
  await app.evaluate(() => {
    globalThis.fetch = async () => {
      throw new TypeError('fixture disconnected')
    }
  })
  const page = await home(app)
  const all = page.getByRole('region', { name: '全部歌曲' })
  await expect(all.getByRole('listitem')).toHaveCount(30)
  await page
    .getByRole('region', { name: '歌手主页' })
    .getByText('离线试听', { exact: true })
    .first()
    .click()
  await expect
    .poll(() => page.locator('audio').evaluate((a) => !a.paused && a.currentTime > 0.2))
    .toBe(true)
  console.log('PASS 真实周杰倫主页两页、重启离线缓存与本地录音播放', root)
} finally {
  await app.close()
}
