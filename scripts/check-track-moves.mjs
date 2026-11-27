import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import {
  mkdir,
  mkdtemp,
  stat,
  readFile,
  rename,
  writeFile,
  copyFile,
  unlink,
} from 'node:fs/promises'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { recording } from '../components/music/offline-source.mjs'
import { volumeIdentity } from '../components/music/local-files.mjs'
import { openDiscovery, openMusicSurface } from './discovery-fixture.mjs'

await mkdir('tmp', { recursive: true })
const root = await mkdtemp(path.resolve('tmp/music-move-'))
const profile = path.join(root, 'profile')
const [a, b, c, outside] = ['A', 'B', 'C', 'outside'].map((dir) => path.join(root, dir))
const disk = await mkdtemp(path.join(os.tmpdir(), 'fitbay-move-disk-'))
const lyrics = '[00:01.00]用户歌词'
for (const dir of [a, b, c, outside]) await mkdir(dir)
const store = new MusicStore(path.join(profile, 'fitbay-music'))
// The independent read-only evidence connection must never block Music's writer.
store.db.exec('PRAGMA journal_mode=WAL')
store.set('music-guide-v1', 1)
const playlist = store.library.createPlaylist('保留原歌单')
const batch = store.saveSuggestions('测试', [], '待处理', undefined, 2)
const ids = []
for (const [i, title] of ['甲', '乙'].entries()) {
  const audio = recording('fitbay-tone-' + (i + 1))
  const file = path.join(a, title + '.wav')
  await writeFile(file, audio)
  await writeFile(path.join(a, title + '.lrc'), lyrics)
  const [row] = await store.library.scanFiles([file])
  store.library.upsert(row)
  const id = store.db.prepare('SELECT id FROM local_tracks WHERE file=?').get(file).id
  ids.push(id)
  store.library.setMembership(playlist, id, true)
  store.saveSuggestions('测试', [{ title, artist: '测试艺人', reason: '测试' }], '待处理', batch)
  const { id: item } = store.db.prepare('SELECT id FROM items WHERE title=?').get(title)
  store.db.prepare("UPDATE items SET status='已入库' WHERE id=?").run(item)
  store.db.prepare('UPDATE recommended_items SET local=? WHERE item=?').run(id, item)
  store.db
    .prepare('INSERT INTO daily_downloads VALUES(?,?,?,?,?)')
    .run(id, batch, file, createHash('sha256').update(audio).digest('hex'), row.identity)
}
for (const dir of [a, b, c, disk]) {
  store.db.prepare('INSERT INTO music_roots VALUES(?)').run(dir)
  store.db.prepare('INSERT INTO watched_music_roots VALUES(?)').run(dir)
  store.db
    .prepare('INSERT INTO watched_music_volumes VALUES(?,?)')
    .run(dir, await volumeIdentity(dir))
}
store.db.prepare('UPDATE local_tracks SET favorite=1 WHERE id=?').run(ids[0])
store.set('play-queue', JSON.stringify(ids))
store.set('latest-daily-run', batch)
store.db.close()
const db = new DatabaseSync(path.join(profile, 'fitbay-music/music.sqlite'), { readOnly: true })
const docked = process.argv.includes('--docked')
const app = await electron.launch({
  args: [
    path.resolve(process.env.FITBAY_MOVE_HOST ?? 'dist/component-prototype/host'),
    '--mode=' + (docked ? 'workbench' : 'music'),
    '--workbench=' + path.resolve('out/renderer/index.html'),
    '--user-data-dir=' + profile,
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  const page = await openMusicSurface(app, docked)
  page.setDefaultTimeout(6500)
  await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].setContentSize(1100, 700))
  const button = (name) => page.getByRole('button', { name, exact: true })
  const status = () => page.evaluate(() => window.music.state())
  const rowFile = (id) => db.prepare('SELECT file FROM local_tracks WHERE id=?').get(id)?.file
  const locate = (dir) =>
    app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ filePaths: [dir], canceled: false })
    }, dir)
  await locate(b)
  await page.getByRole('tab', { name: '曲库', exact: true }).click()
  await button('A').click()
  const song = page.locator('.library-row').filter({ hasText: '甲' })
  await song.click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: '移动到文件夹' })).toBeVisible()
  await page.screenshot({
    path: path.join(root, 'folder-move-menu.png'),
    animations: 'disabled',
    style: ':root{background:var(--base)!important}',
  })
  await page.keyboard.press('Escape')
  await openDiscovery(page, true)
  await page.locator('ol li').filter({ hasText: '甲' }).click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: '移动到文件夹' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('tab', { name: '歌单', exact: true }).click()
  await button('保留原歌单').click()
  await button('多选').click()
  await page.getByRole('checkbox', { name: '全选当前列表' }).check()
  await song.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '移动到文件夹' }).click()
  await expect
    .poll(() => ids.map(rowFile))
    .toEqual(['甲', '乙'].map((t) => path.join(b, t + '.wav')))
  for (const title of ['甲', '乙']) {
    assert.equal(await readFile(path.join(b, title + '.lrc'), 'utf8'), lyrics)
    for (const ext of ['wav', 'lrc'])
      await assert.rejects(stat(path.join(a, title + '.' + ext)), { code: 'ENOENT' })
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM daily_downloads').get().n, 0)
  const endMulti = page.getByRole('button', { name: /退出多选|结束多选|取消多选|完成多选/ })
  if (await endMulti.count()) await endMulti.click()
  else await button('多选').click()
  const play = async (title) => {
    await page.locator('.library-row .library-name strong').filter({ hasText: title }).dblclick()
    await expect
      .poll(() =>
        page
          .locator('audio')
          .evaluate((el) => !el.paused && el.currentTime > 0 && el.readyState >= 2),
      )
      .toBe(true)
    assert.equal((await status()).current, ids[0])
    await button('暂停' + title).click()
  }
  await play('甲')
  console.log('PASS app A→B both files, LRC and original playlist playback', root)
  await rename(path.join(b, '甲.wav'), path.join(c, '改名.wav'))
  await rename(path.join(b, '甲.lrc'), path.join(c, '改名.lrc'))
  await expect.poll(() => rowFile(ids[0]), { timeout: 18000 }).toBe(path.join(c, '改名.wav'))
  const state = await status()
  assert.equal(state.localTracks.length, 2)
  assert.deepEqual(state.playlists.find((p) => p.id === playlist).tracks, ids)
  assert(state.localTracks.find((t) => t.id === ids[0]).favorite)
  assert(state.queue.includes(ids[0]))
  await play('改名')
  console.log('PASS filesystem B→C rename, stable ID/favorite/queue, original playlist playback')
  await rename(path.join(c, '改名.wav'), path.join(outside, '库外新名.wav'))
  await rename(path.join(c, '改名.lrc'), path.join(outside, '库外新名.lrc'))
  await locate(outside)
  const relocation = await page.evaluate(() => window.music.previewRelocation())
  const match = relocation.rows.find((r) => r.id === ids[0])
  assert.deepEqual(
    match.options.map((o) => o.file),
    ['库外新名.wav'],
  )
  await page.evaluate(({ token, choices }) => window.music.applyRelocation(token, choices), {
    token: relocation.token,
    choices: [{ track: ids[0], candidate: match.options[0].id }],
  })
  assert.equal(rowFile(ids[0]), path.join(outside, '库外新名.wav'))
  console.log('PASS selected outside folder once, renamed recording recovered to original ID')
  await openDiscovery(page, true)
  await button('多选').click()
  for (const title of ['库外新名', '乙'])
    await page.getByRole('checkbox', { name: '选择' + title, exact: true }).check()
  const dailyRow = page.locator('ol li').filter({ hasText: '库外新名' })
  await writeFile(path.join(a, '乙.wav'), '占用的用户文件')
  await locate(a)
  await dailyRow.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '移动到文件夹' }).click()
  await expect.poll(() => rowFile(ids[0])).toBe(path.join(a, '库外新名.wav'))
  assert.equal(rowFile(ids[1]), path.join(b, '乙.wav'))
  assert.equal(await readFile(path.join(a, '乙.wav'), 'utf8'), '占用的用户文件')
  await expect(page.getByText(/已移动 1 首，跳过 0 首，失败 1 首/)).toBeVisible()
  console.log(
    'PASS daily multiselect collision preserved both source and unrelated target; independent song moved',
  )
  await expect
    .poll(
      () =>
        db.prepare('SELECT COUNT(*) AS n FROM watched_recording_digests WHERE local=?').get(ids[0])
          .n,
    )
    .toBe(1)
  const newFile = path.join(disk, '跨目录复制后移除.wav')
  await copyFile(rowFile(ids[0]), newFile)
  await unlink(rowFile(ids[0]))
  await expect.poll(() => rowFile(ids[0]), { timeout: 18000 }).toBe(newFile)
  assert.equal((await status()).localTracks.length, 2)
  console.log(
    'PASS copy-delete recording identity recovered',
    path.parse(root).root,
    '→',
    path.parse(disk).root,
  )
} catch (e) {
  console.error((await app.windows().at(-1)?.locator('body').textContent())?.slice(0, 2500))
  throw e
} finally {
  await app.close()
  db.close()
}
