import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'

await mkdir('tmp', { recursive: true })
const evidence = await mkdtemp(path.resolve('tmp/playlist-removal-export-'))
const profile = path.join(evidence, 'profile')
const store = new MusicStore(path.join(profile, 'fitbay-music'))
store.set('music-guide-v1', 1)
const playlist = store.library.createPlaylist('出门 歌单')
const titles = ['山间 小路', '夏日 海岸', '晨光 初现', '新的 歌曲']
const ids = [],
  files = []
const audio = await readFile('tests/fixtures/local-music/tone.mp3')
for (const title of titles) {
  const file = path.join(evidence, title + '.mp3')
  await writeFile(file, audio)
  store.library.upsert({ file, title, artist: '验收', album: '', duration: 1 })
  ids.push(store.db.prepare('SELECT id FROM local_tracks WHERE file=?').get(file).id)
  files.push(file)
}
store.library.setMembership(playlist, ids.slice(0, 3), true)
// The previous batch stays indexed on disk but cannot appear in this batch's export.
for (const indexes of [[3], [0, 1, 2]]) {
  const batch = store.saveSuggestions('验收', [], '待处理', undefined, indexes.length)
  for (const i of indexes) {
    store.saveSuggestions(
      '验收',
      [{ title: titles[i], artist: '验收', reason: '' }],
      '待处理',
      batch,
    )
    const item = store.db
      .prepare('SELECT id FROM items WHERE title=? AND batch=?')
      .get(titles[i], batch).id
    store.status(item, '已入库')
    store.db.prepare('UPDATE recommended_items SET local=? WHERE item=?').run(ids[i], item)
  }
}
// Undo must merge later reorders, additions and re-additions without duplicates.
const receipt = store.library.setMembership(playlist, ids.slice(0, 2), false)
store.library.setMembership(playlist, [ids[3], ids[1]], true)
store.library.movePlaylistTrack(playlist, ids[3], ids[2], false)
store.library.undoMembership(receipt.token)
const members = () => store.library.playlists().find((row) => row.id === playlist).tracks
assert.deepEqual(members(), [ids[3], ids[2], ids[0], ids[1]])
assert.throws(() => store.library.undoMembership(receipt.token))
store.library.setMembership(playlist, ids[3], false)
const initial = members()
store.db.close()
const app = await electron.launch({
  args: [
    path.resolve('dist/component-prototype/host'),
    '--mode=music',
    '--mute-audio',
    '--user-data-dir=' + profile,
    '--workbench=' + path.resolve('out/renderer/index.html'),
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  const page = await app.firstWindow()
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
  })
  await app.evaluate(({ BaseWindow }) =>
    BaseWindow.getAllWindows()
      .find((w) => w.getTitle() === 'Music')
      .setContentSize(1000, 720),
  )
  const button = (name) => page.getByRole('button', { name, exact: true })
  const click = (locator) => locator.dispatchEvent('click')
  await click(page.getByRole('tab', { name: '本地曲库' }))
  const names = page.locator('.library-name strong')
  for (const [name, sequence] of [
    ['出门 歌单', initial],
    ['歌曲推荐', ids.slice(0, 3)],
  ]) {
    await click(button(name))
    const ordered = sequence.map((id) => titles[ids.indexOf(id)])
    await expect(names).toHaveText(ordered)
    await click(button('从曲库移除' + ordered[0]))
    await click(button('仅从当前歌单移除'))
    await expect(names).toHaveText(ordered.slice(1))
    await expect(page.getByRole('status').filter({ hasText: '已从歌单移除 1 首' })).toBeVisible()
    await click(button('撤销'))
    await expect(names).toHaveText(ordered)
    await click(button('多选'))
    for (const title of [ordered[0], ordered[2]])
      await page.getByRole('checkbox', { name: '选择' + title }).evaluate((input) => input.click())
    await click(button('从当前歌单移除'))
    await expect(names).toHaveText([ordered[1]])
    await expect(page.getByRole('status').filter({ hasText: '已从歌单移除 2 首' })).toBeVisible()
    await page.screenshot({ path: path.join(evidence, name + '-撤销.png') })
    await click(button('撤销'))
    await expect(names).toHaveText(ordered)
  }
  await click(button('出门 歌单'))
  await click(button('歌单排序'))
  await click(page.getByRole('menuitemradio', { name: '歌名', exact: true }))
  await click(button('歌单排序'))
  await click(page.getByRole('menuitemradio', { name: '降序', exact: true }))
  await expect(names).not.toHaveText(initial.map((id) => titles[ids.indexOf(id)]))
  const output = path.join(evidence, '出门 歌单.m3u8')
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async (options) => {
      if (options.defaultPath !== '出门 歌单.m3u8') throw Error('默认文件名错误')
      return { filePath, canceled: false }
    }
  }, output)
  await button('出门 歌单').dispatchEvent('contextmenu', { button: 2, clientX: 130, clientY: 250 })
  await page.getByRole('menuitem', { name: '导出为 M3U8' }).waitFor()
  await page.screenshot({ path: path.join(evidence, '导出菜单.png'), animations: 'disabled' })
  await click(page.getByRole('menuitem', { name: '导出为 M3U8' }))
  await expect
    .poll(() => readFile(output, 'utf8').catch(() => ''))
    .toBe(['#EXTM3U', ...initial.map((id) => files[ids.indexOf(id)]), ''].join('\r\n'))
  for (const file of files) assert.equal((await stat(file)).size, audio.length)
  const systemOutput = path.join(evidence, '歌曲推荐.m3u8')
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, systemOutput)
  await button('歌曲推荐').dispatchEvent('contextmenu', { button: 2, clientX: 130, clientY: 180 })
  await expect(page.getByRole('menuitem', { name: '删除歌单' })).toHaveCount(0)
  await click(page.getByRole('menuitem', { name: '导出为 M3U8' }))
  await expect
    .poll(() => readFile(systemOutput, 'utf8').catch(() => ''))
    .toBe(['#EXTM3U', ...files.slice(0, 3), ''].join('\r\n'))
  await unlink(files[0])
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => {
      throw Error('取消后不应继续保存')
    }
    dialog.showMessageBox = async (opts) => {
      if (opts.message !== '缺失或不可用 1 首，将导出 2 首。') throw Error('缺失数量错误')
      return { response: 0 }
    }
  })
  assert.equal(await page.evaluate((id) => window.music.exportPlaylist(id), playlist), false)
  await writeFile(files[0], audio)
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true })
  })
  assert.equal(await page.evaluate((id) => window.music.exportPlaylist(id), playlist), false)
  await assert.rejects(page.evaluate(() => window.music.exportPlaylist('unknown-list')))
  await assert.rejects(page.evaluate(() => window.music.undoMembership({})))
} finally {
  await app.close()
}
console.log('单首/批量撤销、自定义/系统歌单、并发编辑与按手排导出通过', evidence)
