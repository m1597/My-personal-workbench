import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { recording } from '../components/music/offline-source.mjs'

const root = await mkdtemp(path.resolve('tmp/music-library-tools-'))
const first = path.join(root, 'first'),
  second = path.join(root, 'restored'),
  old = path.join(root, 'before'),
  moved = path.join(root, 'after'),
  backup = path.join(root, 'library.json')
const tracks = []
let store = new MusicStore(path.join(first, 'fitbay-music'))
for (const [name, seconds] of [
  ['Live', 2],
  ['Studio', 3],
  ['Offline', 4],
]) {
  const dir = path.join(old, name)
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, name === 'Offline' ? 'missing.wav' : 'twin.wav')
  const bytes = Buffer.from(recording('fitbay-tone-1').subarray(0, 44 + seconds * 32000))
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.writeUInt32LE(bytes.length - 44, 40)
  if (name !== 'Offline') await writeFile(file, bytes)
  store.library.upsert({
    file,
    title: name,
    artist: '测试艺人',
    album: name,
    duration: seconds,
    size: bytes.length,
  })
  tracks.push(store.db.prepare('SELECT id FROM local_tracks WHERE file=?').get(file).id)
}
const list = store.library.createPlaylist('验收歌单')
store.db.exec(
  "CREATE TABLE smart_playlists(id TEXT PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE,source TEXT,days INTEGER,comparison TEXT,plays INTEGER); INSERT INTO smart_playlists VALUES('test-rule','最近推荐','daily',30,'eq',0)",
)
for (const name of ['É', 'é']) {
  store.library.createPlaylist(name)
  store.db
    .prepare('INSERT INTO smart_playlists VALUES(?,?,?,?,?,?)')
    .run(name, name, 'any', null, 'eq', 0)
}
for (const index of [1, 2, 0]) store.library.setMembership(list, tracks[index], true)
store.db.prepare('UPDATE local_tracks SET favorite=1 WHERE id=?').run(tracks[1])
store.set('draft', '轻快')
store.set('taste-profile', '测试偏好')
store.set('taste-consent', '1')
store.set('api-test-secret', 'SECRET_MUST_NOT_EXPORT')
store.db.prepare('INSERT INTO recording_feedback VALUES(?)').run('["recording","wy","1234"]')
const noon = new Date()
noon.setHours(12, 0, 0, 0)
store.library.heard(tracks[2], noon.getTime() - 3 * 86400000)
store.library.heard(tracks[1], noon.getTime() - 86400000)
store.library.heard(tracks[0], Date.now())
store.db.close()
async function launch(profile) {
  const initial = new MusicStore(path.join(profile, 'fitbay-music'))
  initial.set('music-guide-v1', 1)
  initial.db.close()
  const app = await electron.launch({
    args: [
      path.resolve(process.env.FITBAY_TEST_HOST_DIR || 'dist/component-prototype/host'),
      '--mode=music',
      '--mute-audio',
      '--user-data-dir=' + profile,
      '--workbench=' + path.resolve('out/renderer/index.html'),
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
  try {
    const page = await app.firstWindow()
    await page.getByRole('tab', { name: '本地曲库' }).waitFor()
    const skip = page.getByRole('button', { name: '跳过', exact: true })
    if (await skip.isVisible()) await skip.click()
    await page.evaluate(() => delete document.documentElement.dataset.backdrop)
    await app.evaluate(
      ({ BaseWindow, dialog }, { backup, moved }) => {
        BaseWindow.getAllWindows()
          .find((w) => w.getTitle() === 'Music')
          ?.setContentSize(1000, 740)
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: backup })
        dialog.showOpenDialog = async (options) => ({
          canceled: false,
          filePaths: [options.properties.includes('openDirectory') ? moved : backup],
        })
      },
      { backup, moved },
    )
    return { app, page, button: (name) => page.getByRole('button', { name, exact: true }) }
  } catch (e) {
    await app.close()
    throw e
  }
}
let ui = await launch(first)
let exported
try {
  await ui.button('最近播放').click()
  for (const label of ['今天', '昨天', '更早'])
    await expect(ui.page.getByRole('heading', { name: label })).toBeVisible()
  await ui.page.screenshot({ path: path.join(root, 'history.png') })
  await ui.button('曲库管理').click()
  await ui.button('导出备份').click()
  await expect(ui.page.getByRole('status').filter({ hasText: '曲库资料已导出' })).toBeVisible()
  const raw = await readFile(backup, 'utf8')
  assert.ok(!raw.includes('SECRET_MUST_NOT_EXPORT') && !raw.includes('taste-consent'))
  exported = JSON.parse(raw)
  assert.deepEqual(exported.playlists[0].tracks, [tracks[1], tracks[2], tracks[0]])
} finally {
  await ui.app.close()
}
await rename(old, moved)
await mkdir(path.join(old, 'Live'), { recursive: true })
await writeFile(path.join(old, 'Live', 'twin.wav'), recording('fitbay-tone-1'))
await writeFile(path.join(old, 'Live', 'twin.lrc'), '[00:00.00]未授权歌词')
store = new MusicStore(path.join(second, 'fitbay-music'))
store.db
  .prepare('INSERT INTO recommended_items(item,local) VALUES(?,?)')
  .run('old-recommendation', tracks[0])
store.db.close()
ui = await launch(second)
try {
  await ui.button('曲库管理').click()
  await ui.button('选择备份').click()
  await expect(ui.page.getByText(/3 首歌曲 · 6 个歌单 · 1 首收藏 · 3 条播放记录/)).toBeVisible()
  assert.equal((await ui.page.evaluate(() => window.music.state())).localTracks.length, 0)
  await ui.page.screenshot({ path: path.join(root, 'restore-preview.png') })
  await ui.button('确认恢复').click()
  await expect(ui.page.getByText('曲库资料已恢复', { exact: true })).toBeVisible()
  for (const id of [tracks[0], 'old-recommendation'])
    assert.deepEqual(await ui.page.evaluate((id) => window.music.lyrics(id), id), [])
  await assert.rejects(
    ui.page.evaluate((id) => window.music.localSource(id), tracks[0]),
    /不可用/,
  )
  await assert.rejects(
    ui.page.evaluate((id) => window.music.trashLocal(id), tracks[0]),
    /定位/,
  )
  await ui.button('选择新目录').click()
  const live = ui.page.locator('.library-match').filter({ hasText: 'Live · 测试艺人' }),
    studio = ui.page.locator('.library-match').filter({ hasText: 'Studio · 测试艺人' })
  await expect(live.getByRole('combobox')).toHaveText('暂不更新')
  await expect(ui.page.getByText('未找到匹配文件', { exact: true })).toBeVisible()
  for (const [row, name] of [
    [studio, 'Studio'],
    [live, 'Live'],
  ]) {
    await row.getByRole('combobox').click()
    await ui.page.getByRole('option', { name: new RegExp(name + '.*twin.wav') }).click()
  }
  await ui.page.screenshot({ path: path.join(root, 'move-preview.png') })
  await ui.button('确认更新路径').click()
  await expect(ui.page.getByText('已找回 2 首歌曲', { exact: true })).toBeVisible()
  const state = await ui.page.evaluate(() => window.music.state())
  assert.deepEqual(
    state.playlists.filter((p) => !p.system).map((p) => p.name),
    exported.playlists.map((p) => p.name),
  )
  assert.deepEqual(state.playlists.find((p) => p.id === list).tracks, [
    tracks[1],
    tracks[2],
    tracks[0],
  ])
  assert.deepEqual(
    state.localTracks.map((r) => [r.id, r.favorite, r.playCount, r.available]).sort(),
    [
      [tracks[0], 0, 1, 1],
      [tracks[1], 1, 1, 1],
      [tracks[2], 0, 1, 0],
    ].sort(),
  )
  const history = await ui.page.evaluate(() => window.music.recentHistory())
  assert.deepEqual(history.toReversed(), exported.history)
  await ui.button('最近播放').click()
  await ui.page.getByRole('region', { name: '最近播放' }).getByRole('button').first().click()
  await expect
    .poll(() => ui.page.locator('audio').evaluate((a) => !a.paused && a.currentTime > 0.1))
    .toBe(true)
} finally {
  await ui.app.close()
}
store = new MusicStore(path.join(second, 'fitbay-music'))
assert.equal(store.get('taste-consent'), '')
assert.equal(store.get('draft'), '轻快')
assert.deepEqual(
  store.db
    .prepare('SELECT * FROM smart_playlists')
    .all()
    .map((r) => ({ ...r })),
  exported.smartLists,
)
assert.deepEqual([...store.feedbackIds()], exported.preference.feedback)
assert.equal(JSON.parse(store.get('restored-taste-document')).text, '测试偏好')
for (const [i, dir] of [
  [0, 'Live'],
  [1, 'Studio'],
])
  assert.equal(store.library.row(tracks[i]).file, path.join(moved, dir, 'twin.wav'))
store.db.close()
console.log(
  'PASS 最近播放分组、歌单顺序/收藏/记录/偏好恢复、换盘同名版本选择、离线保留及静音重听。',
  root,
)
