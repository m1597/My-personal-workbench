import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  writeFile,
  copyFile,
  rename,
  readFile,
  symlink,
  stat,
} from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { once } from 'node:events'
import { MusicStore } from '../components/music/store.mjs'
import path from 'node:path'
import { _electron as electron, expect } from '@playwright/test'
import { recording } from '../components/music/offline-source.mjs'

await mkdir('tmp', { recursive: true })
const root = await mkdtemp(path.resolve('tmp/local-music-')),
  profile = path.join(root, 'profile'),
  songs = path.join(root, 'songs'),
  nested = path.join(songs, 'nested')
const owned = path.join(root, 'owned'),
  dbdir = path.join(profile, 'fitbay-music')
for (const dir of [nested, owned, dbdir]) await mkdir(dir, { recursive: true })
const wav = recording('fitbay-tone-1')
await writeFile(path.join(owned, 'saved.wav'), wav)
const db = new DatabaseSync(path.join(dbdir, 'music.sqlite'))
db.exec(
  'CREATE TABLE library(track TEXT PRIMARY KEY,file TEXT,digest TEXT,album TEXT,version TEXT);CREATE TABLE state(key TEXT PRIMARY KEY,value TEXT NOT NULL)',
)
db.prepare('INSERT INTO library VALUES(?,?,?,?,?)').run(
  'fitbay-tone-1',
  'saved.wav',
  'fixture',
  '声景习作',
  '原版',
)
db.prepare('INSERT INTO state VALUES(?,?)').run('root', owned)
db.close()
const long = Buffer.concat([wav, ...Array(9).fill(wav.subarray(44))])
long.writeUInt32LE(long.length - 8, 4)
long.writeUInt32LE(long.length - 44, 40)
const longFile = path.join(songs, '长音.wav')
await writeFile(longFile, long)
for (const ext of ['mp3', 'flac', 'm4a'])
  await copyFile('tests/fixtures/local-music/tone.' + ext, path.join(nested, 'tone.' + ext))
await symlink(owned, path.join(nested, 'skip-link'), 'junction')
await writeFile(path.join(nested, 'bad.mp3'), 'bad')
// Cancel on the first committed worker batch and reopen that database independently.
const partial = new MusicStore(path.join(root, 'partial-index'))
const partialFiles = Array.from({ length: 40 }, (_, i) => path.join(owned, 'part-' + i + '.mp3'))
for (const file of partialFiles) await copyFile('tests/fixtures/local-music/tone.mp3', file)
partial.library.start(partialFiles, false)
const worker = partial.library.worker
const finished = once(worker, 'exit')
worker.once('message', () => partial.library.cancel())
await finished
const count = partial.library.list().length
assert.ok(partial.library.job.cancelled && count > 0 && count < partialFiles.length)
partial.db.close()
const resumed = new MusicStore(path.join(root, 'partial-index'))
assert.equal(resumed.library.list().length, count)
resumed.db.close()
const host = path.resolve('dist/component-prototype/host')
const launch = () =>
  electron.launch({
    args: [
      host,
      '--mode=music',
      '--user-data-dir=' + profile,
      '--workbench=' + path.resolve('out/renderer/index.html'),
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
const choose = (app, paths) =>
  app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths })
  }, paths)
