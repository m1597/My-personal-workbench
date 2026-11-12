import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { recording } from '../components/music/offline-source.mjs'
const root = await mkdtemp(path.resolve('tmp/music-queue-'))
const profile = path.join(root, 'profile')
const store = new MusicStore(path.join(profile, 'fitbay-music'))
for (const title of ['A', 'B', 'C', 'D', 'E']) {
  const file = path.join(root, title + '.wav')
  await writeFile(file, recording('fitbay-tone-1'))
  store.library.upsert({ title, file, artist: '测试艺人', album: '', duration: 20 })
}
const playlist = store.library.createPlaylist('原顺序')
for (const row of store.library.list()) store.library.setMembership(playlist, row.id, true)
store.db.close()
const app = await electron.launch({
  args: [
    path.resolve('dist/component-prototype/host'),
    '--mode=music',
    '--mute-audio',
    '--workbench=' + path.resolve('out/renderer/index.html'),
    '--user-data-dir=' + profile,
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  const page = await app.firstWindow()
  await page.getByRole('button', { name: '跳过', exact: true }).click()
  const button = (name) => page.getByRole('button', { name, exact: true })
  const enqueue = async (title, action) => {
    await page.locator('.library-name strong', { hasText: title }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: action, exact: true }).click()
  }
  const snapshot = () =>
    page.evaluate(async () => {
      const s = await window.music.state(),
        title = (id) => s.localTracks.find((t) => t.id === id)?.title
      return {
        current: title(s.current),
        queue: s.queue.map(title),
        list: s.playlists.find((p) => p.name === '原顺序').tracks.map(title),
      }
    })
  await enqueue('B', '加入队列')
  await expect.poll(async () => (await snapshot()).queue).toEqual(['B'])
  await button('播放').click()
  await expect.poll(async () => (await snapshot()).current).toBe('B')
  await enqueue('D', '加入队列')
  await enqueue('A', '下一首播放')
  await expect.poll(async () => (await snapshot()).queue).toEqual(['B', 'A', 'D'])
  await button('播放队列').click()
  const pop = page.locator('.music-queue')
  await expect(pop.getByText('当前曲目 · B · 测试艺人')).toBeVisible()
  await expect(pop.locator('li')).toHaveText(['A · 测试艺人', 'D · 测试艺人'])
  await page.evaluate(() => {
    delete document.documentElement.dataset.backdrop
  })
  await page.screenshot({ path: path.join(root, 'queue.png') })
  await page.keyboard.press('Escape')
  const mode = page.locator('.music-order')
  await mode.click()
  await enqueue('C', '下一首播放')
  await button('下一首').click()
  await expect.poll(async () => (await snapshot()).current).toBe('C')
  const titles = ['A', 'B', 'C', 'D', 'E']
  assert.deepEqual((await snapshot()).list, titles)
  await page.getByRole('tab', { name: '下载音乐' }).click()
  await button('播放队列').click()
  await expect(pop.getByText('当前曲目 · C · 测试艺人')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('tab', { name: '本地曲库' }).click()
  await button('播放A').click()
  const playing = async () => {
    await expect
      .poll(() => page.locator('audio').evaluate((a) => !a.paused && a.currentTime > 0))
      .toBe(true)
    return page.locator('.music-transport strong').innerText()
  }
  await expect(page.locator('.music-transport strong')).toHaveText('A')
  const heard = [await playing()]
  for (let i = 0; i < 12; i++) {
    await button('下一首').click()
    await expect(page.locator('.music-transport strong')).not.toHaveText(heard.at(-1))
    heard.push(await playing())
  }
  for (const start of [0, 5]) assert.deepEqual([...heard.slice(start, start + 5)].sort(), titles)
  assert.notEqual(heard[4], heard[5])
  assert.notEqual(heard[9], heard[10])
  // Let the decoder emit a real ended event at a shuffle boundary.
  for (let i = 0; i < 2; i++) {
    await button('下一首').click()
    await expect(page.locator('.music-transport strong')).not.toHaveText(heard.at(-1))
    heard.push(await playing())
  }
  const audio = page.locator('audio')
  const finish = () =>
    audio.evaluate(
      (a) =>
        new Promise((resolve) => {
          a.addEventListener('ended', () => resolve(), { once: true })
          a.currentTime = a.duration - 0.2
        }),
    )
  await finish()
  await expect(page.locator('.music-transport strong')).not.toHaveText(heard.at(-1))
  await playing()
  await mode.click()
  await expect(mode).toHaveText('单曲循环')
  const repeat = async (title) => {
    await audio.evaluate(
      (a) =>
        new Promise((resolve) => {
          a.addEventListener('ended', () => resolve(), { once: true })
          a.currentTime = 0
          a.playbackRate = 4
        }),
    )
    await expect
      .poll(() => audio.evaluate((a) => !a.paused && a.currentTime > 0 && a.currentTime < 3))
      .toBe(true)
    await expect(page.locator('.music-transport strong')).toHaveText(title)
  }
  const current = await playing()
  await repeat(current)
  await button('下一首').click()
  await expect(page.locator('.music-transport strong')).not.toHaveText(current)
  const second = await playing()
  await repeat(second)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
  })
  await page.screenshot({ path: path.join(root, 'repeat-one.png') })
  await button('上一首').click()
  await expect(page.locator('.music-transport strong')).toHaveText(current)
  console.log(
    'PASS 临时插播、追加、跨页、随机跨轮、单曲自然重播和手动切歌。',
    heard.slice(0, 13).join(' → '),
    current,
    second,
    root,
  )
} finally {
  await app.close()
}
