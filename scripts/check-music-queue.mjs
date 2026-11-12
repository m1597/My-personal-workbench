import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { recording } from '../components/music/offline-source.mjs'
const root = await mkdtemp(path.resolve('tmp/music-queue-'))
const profile = path.join(root, 'profile')
const store = new MusicStore(path.join(profile, 'fitbay-music'))
for (const title of ['A', 'B', 'C', 'D']) {
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
  await button('随机播放').click()
  await enqueue('C', '下一首播放')
  await button('下一首').click()
  await expect.poll(async () => (await snapshot()).current).toBe('C')
  assert.deepEqual((await snapshot()).list, ['A', 'B', 'C', 'D'])
  await page.getByRole('tab', { name: '下载音乐' }).click()
  await button('播放队列').click()
  await expect(pop.getByText('当前曲目 · C · 测试艺人')).toBeVisible()
  console.log('PASS 空队列、临时插播、追加、随机下一首、跨页与原歌单顺序。' + root)
} finally {
  await app.close()
}