async function waitJobs(page) {
  await expect
    .poll(() => page.evaluate(async () => (await window.music.state()).importJob.running))
    .toBe(false)
}
const duplicate = path.join(songs, 'other.mp3')
let app = await launch()
try {
  const page = await app.firstWindow()
  await expect(page.getByRole('tab', { name: '本地曲库' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('button', { name: '播放潮汐', exact: true })).toBeVisible()
  await choose(app, [songs])
  await page.getByRole('button', { name: '添加文件夹' }).click()
  await expect(page.getByText(/导入完成 · 新增 4 · 重复 0 · 失败 1/)).toBeVisible()
  await choose(app, [songs])
  await page.getByRole('button', { name: '添加文件夹' }).click()
  await expect(page.getByText(/导入完成 · 新增 0 · 重复 4 · 失败 1/)).toBeVisible()

  await copyFile(path.join(nested, 'tone.mp3'), duplicate)
  await choose(app, [duplicate, longFile])
  await page.getByRole('button', { name: '添加文件', exact: true }).click()
  await expect(page.getByText(/导入完成 · 新增 1 · 重复 1/)).toBeVisible()
  await expect(page.getByRole('button', { name: '播放试音 mp3', exact: true })).toHaveCount(2)
  await page.getByRole('searchbox').fill('声学校验')
  await expect(page.locator('.library-row')).toHaveCount(4)
  await page.getByRole('searchbox').fill('FitBay 测试')
  await expect(page.locator('.library-row')).toHaveCount(4)
  for (const ext of ['mp3', 'flac', 'm4a']) {
    await page
      .getByRole('button', { name: '播放试音 ' + ext, exact: true })
      .first()
      .click()
    await expect
      .poll(() =>
        page.locator('audio').evaluate((a) => !a.paused && a.currentTime > 0 && a.duration >= 3.9),
      )
      .toBe(true)
  }
  // Keep the filtered queue while browsing another page, then advance on natural end.
  await page.getByRole('button', { name: '播放试音 flac', exact: true }).click()
  const filtered = (await page.evaluate(() => window.music.state())).queue
  await page.getByRole('searchbox').fill('不存在')
  await page.getByRole('tab', { name: '推荐试听' }).click()
  await expect(page.getByRole('button', { name: '停止播放' })).toBeEnabled()
  await page.locator('audio').evaluate((a) => {
    a.currentTime = a.duration - 0.2
  })
  await expect
    .poll(() => page.evaluate(async () => (await window.music.state()).current), { timeout: 9000 })
    .toBe(filtered[1])
  const prev = page.getByRole('button', { name: '上一首', exact: true })
  const next = page.getByRole('button', { name: '下一首', exact: true })
  const shuffle = page.getByRole('button', { name: '随机播放', exact: true })
  const currentId = () => page.evaluate(async () => (await window.music.state()).current)
  await prev.click()
  await expect.poll(currentId).toBe(filtered[0])
  await expect(prev).toBeDisabled()
  await shuffle.click()
  await expect(shuffle).toHaveAttribute('aria-pressed', 'true')
  assert.equal(await currentId(), filtered[0])
  const heard = [filtered[0]]
  for (let i = 1; i < filtered.length; i++) {
    if (i === 1) {
      await expect
        .poll(() => page.locator('audio').evaluate((a) => !a.paused && Number.isFinite(a.duration)))
        .toBe(true)
      await page.locator('audio').evaluate((a) => {
        a.currentTime = a.duration - 0.15
      })
    } else await next.click()
    await expect.poll(currentId).not.toBe(heard.at(-1))
    heard.push(await currentId())
  }
  assert.deepEqual([...heard].sort(), [...filtered].sort())
  await expect(next).toBeDisabled()
  await prev.click()
  await expect.poll(currentId).toBe(heard.at(-2))
  await next.click()
  await expect.poll(currentId).toBe(heard.at(-1))
  await shuffle.click()
  await expect(shuffle).toHaveAttribute('aria-pressed', 'false')
  await prev.click()
  await expect.poll(currentId).toBe(filtered[filtered.indexOf(heard.at(-1)) - 1])
  await page.getByRole('tab', { name: '本地曲库' }).click()
  await page.getByRole('searchbox').fill('')
  await page.getByRole('button', { name: '播放长音', exact: true }).click()
  await expect.poll(() => page.locator('audio').evaluate((a) => a.duration)).toBe(200)
  await page.locator('audio').evaluate((a) => {
    a.currentTime = 150
  })
  await expect
    .poll(() => page.evaluate(async () => (await window.music.state()).position))
    .toBeGreaterThanOrEqual(150)
  const before = await page.evaluate(async () => ({
    src: document.querySelector('audio').currentSrc,
    q: (await window.music.state()).queue,
  }))
  await page.getByRole('searchbox').fill('没有结果')
  await page.getByRole('tab', { name: '推荐试听' }).click()
  await page.getByRole('button', { name: '加入工作台' }).click()
  await page.getByRole('button', { name: '分离窗口' }).click()
  assert.deepEqual(
    await page.evaluate(async () => ({
      src: document.querySelector('audio').currentSrc,
      q: (await window.music.state()).queue,
    })),
    before,
  )
  await expect.poll(() => page.locator('audio').evaluate((a) => a.currentTime)).toBeGreaterThan(150)
} finally {
  await app.close()
}
app = await launch()
try {
  const page = await app.firstWindow()
  await expect(page.getByRole('button', { name: /从 1\d\d 秒继续/ })).toBeVisible()
  assert.ok(await page.locator('audio').evaluate((a) => a.paused))
  await page.getByRole('button', { name: /从 .* 秒继续/ }).click()
  await expect
    .poll(() => page.locator('audio').evaluate((a) => a.currentTime))
    .toBeGreaterThanOrEqual(150)
  await page.getByRole('button', { name: '停止播放' }).click()
  const relocated = path.join(root, '迁移.wav')
  await rename(longFile, relocated)
  await page.getByRole('tab', { name: '推荐试听' }).click()
  await page.getByRole('tab', { name: '本地曲库' }).click()
  await expect(page.getByText('文件不可用', { exact: true })).toBeVisible()
  await choose(app, [relocated])
  await page.getByRole('button', { name: '重新定位长音' }).click()
  await expect(page.getByRole('button', { name: '播放迁移' })).toBeEnabled()
  await page.evaluate(() => {
    document.querySelector('.music-scroll').scrollTop = 0
    delete document.documentElement.dataset.backdrop
  })
  await page.screenshot({ path: path.join(root, 'library.png') })
  await app.evaluate(({ BaseWindow }) =>
    BaseWindow.getAllWindows()
      .find((w) => w.isVisible())
      .setSize(400, 480),
  )
  await page.screenshot({ path: path.join(root, 'small.png') })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.getByRole('button', { name: '从曲库移除迁移' }).click()
  await expect(page.getByRole('button', { name: '播放迁移' })).toHaveCount(0)
  assert.deepEqual(await readFile(relocated), long)
  await choose(app, [songs])
  await page.evaluate(async () => {
    await window.music.importLocal('folder')
    await window.music.cancelImport()
  })
  await waitJobs(page)
  assert.ok(await page.evaluate(async () => (await window.music.state()).importJob.cancelled))
  const namesake = path.join(nested, '迁移.wav')
  await writeFile(namesake, wav)
  await choose(app, [relocated, namesake])
  await page.getByRole('button', { name: '添加文件', exact: true }).click()
  await expect(page.getByRole('button', { name: '播放迁移', exact: true })).toHaveCount(2)
  const recordings = await page.evaluate(async () =>
    (await window.music.state()).localTracks
      .filter((t) => t.title === '迁移')
      .map((t) => t.duration),
  )
  assert.deepEqual(
    recordings.sort((a, b) => a - b),
    [20, 200],
  )
  // A replaced or damaged local file stays in the library and can be relocated.
  await writeFile(duplicate, Buffer.alloc(0))
  await page.getByRole('tab', { name: '推荐试听' }).click()
  await page.getByRole('tab', { name: '本地曲库' }).click()
  await expect(page.getByRole('button', { name: '重新定位试音 mp3' })).toBeVisible()
  await page.getByRole('button', { name: '从曲库移除潮汐' }).click()
  assert.ok((await stat(path.join(owned, 'saved.wav'))).isFile())
  console.log(
    'PASS 本地曲库四格式、原地导入、重复与取消、迁移重定位、长音频跳转、显示形态和重启。截图 ' +
      root,
  )
} finally {
  await app.close()
}

app = await launch()
try {
  const page = await app.firstWindow()
  await expect(page.getByRole('tab', { name: '本地曲库' })).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await window.music.state()).localTracks.some((t) => t.title === '潮汐'),
      ),
    )
    .toBe(false)
} finally {
  await app.close()
}
