import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { recording } from '../components/music/offline-source.mjs'

await mkdir('tmp', { recursive: true })
const evidence = await mkdtemp(path.resolve('tmp/playlist-sorting-'))
const profile = path.join(evidence, 'profile')
const store = new MusicStore(path.join(profile, 'fitbay-music'))
store.set('music-guide-v1', 1)
const list = store.library.createPlaylist('排序验收')
const titles = ['B', 'C', 'A']
const ids = []
for (const [i, title] of titles.entries()) {
  const file = path.join(evidence, title + '.wav')
  const wave = recording('fitbay-tone-1')
  await writeFile(file, wave)
  store.library.upsert({
    file,
    title,
    artist: ['Z', 'A', 'M'][i],
    album: '排序',
    duration: 2,
    size: wave.length,
  })
  const id = store.db.prepare('SELECT id FROM local_tracks WHERE file=?').get(file).id
  ids.push(id)
  store.library.setMembership(list, id, true)
  store.db.prepare('INSERT INTO restored_recommendations(track) VALUES(?)').run(id)
}
store.db.close()
async function launch() {
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
  return app
}
for (const restart of [false, true]) {
  const app = await launch()
  try {
    const page = await app.firstWindow()
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
    })
    await app.evaluate(({ BaseWindow }) =>
      BaseWindow.getAllWindows()
        .find((w) => w.getTitle() === 'Music')
        .setContentSize(960, 720),
    )
    await page.getByRole('tab', { name: '歌单' }).click()
    const button = (name) => page.getByRole('button', { name, exact: true })
    const names = page.locator('.library-name strong')
    const choose = async (label) => {
      await button('歌单排序').click()
      await page.getByRole('menuitemradio', { name: label, exact: true }).click()
    }
    for (const name of ['排序验收', '歌曲推荐']) {
      await button(name).click()
      if (restart) {
        await expect(names).toHaveText(['C', 'A', 'B'])
        await choose('自定义顺序')
        await expect(names).toHaveText(['A', 'B', 'C'])
        continue
      }
      await expect(names).toHaveText(titles)
      const rows = page.locator('.library-row')
      await rows.nth(2).dragTo(rows.nth(0), { targetPosition: { x: 45, y: 3 } })
      await expect(names).toHaveText(['A', 'B', 'C'])
      if (name === '排序验收') {
        await app.evaluate(({ webContents }) => {
          const sender = webContents
            .getAllWebContents()
            .find((w) => w.getURL().includes('/music/index.html'))
          sender.startDrag = ({ files }) => {
            globalThis.draggedAudioFiles = files
          }
        })
        await button('多选').click()
        await page.getByRole('checkbox', { name: '选择B', exact: true }).check()
        await page.getByRole('checkbox', { name: '选择A', exact: true }).check()
        await rows.nth(1).locator('[data-audio-drag]').dispatchEvent('dragstart')
        await expect
          .poll(() => app.evaluate(() => globalThis.draggedAudioFiles))
          .toEqual(['A', 'B'].map((t) => path.join(evidence, t + '.wav')))
        await expect(names).toHaveText(['A', 'B', 'C'])
        await assert.rejects(
          page.evaluate(() => window.music.dragLocalFiles(['C:/Windows/explorer.exe'])),
        )
        await button('退出多选').click()
      }
      await choose('加入时间')
      await expect(names).toHaveText(titles)
      await choose('降序')
      await expect(names).toHaveText(['A', 'C', 'B'])
      await choose('歌名')
      await expect(names).toHaveText(['C', 'B', 'A'])
      await choose('升序')
      await expect(names).toHaveText(['A', 'B', 'C'])
      await choose('歌手')
      await expect(names).toHaveText(['C', 'A', 'B'])
      await button('播放C').click()
      await expect
        .poll(() => page.locator('audio').evaluate((el) => !el.paused && el.currentTime > 0.1))
        .toBe(true)
      await expect
        .poll(() => page.evaluate(async () => (await window.music.state()).queue))
        .toEqual([ids[1], ids[2], ids[0]])
      await button('暂停C').click()
      await button('歌单排序').click()
      await page.getByRole('menuitemradio', { name: '自定义顺序' }).waitFor()
      await page.screenshot({ path: path.join(evidence, name + '.png'), animations: 'disabled' })
      await page.keyboard.press('Escape')
    }
  } finally {
    await app.close()
  }
}
const { exportLibrary, restoreLibrary } = await import(
  '../dist/component-prototype/host/library-backup.mjs'
)
const original = new MusicStore(path.join(profile, 'fitbay-music'))
original.library.setPlaylistSort(list, 'artist', true)
original.library.setPlaylistSort('system-recommendations', 'added', true)
const taste = { document: () => ({ text: '', updatedAt: '', incorporated: [] }) }
const backup = exportLibrary(original, taste)
const expected = original.library.playlists()
original.db.close()
for (const legacy of [false, true]) {
  const saved = structuredClone(backup)
  if (legacy) {
    delete saved.recommendationOrder
    for (const p of saved.playlists) {
      delete p.additions
      delete p.sort
      delete p.descending
    }
  }
  const restored = new MusicStore(path.join(evidence, legacy ? 'legacy' : 'restored'))
  restoreLibrary(restored, taste, saved)
  restoreLibrary(restored, taste, saved)
  const actual = restored.library.playlists()
  if (legacy) {
    assert.deepEqual(
      actual.map((p) => p.tracks),
      expected.map((p) => p.tracks),
    )
    assert.ok(actual.every((p) => p.sort === 'custom'))
  } else assert.deepEqual(actual, expected)
  restored.db.close()
}
console.log('歌单排序、拖动、播放顺序、重开和新旧备份恢复通过', evidence)
