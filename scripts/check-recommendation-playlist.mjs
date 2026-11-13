import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron, expect } from '@playwright/test'
import { recording } from '../components/music/offline-source.mjs'
import { MusicStore } from '../components/music/store.mjs'

const root = await mkdtemp(path.resolve('tmp/recommendation-playlist-'))
const profile = path.join(root, 'profile')
const audio = path.join(root, 'audio')
await mkdir(audio)
const absentDrive = [...'ZYXWVUTSRQPONMLKJIHGFED']
  .map((letter) => `${letter}:/`)
  .find((drive) => !existsSync(drive))
assert.ok(absentDrive, '需要一个未挂载的 Windows 盘符模拟断盘')
const wave = recording('fitbay-tone-1')
const titles = ['手动移出', '未定位移出', '外部删除', '暂时断盘', '等待定位', '继续保留']
const customName = '通勤收藏'
const output = { root }
const store = new MusicStore(path.join(profile, 'fitbay-music'))
// Upgrade a mixed library in which the old view exposed ten historical references
// next to the five recordings downloaded by the latest generation.
async function checkBatchUpgrade() {
  const upgradeProfile = path.join(root, 'upgrade')
  const legacyRoot = path.join(upgradeProfile, 'fitbay-music')
  const folder = path.join(legacyRoot, '歌曲推荐')
  await mkdir(folder, { recursive: true })
  let db = new MusicStore(legacyRoot)
  const currentIds = []
  const files = []
  try {
    db.set('music-guide-v1', 1)
    db.set('music-muted', 'on')
    db.set('music-media-keys', 'off')
    const legacyBatch = db.saveSuggestions('早期普通批次', [], '待处理')
    const historicFile = path.join(folder, '升级验收0.wav')
    db.library.upsert({
      file: historicFile,
      title: '升级验收0',
      artist: '验收',
      album: '',
      duration: 20,
    })
    const historicId = db.db
      .prepare('SELECT id FROM local_tracks WHERE file=?')
      .get(historicFile).id
    db.db.prepare('INSERT INTO restored_recommendations VALUES(?)').run(historicId)
    assert.deepEqual(
      db.snapshot().items.filter((i) => i.batch === legacyBatch),
      [],
    )
    assert.deepEqual(db.library.playlists().find((p) => p.system)?.tracks ?? [], [])
    const current = db.saveSuggestions('本轮', [], '待处理', undefined, 5)
    for (let n = 0; n < 15; n++) {
      const title = `升级验收${n}`
      const file = path.join(folder, `${title}.wav`)
      files.push(file)
      await writeFile(file, wave)
      db.library.upsert({ file, title, artist: '验收', album: '', duration: 20 })
      const { id } = db.db.prepare('SELECT id FROM local_tracks WHERE file=?').get(file)
      if (n < 5) db.db.prepare('INSERT OR IGNORE INTO restored_recommendations VALUES(?)').run(id)
      else {
        db.saveSuggestions('本轮', [{ title, artist: '验收', reason: '' }], '待处理', current)
        const item = db.db.prepare('SELECT id FROM items WHERE title=?').get(title).id
        db.status(item, '已入库')
        db.db.prepare('UPDATE recommended_items SET local=? WHERE item=?').run(id, item)
        if (n < 10) db.db.prepare('UPDATE items SET batch=NULL WHERE id=?').run(item)
        else {
          currentIds.push(id)
          db.db
            .prepare('INSERT INTO daily_downloads VALUES(?,?,?,?,?)')
            .run(id, current, file, '', null)
        }
      }
    }
    // Persist the legacy view to exercise an in-place upgrade on the next open.
    db.db.exec(`DROP VIEW recommendation_playlist_members;
      CREATE VIEW recommendation_playlist_members AS
      SELECT local AS track,0 AS source,rowid AS position FROM recommended_items WHERE local IS NOT NULL
      UNION ALL SELECT track,1,rowid FROM restored_recommendations`)
    assert.equal(
      db.db.prepare('SELECT COUNT(*) AS n FROM recommendation_playlist_members').get().n,
      15,
    )
    db.db.close()
    db = new MusicStore(legacyRoot)
    const verify = (expected) => {
      const state = db.snapshot()
      assert.deepEqual(
        state.items.filter((i) => i.batch === state.batches[0].id).map((i) => i.localId),
        expected,
      )
      assert.deepEqual(state.playlists.find((p) => p.system)?.tracks, expected)
      assert.equal(state.localTracks.filter((t) => t.folder.name === '歌曲推荐').length, 15)
    }
    verify(currentIds)
    db.db.close()
    try {
      await launch(upgradeProfile, false)
      await page.getByRole('tab', { name: '每日推荐' }).click()
      const currentTitles = files.slice(10).map((file) => path.basename(file, '.wav'))
      await expect(page.locator('.music-track strong')).toHaveText(currentTitles)
      await page.getByRole('tab', { name: '本地曲库' }).click()
      const folderButton = page.locator('button[title="歌曲推荐"]')
      await folderButton.click()
      await expect(rows()).toHaveCount(15)
      await button('歌曲推荐').and(page.locator('button:not([title="歌曲推荐"])')).click()
      await expect
        .poll(async () => (await rows().allTextContents()).sort())
        .toEqual(currentTitles.sort())
    } finally {
      await app?.close()
      app = undefined
      db = new MusicStore(legacyRoot)
    }
    for (const result of ['blocked', 'cancelled']) {
      db.expireRecommendations(undefined, true)
      const next = db.saveSuggestions(result, [], '待处理', undefined, 5)
      db.db.prepare('UPDATE recommendation_runs SET state=? WHERE batch=?').run(result, next)
      verify([])
    }
    for (const file of files) assert.deepEqual(await readFile(file), wave)
    console.log(
      'PASS 升级前 15 个推荐成员，升级后与今日页同为 5 首；空轮与终止均为 0，同名目录保留 15 个原文件。',
    )
  } finally {
    db.db.close()
  }
}
const paths = titles.map((title, index) =>
  path.join(index === 3 ? absentDrive : audio, `${title}.wav`),
)
try {
  store.set('music-guide-v1', 1)
  store.set('music-media-keys', 'off')
  store.set('music-muted', 'on')
  const custom = store.library.createPlaylist(customName)
  const suggestions = titles.map((title) => ({
    title,
    artist: '验收音乐人',
    reason: '系统歌单验收',
  }))
  const batch = store.saveSuggestions('专项验收', suggestions, '待处理', undefined, titles.length)
  for (const [i, row] of suggestions.entries()) {
    if ([0, 2, 5].includes(i)) await writeFile(paths[i], wave)
    store.library.upsert({ ...row, file: paths[i], album: '验收', duration: 20 })
    const { id } = store.db.prepare('SELECT id FROM local_tracks WHERE file=?').get(paths[i])
    if ([1, 3, 4].includes(i))
      store.db
        .prepare('UPDATE local_tracks SET available=0,awaitingLocation=? WHERE id=?')
        .run(Number(i !== 3), id)
    store.library.setMembership(custom, id, true)
    const item = store.db
      .prepare('SELECT id FROM items WHERE title=? AND batch=?')
      .get(row.title, batch)
    store.db.prepare('UPDATE recommended_items SET local=? WHERE item=?').run(id, item.id)
    store.status(item.id, '已入库')
    if ([0, 2, 4].includes(i))
      store.db.prepare('INSERT INTO restored_recommendations VALUES(?)').run(id)
  }
} finally {
  store.db.close()
}

