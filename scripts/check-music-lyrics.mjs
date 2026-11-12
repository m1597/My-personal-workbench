import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { recording } from '../components/music/offline-source.mjs'
import {
  saveLyrics,
  ownedLyrics,
  localLines,
  lyricPath,
} from '../examples/component-host/music-lyrics.mjs'

const root = await mkdtemp(path.resolve('tmp/music-lyrics-'))
const profile = path.join(root, 'profile')
const store = new MusicStore(path.join(profile, 'fitbay-music'))
const a = path.join(root, 'A.wav'),
  b = path.join(root, 'B.wav')
for (const [title, file] of [
  ['A', a],
  ['B', b],
  ['C', path.join(root, 'C.wav')],
]) {
  await writeFile(file, recording('fitbay-tone-1'))
  store.library.upsert({ title, file, artist: '测试', album: '', duration: 20 })
}
await saveLyrics(
  store.db,
  a,
  async () => '[offset:500]\n[00:00.50]第一句\n[00:04.50][00:09.50]第二句',
)
assert.deepEqual(await localLines(a), [
  [0, '第一句'],
  [4, '第二句'],
  [9, '第二句'],
])
assert.equal(await ownedLyrics(store.db, a), lyricPath(a))
await writeFile(lyricPath(b), '[00:00]自备歌词')
await saveLyrics(store.db, b, async () => {
  throw Error('不应覆盖本地歌词')
})
assert.equal(await ownedLyrics(store.db, b), null)
await saveLyrics(store.db, path.join(root, 'C.wav'), async () => '[00:01]下载歌词')
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
  const button = (name) => page.getByRole('button', { name, exact: true })
  await expect(button('桌面歌词')).toHaveAttribute('aria-pressed', 'false')
  for (const title of ['A', 'B']) {
    await page.locator('.library-name strong', { hasText: title }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: '加入队列', exact: true }).click()
  }
  await button('播放').click()
  const opened = app.waitForEvent('window')
  await button('桌面歌词').click()
  const overlay = await opened
  await expect(overlay.locator('strong')).toHaveText('第一句')
  await overlay.getByRole('button', { name: '锁定' }).click()
  await expect(overlay.locator('body')).toHaveClass('locked')
  await button('暂停').click()
  await page.locator('audio').evaluate((el) => {
    el.currentTime = 6
  })
  await expect(overlay.locator('strong')).toHaveText('第二句')
  await overlay.screenshot({ path: path.join(root, 'desktop-lyrics.png') })
  await button('下一首').click()
  await expect(overlay.locator('strong')).toHaveText('自备歌词')
  await button('桌面歌词').click()
  await expect.poll(() => overlay.isClosed()).toBe(true)
  await writeFile(lyricPath(a), '[00:00]用户修改')
  const db = new MusicStore(path.join(profile, 'fitbay-music'))
  assert.equal(await ownedLyrics(db.db, a), null)
  db.db.close()
  const aid = await page.evaluate(
    async () => (await window.music.state()).localTracks.find((t) => t.title === 'A').id,
  )
  await page.evaluate((id) => window.music.removeLocal(id), aid)
  assert.equal(await readFile(lyricPath(a), 'utf8'), '[00:00]用户修改')
  await app.evaluate(({ dialog, shell }) => {
    globalThis.lyricTrash = { files: [], detail: '' }
    dialog.showMessageBox = async (options) => {
      globalThis.lyricTrash.detail = options.detail
      return { response: 1 }
    }
    shell.trashItem = async (file) => {
      globalThis.lyricTrash.files.push(file)
    }
  })
  const trash = async (title) => {
    await page.evaluate(async (title) => {
      const row = (await window.music.state()).localTracks.find((t) => t.title === title)
      await window.music.trashLocal(row.id)
    }, title)
    return app.evaluate(() => globalThis.lyricTrash)
  }
  const c = path.join(root, 'C.wav')
  assert.deepEqual(await trash('C'), { files: [c, lyricPath(c)], detail: c + '\n' + lyricPath(c) })
  assert.deepEqual(await trash('B'), { files: [c, lyricPath(c), b], detail: b })
  console.log(
    'PASS 同步歌词、本地优先、文件归属、桌面歌词开关与锁定、暂停定位、切歌、仅移除索引。' + root,
  )
} finally {
  await app.close()
}
