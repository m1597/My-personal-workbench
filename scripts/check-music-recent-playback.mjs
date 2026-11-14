import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile, unlink, access } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { writeFixtureRecording } from './music-recording-fixture.mjs'

await mkdir('tmp', { recursive: true })
const root = await mkdtemp(path.resolve('tmp/recent-playback-'))
const profile = path.join(root, 'profile'),
  library = path.join(profile, 'fitbay-music')
const setup = new MusicStore(library)
setup.set('music-guide-v1', 1)
const yesterday = new Date()
yesterday.setDate(yesterday.getDate() - 1)
const list = setup.library.createPlaylist('重听验收')
const tracks = {}
for (const [index, title] of ['短歌', '外部删除', '昨日曲目'].entries()) {
  const file = path.join(root, title + '.wav')
  await writeFixtureRecording(file, index + 1, 2)
  setup.library.upsert({ file, title, artist: '验收艺人', album: '', duration: 2 })
  const id = setup.db.prepare('SELECT id FROM local_tracks WHERE file=?').get(file).id
  tracks[title] = { id, file }
  setup.library.heard(id, yesterday.getTime() + index)
}
setup.library.setMembership(list, tracks.短歌.id, true)
setup.db.close()
const db = new DatabaseSync(path.join(library, 'music.sqlite'), { readOnly: true })
const events = () =>
  db
    .prepare('SELECT playedAt FROM local_play_history WHERE track=? ORDER BY playedAt')
    .all(tracks.短歌.id)
    .map((row) => row.playedAt)
const launch = () =>
  electron.launch({
    args: [
      path.resolve(process.env.FITBAY_TEST_HOST_DIR || 'dist/component-prototype/host'),
      '--mode=music',
      '--mute-audio',
      '--user-data-dir=' + profile,
      '--workbench=' + path.resolve('out/renderer/index.html'),
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
const evidence = {}
let app = await launch()
async function openHistory(page) {
  const tab = page.getByRole('tab', { name: '曲库' })
  await tab.click()
  const nav = page.getByRole('button', { name: '曲库导航', exact: true })
  if (await nav.isVisible()) await nav.click()
  await page.getByRole('button', { name: '最近播放', exact: true }).click()
  await expect(page.getByRole('heading', { name: '最近播放' })).toBeVisible()
  return page.getByRole('region', { name: '最近播放' })
}
try {
  const page = await app.firstWindow()
  await app.evaluate(({ BaseWindow }) =>
    BaseWindow.getAllWindows()
      .find((w) => w.getTitle() === 'Music')
      ?.setContentSize(1000, 740),
  )
  const button = (name) => page.getByRole('button', { name, exact: true })
  const playlistTab = page.getByRole('tab', { name: '歌单', exact: true })
  await playlistTab.click()
  await button('重听验收').click()
  const playbackCount = async () =>
    page.evaluate(
      async (id) => (await window.music.state()).localTracks.find((t) => t.id === id).playCount,
      tracks.短歌.id,
    )
  evidence.priorDay = events()
  evidence.playCounts = [await playbackCount()]
  for (let n = 1; n <= 2; n++) {
    await button('播放短歌').click()
    await expect.poll(() => events().length, { timeout: 15000 }).toBe(n + 1)
    evidence.playCounts.push(await playbackCount())
  }
  evidence.recorded = events()
  const history = await openHistory(page)
  await history.locator('li').first().click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: '查看文件所在位置' })).toBeVisible()
  await page.keyboard.press('Escape')
  const song = history.getByRole('listitem').filter({ hasText: '短歌' })
  await expect(song.first()).toBeVisible()
  evidence.times = await song.locator('small').allTextContents()
  evidence.today = await history
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: '今天', exact: true }) })
    .getByRole('button')
    .allTextContents()
  evidence.yesterday = await history
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: '昨天', exact: true }) })
    .getByRole('button')
    .allTextContents()
  await page.screenshot({
    path: path.join(root, '两次完整播放.png'),
    style: ':root {background: var(--base) !important}',
  })
  await playlistTab.click()
  await button('重听验收').click()
  await button('从曲库移除短歌').click()
  await button('仅从当前歌单移除').click()
  await expect(button('从曲库移除短歌')).toHaveCount(0)
  await openHistory(page)
  await expect(song.first()).toBeVisible()
  evidence.afterPlaylistRemoval = await song.count()
  await button('全部歌曲').click()
  await button('从曲库移除短歌').click()
  await button('仅从 FitBay 移除').click()
  await expect(button('从曲库移除短歌')).toHaveCount(0)
  await access(tracks.短歌.file)
  await unlink(tracks.外部删除.file)
  await openHistory(page)
  await expect(history.getByRole('button', { name: /昨日曲目/ })).toBeVisible()
  evidence.afterFileRemoval = await history.getByRole('button').allTextContents()
  await app.close()
  app = await launch()
  const reopened = await app.firstWindow()
  const restored = await openHistory(reopened)
  await expect(restored.getByRole('button', { name: /昨日曲目/ })).toBeVisible()
  evidence.reopened = await restored.getByRole('button').allTextContents()
  await writeFile(path.join(root, 'result.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(evidence), root)
  assert.deepEqual(evidence.playCounts, [1, 2, 3])
  assert.equal(evidence.recorded.length, 3)
  assert.ok(evidence.recorded[2] > evidence.recorded[1])
  assert.deepEqual(evidence.times, [new Date(evidence.recorded[2]).toLocaleString('zh-CN')])
  assert.deepEqual(evidence.today, ['短歌 · 验收艺人'])
  assert.deepEqual(evidence.yesterday, ['昨日曲目 · 验收艺人', '外部删除 · 验收艺人'])
  assert.equal(evidence.afterPlaylistRemoval, 1)
  assert.deepEqual(evidence.afterFileRemoval, ['昨日曲目 · 验收艺人'])
  assert.deepEqual(evidence.reopened, evidence.afterFileRemoval)
} finally {
  db.close()
  await app.close()
}
