import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron, expect } from '@playwright/test'
import { recording } from '../components/music/offline-source.mjs'
import { MusicStore } from '../components/music/store.mjs'
import { previewPlaylist } from '../dist/component-prototype/host/playlist-import.mjs'

const root = await mkdtemp(path.resolve('tmp/music-playlist-import-'))
const profile = path.join(root, 'profile')
const db = new MusicStore(path.join(profile, 'fitbay-music'))
const ids = [],
  files = []
for (const [folder, title, artist] of [
  ['甲', '同名', '甲乐队'],
  ['乙', '同名', '乙乐队'],
  ['乙', '海 岸', '乙乐队'],
  ['甲', '晚风', '甲乐队'],
]) {
  const dir = path.join(root, folder)
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, title + '.wav')
  await writeFile(file, recording('fitbay-tone-1'))
  db.library.upsert({ file, title, artist, album: folder, duration: 20 })
  ids.push(db.library.db.prepare('SELECT id FROM local_tracks WHERE file=?').get(file).id)
  files.push(file)
}
const file = path.join(root, '旧时光.m3u8')
await writeFile(
  file,
  '\ufeff#EXTM3U\r\n乙/同名.wav\r\nZ:/旧盘/海 岸.wav\r\nZ:/以前/同名.wav\r\n#EXTINF:20,晚风\r\n丢失.wav\r\n' +
    files[2] +
    '\r\n',
)
const preview = await previewPlaylist(db.library, file)
assert.deepEqual(
  preview.entries.map((e) => e.id),
  [ids[1], ids[2], null, null, ids[2]],
)
assert.deepEqual(new Set(preview.candidates[preview.entries[2].group]), new Set(ids.slice(0, 2)))
await assert.rejects(previewPlaylist(db.library, files[0]), /M3U/)
const invalid = path.join(root, '坏.m3u')
await writeFile(invalid, Buffer.from([0xff, 0xff]))
await assert.rejects(previewPlaylist(db.library, invalid), /UTF-8/)
const large = path.join(root, '大.m3u')
await writeFile(large, Buffer.alloc(8 * 1024 * 1024 + 1))
await assert.rejects(previewPlaylist(db.library, large), /8 MB/)
const legacy = path.join(root, '原序.m3u')
await writeFile(legacy, ['#EXTM3U', files[3], files[1]].join('\n'))
assert.deepEqual(
  (await previewPlaylist(db.library, legacy)).entries.map((e) => e.id),
  [ids[3], ids[1]],
)
db.set('music-guide-v1', 1)
db.db.close()
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
  await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].setContentSize(1100, 780))
  await page.getByRole('tab', { name: '歌单', exact: true }).click()
  const heading = page.locator('.playlist-heading')
  const importButton = heading.getByRole('button', { name: '导入歌单' })
  const createButton = heading.getByRole('button', { name: '新建歌单' })
  await expect(importButton).toHaveAttribute('title', '导入 M3U / M3U8 歌单')
  await expect(importButton).toHaveText('')
  assert.ok((await importButton.boundingBox()).x < (await createButton.boundingBox()).x)
  await heading.screenshot({
    path: path.join(root, '歌单导航.png'),
    style: ':root{background:var(--base)!important}',
  })
  const chooser = page.waitForEvent('filechooser')
  await importButton.click()
  await (await chooser).setFiles(file)
  await expect(page.getByRole('dialog').getByRole('textbox', { name: '歌单名称' })).toHaveValue(
    '旧时光',
  )
  await page.getByRole('dialog').getByRole('button', { name: '取消' }).click()
  const bounds = await page.locator('.library-layout').boundingBox()
  const cdp = await page.context().newCDPSession(page)
  // Chromium creates File objects backed by real paths, exactly as in an OS file drop.
  for (const type of ['dragEnter', 'dragOver', 'drop'])
    await cdp.send('Input.dispatchDragEvent', {
      type,
      x: bounds.x + 50,
      y: bounds.y + 40,
      data: { items: [], files: [file], dragOperationsMask: 1 },
    })
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('textbox', { name: '歌单名称' })).toHaveValue('旧时光')
  await expect(dialog.getByText(/按原顺序导入 2 首，跳过重复 1 条/)).toBeVisible()
  await dialog.getByRole('combobox').click()
  await page.getByRole('option', { name: /甲乐队/ }).click()
  await dialog.getByRole('textbox', { name: '搜索替代曲目' }).fill('晚风')
  await dialog.getByRole('button', { name: /晚风 · 甲乐队/ }).click()
  await expect(dialog.getByText(/按原顺序导入 4 首/)).toBeVisible()
  await page.screenshot({
    path: path.join(root, '匹配预览.png'),
    style: ':root {background:var(--base)!important}',
    animations: 'disabled',
  })
  await dialog.getByRole('button', { name: '创建歌单' }).click()
  await expect(page.getByRole('heading', { name: '歌单 / 旧时光' })).toBeVisible()
  const members = () =>
    page.evaluate(
      async () => (await window.music.state()).playlists.find((p) => p.name === '旧时光')?.tracks,
    )
  assert.deepEqual(await members(), [ids[1], ids[2], ids[0], ids[3]])
  await page.screenshot({
    path: path.join(root, '原序歌单.png'),
    style: ':root {background:var(--base)!important}',
    animations: 'disabled',
  })
  const exported = path.join(root, '往返.m3u8')
  await app.evaluate(({ dialog }, filename) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename })
  }, exported)
  await page.getByRole('button', { name: '旧时光', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: '导出为 M3U8' }).click()
  await expect.poll(() => readFile(exported, 'utf8').catch(() => '')).toContain(files[2])
  await page.locator('input[type=file]').setInputFiles(exported)
  await expect(dialog.getByText(/按原顺序导入 4 首，跳过重复 0 条/)).toBeVisible()
  await dialog.getByRole('button', { name: '创建歌单' }).click()
  await expect(page.getByRole('heading', { name: '歌单 / 往返' })).toBeVisible()
  assert.deepEqual(
    await page.evaluate(
      async () => (await window.music.state()).playlists.find((p) => p.name === '往返').tracks,
    ),
    await members(),
  )
  console.log('PASS 中文、相对路径、换盘、重名、原序去重、真实文件拖入、导出往返和异常文件', root)
} finally {
  await app.close()
}
