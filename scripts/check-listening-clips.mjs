import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { recording } from '../components/music/offline-source.mjs'

await mkdir('tmp', { recursive: true })
const root = await mkdtemp(path.resolve('tmp/listening-clips-'))
const profile = path.join(root, 'profile')
const db = new MusicStore(path.join(profile, 'fitbay-music'))
db.set('music-guide-v1', 1)
db.set('music-media-keys', 'off')
const ids = []
const batch = db.saveSuggestions('快速试听', [], '待处理', undefined, 5)
for (const [i, title] of ['主段落', '普通试听', '有声开头', '第四首', '第五首'].entries()) {
  const file = path.join(root, title + '.wav')
  const sample = Buffer.from(recording('fitbay-tone-1'))
  const rate = sample.readUInt32LE(24)
  const pcm = Buffer.alloc(rate * 2 * 48)
  if (i !== 1) {
    const src = sample.subarray(44)
    for (let offset = 8 * rate * 2; offset < 38 * rate * 2; offset += src.length)
      src.copy(pcm, offset, 0, Math.min(src.length, 38 * rate * 2 - offset))
  }
  const header = Buffer.from(sample.subarray(0, 44))
  header.writeUInt32LE(36 + pcm.length, 4)
  header.writeUInt32LE(pcm.length, 40)
  await writeFile(file, Buffer.concat([header, pcm]))
  db.library.upsert({ file, title, artist: '验收', album: '试听', duration: 48 })
  const { id } = db.db.prepare('SELECT id FROM local_tracks WHERE file=?').get(file)
  ids.push(id)
  db.saveSuggestions('快速试听', [{ title, artist: '验收', reason: '' }], '待处理', batch)
  const item = db.db.prepare('SELECT id FROM items WHERE title=?').get(title).id
  db.status(item, '已入库')
  db.db.prepare('UPDATE recommended_items SET local=? WHERE item=?').run(id, item)
}
db.db.close()
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
  const press = async (label) =>
    page.getByRole('button', { name: label, exact: true }).evaluate((b) => b.click())
  const media = page.locator('audio')
  const at = () => media.evaluate((a) => a.currentTime)
  const failures = []
  const check = async (name, test) => {
    try {
      await test()
    } catch (e) {
      failures.push(name + ': ' + e.message)
      console.error(name, e.message)
    }
  }
  await page.getByRole('tab', { name: 'AI 推荐' }).evaluate((b) => b.click())
  // Hold the real decoder after it receives the recording. Reload between checks to discard the cue cache.
  for (const action of ['暂停', '下一首', '停止播放']) {
    await page.reload()
    await page.getByRole('tab', { name: 'AI 推荐' }).evaluate((b) => b.click())
    await press('播放本次推荐')
    await expect.poll(() => media.evaluate((a) => !a.paused)).toBe(true)
    await page.evaluate(() => {
      const original = OfflineAudioContext.prototype.decodeAudioData
      OfflineAudioContext.prototype.decodeAudioData = async function (bytes) {
        await new Promise((resolve) => {
          window.unblockDecoder = resolve
        })
        return original.call(this, bytes)
      }
    })
    await press('快速听这批')
    await expect.poll(() => page.evaluate(() => typeof window.unblockDecoder)).toBe('function')
    await press(action)
    await page.evaluate(() => window.unblockDecoder())
    await check('分析中' + action, async () => {
      await expect(page.getByText('正在分析试听片段')).toHaveCount(0, { timeout: 2000 })
      await expect(page.getByText('1/5 · 代表片段')).toHaveCount(0, { timeout: 1000 })
      if (action === '下一首')
        await expect
          .poll(() => page.evaluate(async () => (await window.music.state()).current))
          .toBe(ids[1])
      else assert.equal(await media.evaluate((a) => a.paused), true)
    })
  }
  await page.reload()
  await page.getByRole('tab', { name: 'AI 推荐' }).evaluate((b) => b.click())
  await press('快速听这批')
  await expect(page.getByText('1/5 · 代表片段')).toBeVisible()
  await expect.poll(at).toBeGreaterThan(7)
  await press('收藏这首')
  await expect
    .poll(() =>
      page.evaluate(
        async (id) => (await window.music.state()).localTracks.find((r) => r.id === id).favorite,
        ids[0],
      ),
    )
    .toBe(1)
  await press('跳过片段')
  await expect(page.getByText('2/5 · 普通试听')).toBeVisible()
  await expect.poll(at).toBeLessThan(2)
  await media.evaluate((a) => {
    a.currentTime = 20.2
  })
  await expect(page.getByText('3/5 · 代表片段')).toBeVisible()
  for (const number of [4, 5]) {
    await press('跳过片段')
    await expect(page.getByText(number + '/5 · 代表片段')).toBeVisible()
  }
  await press('从头播放')
  await expect.poll(at).toBeLessThan(2)
  await expect(page.getByText('5/5 · 代表片段')).toHaveCount(0)
  await press('播放本次推荐')
  await media.evaluate((a) => {
    a.currentTime = 38.4
  })
  await expect.poll(at).toBeGreaterThan(39)
  const current = () => page.evaluate(async () => (await window.music.state()).current)
  assert.equal(await current(), ids[0])
  // Keep the two recordings with audible edges in the random queue.
  await page.evaluate(
    async (ids) => {
      await window.music.setQueue(ids)
    },
    [ids[0], ids[2]],
  )
  await page.getByRole('tab', { name: '曲库' }).evaluate((b) => b.click())
  await press('当前顺序播放，切换为随机播放')
  await media.evaluate((a) => {
    a.currentTime = 20
  })
  await page.evaluate(() => {
    window.testTail = []
    const Original = window.Audio
    window.Audio = class extends Original {
      constructor(src) {
        super(src)
        const started = this.play.bind(this)
        this.play = async () => {
          await started()
          const timer = setInterval(() => {
            const main = document.querySelector('audio')
            if (!this.getAttribute('src')) clearInterval(timer)
            else if (
              !main.paused &&
              !this.paused &&
              main.volume > 0 &&
              this.volume > 0 &&
              this.volume < 1
            )
              window.testOverlap = true
          }, 15)
        }
        window.testTail.push(this)
      }
    }
  })
  await media.evaluate((a) => {
    a.currentTime = 37
  })
  await expect.poll(current).toBe(ids[2])
  await expect.poll(at).toBeGreaterThan(7)
  await expect.poll(() => page.evaluate(() => window.testTail.length)).toBeGreaterThan(0)
  await expect
    .poll(() =>
      page.evaluate(() => window.testTail.every((a) => a.paused && !a.getAttribute('src'))),
    )
    .toBe(true)
  assert.equal(await page.evaluate(() => window.testOverlap), true)
  await media.evaluate((a) => {
    a.currentTime = 37
  })
  await expect.poll(current).toBe(ids[0])
  await expect.poll(at).toBeGreaterThan(7)
  await page.getByRole('tab', { name: 'AI 推荐' }).evaluate((b) => b.click())
  await press('快速听这批')
  await expect(page.getByText('1/5 · 代表片段')).toBeVisible()
  // The hidden Windows compositor omits the native backdrop from captures.
  await page.evaluate(() => {
    delete document.documentElement.dataset.backdrop
  })
  await page.screenshot({ path: path.join(root, 'quick-listen.png') })
  await page.getByRole('tab', { name: '曲库' }).evaluate((b) => b.click())
  await press('专辑')
  await page
    .locator('.album-tile')
    .first()
    .evaluate((b) => b.click())
  await press('播放整张')
  await check('随机模式播放整张', async () => {
    await expect(page.locator('.music-order')).toHaveText('顺序播放', { timeout: 1000 })
    const album = await page.evaluate(async () => (await window.music.albums())[0].tracks)
    await expect.poll(current).toBe(album[0])
    assert.ok((await at()) < 3)
    await media.evaluate((a) => {
      a.currentTime = 40
    })
    await expect.poll(at).toBeGreaterThan(40.4)
    assert.equal(await current(), album[0])
    await media.evaluate((a) => {
      a.currentTime = a.duration - 0.15
    })
    await expect.poll(current).toBe(album[1])
    assert.ok((await at()) < 3)
  })
  assert.deepEqual(failures, [])
  console.log(
    'PASS 代表片段、收藏跳过、普通试听自动续首、从头播、顺序保留尾奏、随机首尾交叠与释放',
    root,
  )
} finally {
  await app.close()
}
