import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, stat, writeFile } from 'node:fs/promises'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { recording } from '../components/music/offline-source.mjs'

const evidence = await mkdtemp(path.resolve('tmp/music-infrequent-'))
const profile = path.join(evidence, 'profile')
const data = path.join(profile, 'fitbay-music')
const wave = recording('fitbay-tone-1')
const day = 86400000
const files = new Map()
let store = new MusicStore(data)
for (const [title, seconds] of [
  ['旧录音', 2],
  ['长录音', 36],
  ['整月', 3],
  ['半年', 4],
  ['新歌', 2],
]) {
  const file = path.join(evidence, title + '.wav')
  const size = seconds * 32000
  const bytes = Buffer.alloc(size + 44)
  wave.copy(bytes, 0, 0, Math.min(wave.length, bytes.length))
  bytes.writeUInt32LE(size + 36, 4)
  bytes.writeUInt32LE(size, 40)
  await writeFile(file, bytes)
  files.set(title, file)
  store.library.upsert({ file, title, artist: '验收', album: '', duration: seconds })
}
// Upgrade fixture: columns absent on installations predating listening history.
store.db.exec(
  'ALTER TABLE local_tracks DROP COLUMN observedAt; ALTER TABLE local_tracks DROP COLUMN lastHeardAt; ALTER TABLE local_tracks DROP COLUMN size',
)
store.db.close()
const start = Date.now()
store = new MusicStore(data)
assert.ok(store.library.list().every((r) => r.observedAt >= start && r.lastHeardAt === null))
for (const [title, days] of [
  ['旧录音', 100],
  ['长录音', 91],
  ['整月', 30],
  ['半年', 180],
]) {
  store.db
    .prepare('UPDATE local_tracks SET observedAt=? WHERE title=?')
    .run(Date.now() - days * day, title)
}
store.db.prepare("UPDATE local_tracks SET lastHeardAt=observedAt WHERE title='半年'").run()
store.db.close()
const app = await electron.launch({
  args: [
    path.resolve('dist/component-prototype/host'),
    '--mode=music',
    '--user-data-dir=' + profile,
    '--workbench=' + path.resolve('out/renderer/index.html'),
    '--mute-audio',
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  const page = await app.firstWindow()
  await page.getByRole('button', { name: '跳过', exact: true }).click()
  await app.evaluate(({ BaseWindow }) =>
    BaseWindow.getAllWindows()
      .find((w) => w.getTitle() === 'Music')
      .setContentSize(960, 640),
  )
  const button = (name) => page.getByRole('button', { name, exact: true })
  const rows = page.locator('.infrequent-row')
  await button('不常听').click()
  await expect(rows.locator('strong')).toHaveText(['半年', '旧录音', '长录音'])
  const select = async (name, value) => {
    await page.getByRole('combobox', { name, exact: true }).click()
    await page.getByRole('option', { name: value, exact: true }).click()
  }
  await select('未收听时间', '180 天')
  await expect(rows.locator('strong')).toHaveText(['半年'])
  await select('未收听时间', '30 天')
  await expect(rows).toHaveCount(4)
  await expect(page.getByRole('combobox', { name: '不常听排序' })).toHaveCount(0)
  await expect(rows.locator('strong')).toHaveText(['半年', '旧录音', '长录音', '整月'])
  for (const name of ['半年', '整月'])
    await page.getByRole('checkbox', { name: '选择' + name }).check()
  await expect(page.getByText('已选 2 首 · 218.8 KiB', { exact: true })).toBeVisible()
  await page.evaluate(() => delete document.documentElement.dataset.backdrop)
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(32, 34, 39)')
  await page.screenshot({ path: path.join(evidence, 'infrequent.png') })
  await page.getByRole('combobox', { name: '未收听时间' }).click()
  await page.screenshot({ path: path.join(evidence, 'threshold-menu.png') })
  await page.keyboard.press('Escape')
  await button('移至回收站').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.screenshot({ path: path.join(evidence, 'confirm-trash.png'), animations: 'disabled' })
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0 })
  })
  await button('确认继续').click()
  await expect(rows).toHaveCount(4)
  await expect(page.getByRole('status').filter({ hasText: '已处理 0 / 2 首' })).toBeVisible()
  await button('仅移除索引').click()
  await button('确认继续').click()
  await expect(rows).toHaveCount(2)
  for (const name of ['半年', '整月']) await stat(files.get(name))
  const heard = (name) =>
    page.evaluate(
      async (name) =>
        (await window.music.state()).localTracks.find((t) => t.title === name).lastHeardAt,
      name,
    )
  await button('试听长录音').click()
  await page.locator('audio').evaluate((el) => {
    el.currentTime = 35.5
  })
  await expect
    .poll(() => page.locator('audio').evaluate((el) => el.ended || el.currentTime < 3))
    .toBe(true)
  assert.equal(await heard('长录音'), null)
  // Reset the queue to one song so automatic advancement cannot qualify another.
  await button('全部歌曲').click()
  await page.getByRole('searchbox').fill('旧录音')
  await page
    .locator('.library-row')
    .first()
    .dblclick({ position: { x: 120, y: 15 } })
  await expect.poll(() => heard('旧录音')).not.toBeNull()
  const firstListen = await heard('旧录音')
  const audio = page.locator('audio')
  await expect.poll(() => audio.evaluate((el) => el.ended)).toBe(true)
  await audio.evaluate(async (el) => {
    await el.play()
    el.currentTime = el.duration - 0.25
  })
  await expect.poll(() => audio.evaluate((el) => el.ended)).toBe(true)
  assert.equal(await heard('旧录音'), firstListen, '短歌重播跳尾不得复用上一遍的播放区间')
  await page.getByRole('searchbox').fill('长录音')
  await page
    .locator('.library-row')
    .first()
    .dblclick({ position: { x: 120, y: 15 } })
  await audio.evaluate((el) => {
    el.currentTime = 0
    return el.play()
  })
  await expect
    .poll(() => audio.evaluate((el) => el.currentTime), { timeout: 9000 })
    .toBeGreaterThan(2)
  await audio.evaluate((el) => el.pause())
  assert.equal(await heard('长录音'), null)
  await audio.evaluate((el) => el.play())
  await expect.poll(() => heard('长录音'), { timeout: 40000, intervals: [500] }).not.toBeNull()
  await button('不常听').click()
  await expect(rows).toHaveCount(0)
  console.log(
    'PASS 旧库观察起点，三档时间筛选与最久未听优先，多选容量、回收取消、仅移除索引、短歌完整播完和累计播放 30 秒。截图 ' +
      evidence,
  )
} finally {
  await app.close()
}
