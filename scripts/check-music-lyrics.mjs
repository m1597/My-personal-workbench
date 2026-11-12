import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
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
const silent = path.join(root, 'No Lyrics.wav')
for (const [title, file] of [
  ['A', a],
  ['B', b],
  ['No Lyrics', silent],
  ['C', path.join(root, 'C.wav')],
  ['D', path.join(root, 'D.wav')],
]) {
  await writeFile(file, recording('fitbay-tone-1'))
  store.library.upsert({
    title,
    file,
    artist: '测试',
    album: '',
    duration: 20,
  })
}
await saveLyrics(
  store.db,
  a,
  async () =>
    '[offset:500]\n[00:00.50]第一句\n[00:00.50]First line\n[00:04.50][00:09.50]第二句\n[00:04.50]Second line',
)
assert.deepEqual(await localLines(a), [
  [0, '第一句'],
  [4, '第二句'],
  [9, '第二句'],
])
assert.equal(await ownedLyrics(store.db, a), lyricPath(a))
const tagged = path.join(root, 'Tagged.wav')
for (const [tags, expected] of [
  ['[ar:测试 (Test)]\n[ti:测试歌曲 (《某作品》主题曲)]', true],
  ['[ar:另一位歌手]\n[ti:测试歌曲]', false],
  ['[ti:另一首歌]', false],
  ['[ti:测试歌曲 (Live)]', false],
]) {
  await writeFile(lyricPath(tagged), tags + '\n[00:00]原词\n[00:00]Translation')
  assert.deepEqual(
    await localLines(tagged, { title: '测试歌曲', artist: '测试' }),
    expected ? [[0, '原词']] : [],
  )
}
const localLyric = 'Inside the hollow we begain'
await writeFile(lyricPath(b), '[00:00]' + localLyric)
await saveLyrics(store.db, b, async () => {
  throw Error('不应覆盖本地歌词')
})
assert.equal(await ownedLyrics(store.db, b), null)
await saveLyrics(store.db, path.join(root, 'C.wav'), async () => '[00:01]下载歌词')
await writeFile(path.join(root, 'D.flac'), await readFile('tests/fixtures/local-music/tone.flac'))
await saveLyrics(store.db, path.join(root, 'D.wav'), async () => '[00:01]共有歌词')
store.db.close()
const launch = () =>
  electron.launch({
    args: [
      path.resolve('dist/component-prototype/host'),
      '--mode=music',
      '--mute-audio',
      '--workbench=' + path.resolve('out/renderer/index.html'),
      '--user-data-dir=' + profile,
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
let app = await launch()
try {
  let page = await app.firstWindow()
  await page.getByRole('button', { name: '跳过', exact: true }).click()
  const button = (name) => page.getByRole('button', { name, exact: true })
  await expect(button('桌面歌词')).toHaveAttribute('aria-pressed', 'false')
  for (const title of ['B', 'A', 'No Lyrics']) {
    await page.locator('.library-name strong', { hasText: title }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: '加入队列', exact: true }).click()
  }
  await button('播放').click()
  const opened = app.waitForEvent('window')
  await button('桌面歌词').click()
  const overlay = await opened
  await expect(overlay.locator('strong')).toHaveText(localLyric)
  await expect(overlay.locator('body')).toHaveCSS('background-image', 'none')
  await expect(overlay.locator('body')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(overlay.locator('button')).toHaveCSS('opacity', '0')
  await overlay.locator('strong').hover()
  await expect(overlay.locator('button')).toHaveCSS('opacity', '1')
  await button('下一首').click()
  await expect(overlay.locator('strong')).toHaveText('第一句')
  const handle =
    process.platform === 'win32' &&
    (await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getTitle() === '桌面歌词')
        .getNativeWindowHandle()
        .readBigUInt64LE()
        .toString(),
    ))
  async function nativeProbe(...args) {
    return promisify(execFile)(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        path.resolve('scripts/native-dock-probe.ps1'),
        handle,
        ...args,
      ],
      { windowsHide: true, timeout: 10000 },
    )
  }
  async function checkPassThrough(expected) {
    if (!handle) return
    const { stdout } = await nativeProbe('-ReadExtendedStyle')
    assert.equal(Boolean(Number(stdout.trim()) & 0x20), expected, 'WS_EX_TRANSPARENT')
  }
  await overlay.getByRole('button', { name: '锁定' }).click()
  await expect(overlay.locator('body')).toHaveClass('locked')
  await checkPassThrough(true)
  await expect(overlay.locator('body')).toHaveCSS('-webkit-app-region', 'no-drag')
  await button('暂停').click()
  await page.locator('audio').evaluate((el) => {
    el.currentTime = 6
  })
  await expect(overlay.locator('strong')).toHaveText('第二句')
  await overlay.screenshot({ path: path.join(root, 'desktop-lyrics.png') })
  await button('下一首').click()
  await expect(overlay.locator('strong')).toBeEmpty()
  await button('上一首').click()
  await expect(overlay.locator('strong')).toHaveText('第一句')
  await expect(overlay.locator('button')).toBeHidden()
  await button('解锁桌面歌词').click()
  await expect(overlay.locator('body')).toHaveCSS('-webkit-app-region', 'drag')
  await checkPassThrough(false)
  const overlayGeometry = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getTitle() === '桌面歌词')
        .getContentBounds(),
    )
  const first = await overlayGeometry()
  // Simulate the Windows move loop on the test HWND without moving the system pointer.
  const notifyMove = async (message) => {
    if (handle) await nativeProbe(String(message))
  }
  await notifyMove(0x231)
  await notifyMove(0x216)
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getTitle() === '桌面歌词')
    const [x, y] = win.getPosition()
    win.setPosition(x - 160, y + 120)
  })
  await notifyMove(0x232)
  const moved = await overlayGeometry()
  assert.notDeepEqual(moved, first)
  await button('桌面歌词').click()
  await expect.poll(() => overlay.isClosed()).toBe(true)
  const openingAgain = app.waitForEvent('window')
  await button('桌面歌词').click()
  const reopened = await openingAgain
  await expect(reopened.locator('strong')).toHaveText('第一句')
  const offsetFromCenter = await reopened.locator('strong').evaluate((el) => {
    const rect = el.getBoundingClientRect()
    return Math.abs(rect.x + rect.width / 2 - window.innerWidth / 2)
  })
  assert.ok(offsetFromCenter < 1)
  const restored = await overlayGeometry()
  console.log({ first, moved, restored })
  assert.deepEqual(restored, moved)
  await reopened.screenshot({
    path: path.join(root, 'desktop-lyrics-reopened.png'),
  })
  const area = await app.evaluate(({ screen }) => {
    // Exercise removal/reconfiguration without changing the user's display topology.
    const primary = screen.getPrimaryDisplay()
    screen.getDisplayMatching = () => primary
    return primary.workArea
  })
  async function place(x, y, displayEvent) {
    await app.evaluate(
      ({ BrowserWindow, screen }, { x, y, displayEvent }) => {
        const win = BrowserWindow.getAllWindows().find((w) => w.getTitle() === '桌面歌词')
        win.setPosition(x, y)
        if (displayEvent) screen.emit(displayEvent)
        else win.emit('moved')
      },
      { x, y, displayEvent },
    )
    return overlayGeometry()
  }
  const corners = [
    [area.x - 200, area.y - 120, area.x, area.y, ''],
    [
      area.x + area.width + 300,
      area.y + area.height + 200,
      area.x + area.width - restored.width,
      area.y + area.height - restored.height,
      'display-metrics-changed',
    ],
  ]
  for (const [x, y, left, top, event] of corners) {
    const rect = await place(x, y, event)
    assert.deepEqual(rect, {
      x: left,
      y: top,
      width: restored.width,
      height: restored.height,
    })
  }
  const clamped = await place(area.x - 2500, area.y - 1600, 'display-removed')
  assert.deepEqual(clamped, { ...restored, x: area.x, y: area.y })
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  const afterRestart = app.waitForEvent('window')
  await button('桌面歌词').click()
  await (await afterRestart).waitForLoadState()
  await expect.poll(overlayGeometry).toEqual(clamped)
  await button('桌面歌词').click()
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
  assert.deepEqual(await trash('C'), {
    files: [c, lyricPath(c)],
    detail: c + '\n' + lyricPath(c),
  })
  assert.deepEqual(await trash('B'), {
    files: [c, lyricPath(c), b],
    detail: b,
  })
  const shared = path.join(root, 'D.wav')
  assert.deepEqual(await trash('D'), {
    files: [c, lyricPath(c), b, shared],
    detail: shared,
  })
  console.log(
    'PASS 同步歌词、本地优先、文件归属、桌面歌词开关与锁定、暂停定位、切歌、仅移除索引。' + root,
  )
} finally {
  await app.close()
}
