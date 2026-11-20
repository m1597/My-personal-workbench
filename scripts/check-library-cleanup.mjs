import { _electron as electron, expect } from '@playwright/test'
import path from 'node:path'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, appendFile, copyFile, writeFile, readFile, stat } from 'node:fs/promises'
import { MusicStore } from '../components/music/store.mjs'
import { writeFixtureRecording } from './music-recording-fixture.mjs'
const root = await mkdtemp(path.resolve('tmp/library-cleanup-')),
  profile = path.join(root, 'profile'),
  dir = path.join(root, '素材')
await mkdir(dir)
const store = new MusicStore(path.join(profile, 'fitbay-music'))
store.set('music-guide-v1', 1)
const id = {}
async function row(file, title, seed, clone) {
  file = path.join(dir, file)
  if (clone) await copyFile(path.join(dir, clone), file)
  else await writeFixtureRecording(file, seed, 5)
  store.library.upsert({
    file,
    title,
    artist: '测试',
    album: '测试专辑',
    duration: 5,
    size: (await stat(file)).size,
  })
  id[path.basename(file)] = store.db
    .prepare('SELECT id FROM local_tracks WHERE file=?')
    .get(file).id
}
await row('01 - 夜路.wav', '夜路', 1)
await row('同录音.wav', '别名', 0, '01 - 夜路.wav')
await row('不同标签.wav', '同录音不同文件内容', 0, '01 - 夜路.wav')
await appendFile(
  path.join(dir, '不同标签.wav'),
  Buffer.from('TAG' + 'different metadata'.padEnd(125)),
)
await row('06 - 歌词归属.wav', '歌词归属', 9)
await writeFile(path.join(dir, '06 - 歌词归属.lrc'), '只属于第一首')
await writeFile(path.join(dir, '歌词归属.flac'), '另一份文件')
await row('07 - 合流.wav', '合流甲', 10)
await row('08 - 合流.flac', '合流乙', 11)
await writeFile(path.join(dir, '07 - 合流.lrc'), '独有歌词')
await row('02 - 冲突.wav', '冲突', 2)
await row('冲突.wav', '另一次演出', 3)
await row('04 - 歌词冲突.wav', '歌词冲突', 4)
await row('同名异录.wav', '夜路', 5)
await writeFile(path.join(dir, '01 - 夜路.lrc'), '[00:00.00]夜路歌词')
await writeFile(path.join(dir, '歌词冲突.lrc'), '不可覆写')
const keep = id['01 - 夜路.wav'],
  list = store.library.createPlaylist('收藏索引')