let app
let page
const button = (name) => page.getByRole('button', { name, exact: true })
const rows = () => page.locator('.library-name strong')
const screenshot = (name) =>
  page.screenshot({
    path: path.join(root, `${name}.png`),
    style: ':root { background: var(--base) !important }',
  })
async function launch(userData = profile, openPlaylist = true) {
  app = await electron.launch({
    args: [
      path.resolve('dist/component-prototype/host'),
      '--mode=music',
      '--mute-audio',
      `--workbench=${path.resolve('out/renderer/index.html')}`,
      `--user-data-dir=${userData}`,
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
  page = await app.firstWindow()
  await app.evaluate(({ BaseWindow }) => {
    BaseWindow.getAllWindows()
      .find((w) => w.getTitle() === 'Music')
      .setContentSize(1080, 760)
  })
  await page.waitForSelector('.music-shell')
  assert.ok(
    await app.evaluate(({ app, BaseWindow, screen }) => {
      const left = Math.min(...screen.getAllDisplays().map((d) => d.bounds.x))
      return (
        app.commandLine.hasSwitch('mute-audio') &&
        BaseWindow.getAllWindows().every((w) => {
          const { x, width } = w.getBounds()
          return !w.isFocusable() && x + width <= left
        })
      )
    }),
  )
  if (openPlaylist) {
    await page.getByRole('tab', { name: '本地曲库' }).click()
    await button('歌曲推荐').click()
  }
}
async function checkMembers(expected) {
  await expect
    .poll(async () => (await rows().allTextContents()).sort())
    .toEqual([...expected].sort())
  const snapshot = await page.evaluate(() => window.music.state())
  const members = (name) => new Set(snapshot.playlists.find((p) => p.name === name)?.tracks)
  const system = members('歌曲推荐')
  const custom = members(customName)
  assert.deepEqual(
    snapshot.localTracks
      .filter((t) => system.has(t.id))
      .map((t) => t.title)
      .sort(),
    [...expected].sort(),
  )
  assert.deepEqual(
    snapshot.localTracks
      .filter((t) => custom.has(t.id))
      .map((t) => t.title)
      .sort(),
    [...titles].sort(),
  )
  assert.equal(snapshot.localTracks.length, titles.length)
  assert.ok(snapshot.localTracks.every((t) => !t.notInterested))
  const read = new DatabaseSync(path.join(profile, 'fitbay-music/music.sqlite'), { readOnly: true })
  try {
    for (const table of ['recording_feedback', 'dismissed_items'])
      assert.equal(read.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0)
    assert.equal(read.prepare('SELECT COUNT(*) AS n FROM recommended_songs').get().n, titles.length)
  } finally {
    read.close()
  }
  return {
    system: system.size,
    custom: custom.size,
    library: snapshot.localTracks.length,
    negativeFeedback: 0,
  }
}
try {
  await checkBatchUpgrade()
  await launch()
  output.before = await checkMembers(titles)
  await button('多选').click()
  await page.getByRole('checkbox', { name: '全选当前列表' }).check()
  await expect(page.getByText('已选 6 首')).toBeVisible()
  await page.getByRole('checkbox', { name: '全选当前列表' }).uncheck()
  for (const title of titles.slice(0, 2))
    await page.getByRole('checkbox', { name: `选择${title}` }).check()
  await screenshot('批量移出可用与不可用歌曲')
  await button('从当前歌单移除').click()
  output.afterRemoval = await checkMembers(titles.slice(2))
  assert.ok((await readFile(paths[0])).equals(wave))
  await button('全部歌曲').click()
  assert.deepEqual((await rows().allTextContents()).sort(), [...titles].sort())
  await button(customName).click()
  assert.deepEqual((await rows().allTextContents()).sort(), [...titles].sort())
  await unlink(paths[2])
  await button('歌曲推荐').click()
  output.afterDeletion = await checkMembers(titles.slice(3))
  await screenshot('自动清理后保留断盘与未定位歌曲')
  await app.close()
  app = undefined
  await launch()
  output.afterRestart = await checkMembers(titles.slice(3))
  assert.ok((await readFile(paths[0])).equals(wave) && (await readFile(paths[5])).equals(wave))
  assert.ok(!existsSync(paths[2]))
  output.passed = true
  console.log('PASS', JSON.stringify(output))
} finally {
  await app?.close()
  await writeFile(path.join(root, '验收.json'), JSON.stringify(output, null, 2))
  console.log('验收目录', root)
}
