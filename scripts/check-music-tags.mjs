import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { parseFile } from 'music-metadata'
import { MusicStore } from '../components/music/store.mjs'
import { recording } from '../components/music/offline-source.mjs'
import { register } from '../examples/component-host/plugins/tags.mjs'
import { buildTagsRuntime } from './build-tags-runtime.mjs'
import { _electron as electron, expect } from '@playwright/test'
import { selectMusicSettings } from './music-settings-fixture.mjs'

await mkdir('tmp', { recursive: true })
const dir = await mkdtemp(path.resolve('tmp/music-plugin-tags-'))
const album = path.join(dir, '测试专辑')
await mkdir(album)
const runtime = path.join(dir, 'tags-engine.mjs')
await writeFile(runtime, await buildTagsRuntime())
const sourceImage = await readFile('src/renderer/public/fitbay.png')
await writeFile(path.join(album, 'cover.png'), sourceImage)
const profile = path.join(dir, 'profile')
const store = new MusicStore(path.join(profile, 'fitbay-music'))
const handlers = {}
register(
  (name, handler) => {
    handlers[name] = handler
  },
  () => store,
  {
    moduleURL: pathToFileURL(path.join(dir, 'host.mjs')).href,
    dialog: {
      showOpenDialog: async () => ({ canceled: false, filePaths: [path.join(album, 'cover.png')] }),
    },
  },
)
try {
  const files = new Map()
  for (const ext of ['mp3', 'flac', 'wav', 'm4a']) {
    const file = path.join(album, '测试艺人 - 歌名.' + ext)
    if (ext === 'wav') await writeFile(file, recording('fitbay-tone-1'))
    else await copyFile('tests/fixtures/local-music/tone.' + ext, file)
    const original = await parseFile(file)
    store.library.upsert({
      file,
      title: original.common.title || '无标签',
      artist: original.common.artist || '未知艺人',
      album: original.common.album || '',
      duration: original.format.duration,
    })
    const id = store.db.prepare('SELECT id FROM local_tracks WHERE file=?').get(file).id
    files.set(id, { file, original })
  }
  const ids = [...files.keys()]
  const other = await readFile(files.get(ids[3]).file)
  const snap = await handlers.preview(ids, null, true)
  for (const row of snap.rows) {
    assert.ok(!row.error, row.error)
    assert.equal(row.suggested.title, '歌名')
    assert.equal(row.coverName, 'cover.png')
  }
  const saved = await handlers.apply(
    snap.token,
    ids.slice(0, 3).map((id) => ({ id, values: { title: '歌名', cover: true } })),
  )
  for (const row of saved) assert.ok(row.ok, row.error)
  assert.deepEqual(other, await readFile(files.get(ids[3]).file))
  for (const id of ids.slice(0, 3)) {
    const { file, original } = files.get(id)
    const tags = await parseFile(file)
    assert.equal(tags.common.title, '歌名')
    assert.equal(tags.common.artist, original.common.artist)
    assert.equal(tags.common.album, original.common.album)
    assert.deepEqual(Buffer.from(tags.common.picture[0].data), sourceImage)
    assert.equal(store.library.row(id).title, '歌名')
  }
  const cover = await handlers.chooseCover()
  const second = await handlers.preview([ids[3]], cover.token)
  assert.ok(
    (
      await handlers.apply(second.token, [{ id: ids[3], values: { artist: '艺人', cover: true } }])
    )[0].ok,
  )
  const m4a = await parseFile(files.get(ids[3]).file)
  assert.equal(m4a.common.artist, '艺人')
  assert.equal(m4a.common.title, files.get(ids[3]).original.common.title)
  assert.deepEqual(Buffer.from(m4a.common.picture[0].data), sourceImage)
  const preserving = await handlers.preview([ids[0]])
  assert.ok(
    (await handlers.apply(preserving.token, [{ id: ids[0], values: { album: '新专辑' } }]))[0].ok,
  )
  assert.deepEqual(
    Buffer.from((await parseFile(files.get(ids[0]).file)).common.picture[0].data),
    sourceImage,
  )
  const stale = await handlers.preview([ids[0], ids[1]])
  await writeFile(files.get(ids[0]).file, other)
  const partial = await handlers.apply(stale.token, [
    { id: ids[0], values: { album: '过期' } },
    { id: ids[1], values: { album: '通过' } },
  ])
  assert.match(partial[0].error, /重新预览/)
  assert.equal(partial[1].ok, true)
  assert.deepEqual(await readFile(files.get(ids[0]).file), other)
  if (process.argv.includes('--ui'))
    await copyFile('tests/fixtures/local-music/tone.mp3', files.get(ids[0]).file)
  console.log(
    'PASS 四格式批量预览、同目录与自选封面、仅勾选字段写入、未选文件逐字节一致、已有封面保留、变更文件拒绝。' +
      dir,
  )
} finally {
  store.db.close()
}
if (process.argv.includes('--ui')) {
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
    await page.waitForSelector('.music-shell')
    await expect(page.getByRole('button', { name: '跳过' })).toBeVisible()
    await page.getByRole('button', { name: '跳过' }).click()
    await page.getByRole('tab', { name: '设置', exact: true }).click()
    await selectMusicSettings(page, '插件')
    const item = page.locator('article').filter({ hasText: '歌曲标签与封面整理' })
    await item.getByRole('button', { name: '安装本地包' }).click()
    await item.getByRole('button', { name: '打开', exact: true }).click()
    const panel = page.getByRole('region', { name: '歌曲标签与封面整理' })
    await panel.getByRole('button', { name: '选择筛选结果' }).click()
    await panel.getByRole('checkbox', { name: '查找歌曲同目录的封面图片' }).check()
    await panel.getByRole('button', { name: '预览资料' }).click()
    const group = panel.getByRole('group', { name: '测试艺人 - 歌名.flac', exact: true })
    await expect(group).toBeVisible()
    await expect(group.getByRole('img', { name: '已有封面' })).toBeVisible()
    await expect(
      panel
        .getByRole('group', { name: '测试艺人 - 歌名.mp3' })
        .getByRole('img', { name: 'cover.png' }),
    ).toBeVisible()
    await expect(panel.getByText(/__dirname is not defined/)).toHaveCount(0)
    await group.getByRole('textbox', { name: /建议歌名/ }).fill('界面勾选的新歌名')
    await expect(panel.getByRole('button', { name: '写入所选字段', exact: true })).toBeDisabled()
    await group.getByRole('checkbox', { name: /写入歌名/ }).check()
    await group.scrollIntoViewIfNeeded()
    await page.evaluate(() => {
      delete document.documentElement.dataset.backdrop
    })
    await page.screenshot({ path: path.join(dir, 'tag-preview.png') })
    await panel.getByRole('button', { name: /写入所选字段/ }).click()
    await expect(panel.getByRole('status')).toContainText('已写入 1 首')
    const updated = await parseFile(path.join(album, '测试艺人 - 歌名.flac'))
    assert.equal(updated.common.title, '界面勾选的新歌名')
    assert.equal(updated.common.artist, 'FitBay 测试')
    assert.deepEqual(Buffer.from(updated.common.picture[0].data), sourceImage)
    console.log(
      'PASS 实际安装打开插件、查看原图与建议、编辑未勾选不可写、仅写入一首的一个字段。' + dir,
    )
  } finally {
    await app.close()
  }
}