store.library.setMembership(list, keep, true)
store.db.prepare('UPDATE local_tracks SET favorite=1 WHERE id=?').run(keep)
const original = await readFile(path.join(dir, '01 - 夜路.wav'))
store.db.close()
const launch = () =>
  electron.launch({
    args: [
      path.resolve('dist/component-prototype/host'),
      '--mode=music',
      '--mute-audio',
      '--user-data-dir=' + profile,
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
let app = await launch()
async function settings() {
  const page = await app.firstWindow()
  await page.getByRole('button', { name: '音乐设置', exact: true }).press('Enter')
  const area = page.getByRole('region', { name: '曲库整理' })
  await expect(area).toBeVisible()
  return { page, area }
}
try {
  let { page, area } = await settings()
  const button = (name) => area.getByRole('button', { name })
  await button('按录音内容查重').press('Enter')
  await expect(area.getByRole('radio')).toHaveCount(3, { timeout: 20000 })
  await expect(area.getByRole('radio', { name: /01 - 夜路/ })).toBeChecked()
  await area.screenshot({ path: path.join(root, '重复项.png') })
  await button('仅移除其他索引').press('Enter')
  await expect(area.getByRole('status')).toHaveText('已处理 2 项')
  assert.deepEqual(await readFile(path.join(dir, '同录音.wav')), original)
  assert.equal((await page.evaluate(() => window.music.state())).localTracks.length, 8)
  await button('预览移除文件名曲序号').press('Enter')
  await expect(area.getByRole('checkbox', { name: /目标音频已存在/ })).toBeDisabled()
  await expect(area.getByRole('checkbox', { name: /目标歌词已存在/ })).toBeDisabled()
  await expect(area.getByRole('checkbox', { name: /目标歌词将由其他录音共用/ })).toBeDisabled()
  const collisions = area.getByRole('checkbox', { name: /多首歌曲的目标歌词同名/ })
  await expect(collisions).toHaveCount(2)
  await expect(collisions.first()).toBeDisabled()
  await area.screenshot({ path: path.join(root, '改名预览.png') })
  await button('确认改名 1 项').press('Enter')
  await expect(area.getByRole('status')).toHaveText('已处理 1 项')
  const renamed = path.join(dir, '夜路.wav')
  assert.deepEqual(await readFile(renamed), original)
  assert.equal(await readFile(path.join(dir, '夜路.lrc'), 'utf8'), '[00:00.00]夜路歌词')
  assert.equal(await readFile(path.join(dir, '歌词冲突.lrc'), 'utf8'), '不可覆写')
  for (const f of ['01 - 夜路.wav', '01 - 夜路.lrc'])
    await assert.rejects(stat(path.join(dir, f)), { code: 'ENOENT' })
  const state = await page.evaluate(() => window.music.state())
  assert.equal(state.localTracks.find((t) => t.id === keep).favorite, 1)
  assert.deepEqual(state.playlists.find((p) => p.id === list).tracks, [keep])
  await app.close()
  const again = new MusicStore(path.join(profile, 'fitbay-music'))
  again.library.upsert({
    file: path.join(dir, '同录音.wav'),
    title: '别名',
    artist: '测试',
    album: '',
    duration: 5,
  })
  again.db.close()
  app = await launch()
  ;({ page, area } = await settings())
  await button('按录音内容查重').press('Enter')
  await expect(area.getByRole('radio')).toHaveCount(2, { timeout: 20000 })
  await appendFile(path.join(dir, '同录音.wav'), 'changed')
  await button('仅移除其他索引').press('Enter')
  await expect(area.getByRole('status')).toContainText('预览后文件已变化')
  await writeFile(path.join(dir, '同录音.wav'), original)
  await button('按录音内容查重').press('Enter')
  await expect(area.getByRole('radio')).toHaveCount(2)
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0 })
  })
  await button('将其他文件移至回收站…').press('Enter')
  await expect(area.getByRole('status')).toHaveText('已处理 0 项')
  assert.deepEqual(await readFile(path.join(dir, '同录音.wav')), original)
  await button('按录音内容查重').press('Enter')
  await expect(area.getByRole('radio')).toHaveCount(2)
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async (opts) => {
      globalThis.confirmed = opts.detail
      return { response: 1 }
    }
  })
  await button('将其他文件移至回收站…').press('Enter')
  await expect(area.getByRole('status')).toHaveText('已处理 1 项', { timeout: 15000 })
  assert.equal(
    (await app.evaluate(() => globalThis.confirmed)).trim(),
    path.join(dir, '同录音.wav'),
  )
  await assert.rejects(stat(path.join(dir, '同录音.wav')), { code: 'ENOENT' })
  assert.deepEqual(await readFile(renamed), original)
  await page.getByRole('tab', { name: '曲库', exact: true }).press('Enter')
  await page
    .locator('.library-row')
    .filter({ hasText: '夜路' })
    .filter({ has: page.getByText('夜路', { exact: true }) })
    .first()
    .locator('button[aria-label^=播放]')
    .first()
    .press('Enter')
  await expect
    .poll(() => page.locator('audio').evaluate((a) => !a.paused && a.currentTime > 0.1))
    .toBe(true)
  console.log('PASS', root, { keep, list, renamed })
} finally {
  await app.close()
}
