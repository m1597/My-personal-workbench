import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { recording } from '../components/music/offline-source.mjs'
import {
  saveLyrics,
  lyricLines,
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
  ['Plain', path.join(root, 'Plain.wav')],
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
const tail = Array.from({ length: 9 }, (_, i) => [10 + i, '旋律继续 · ' + (i + 1)])
const plain = ['风吹过寂静的街口', '远处的灯火依然明亮', '沿着回家的路', '风吹过寂静的街口']
await writeFile(lyricPath(path.join(root, 'Plain.wav')), '[ar:测试]\n' + plain.join('\n'))
assert.deepEqual(lyricLines('[ar:测试]\n[ti:A]'), [])
await saveLyrics(
  store.db,
  a,
  async () =>
    '[offset:500]\n[00:00.50]第一句\n[00:00.50]First line\n[00:04.50][00:09.50]第二句\n[00:04.50]Second line' +
    tail.map(([at, text]) => '\n[00:' + at + '.50]' + text).join(''),
)
assert.deepEqual(await localLines(a), [[0, '第一句'], [4, '第二句'], [9, '第二句'], ...tail])
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
for (const edition of ['Studio', 'Live']) {
  const file = path.join(root, edition + '.wav')
  await writeFile(file, recording('fitbay-tone-1'))
  store.library.upsert({ title: '同名录音', album: edition, artist: '测试', duration: 20, file })
}
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
  await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].setContentSize(960, 680))
  await page.evaluate(() => {
    document.documentElement.style.backgroundColor = getComputedStyle(
      document.documentElement,
    ).getPropertyValue('--base')
  })
  const button = (name) => page.getByRole('button', { name, exact: true })
  await expect(button('桌面歌词')).toHaveAttribute('aria-pressed', 'false')
  for (const title of ['B', 'A', 'No Lyrics', 'Plain']) {
    await page.locator('.library-name').getByText(title, { exact: true }).click({ button: 'right' })
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
  await expect(page.locator('.music-heading strong')).toHaveText('A')
  await expect(button('A')).toHaveCount(0)
  await button('打开歌词页').press('Enter')
  await expect(button('打开歌词页')).toBeFocused()
  await expect(button('回到当前歌词')).toHaveCount(0)
  const playerPage = page.getByRole('region', { name: '播放页' })
  const currentLine = playerPage.locator('[aria-current="true"]')
  await expect(currentLine).toHaveText('第一句')
  const artwork = playerPage.locator('.album-art img')
  await expect(artwork).toHaveAttribute('src', './default-cover.png')
  await expect
    .poll(() => artwork.evaluate((img) => img.complete && img.naturalWidth > 0))
    .toBe(true)
  const imageBounds = await artwork.boundingBox()
  const lyricsBounds = await currentLine.boundingBox()
  assert.ok(imageBounds.x + imageBounds.width <= lyricsBounds.x)
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
  await expect(currentLine).toHaveText('第二句')
  await expect
    .poll(() =>
      currentLine.evaluate((line) => {
        const pane = line.parentElement
        return Math.abs(
          line.offsetTop - pane.scrollTop - (pane.clientHeight - line.offsetHeight) / 2,
        )
      }),
    )
    .toBeLessThan(2)
  await expect(currentLine).toHaveCSS(
    'color',
    await playerPage.evaluate((el) => {
      const span = document.createElement('span')
      span.style.color = 'var(--accent)'
      el.append(span)
      const color = getComputedStyle(span).color
      span.remove()
      return color
    }),
  )
  await page.locator('audio').evaluate((el) => {
    el.currentTime = 4.2
  })
  await button('歌词校准').click()
  await button('延后 0.5 秒').click()
  await expect(currentLine).toHaveText('第一句')
  await expect(overlay.locator('strong')).toHaveText('第一句')
  await expect(page.getByRole('status').filter({ hasText: '延后 0.5 秒' })).toBeVisible()
  await page.screenshot({ path: path.join(root, 'lyric-timing.png') })
  await button('提前 0.5 秒').click()
  await expect(currentLine).toHaveText('第二句')
  await expect(overlay.locator('strong')).toHaveText('第二句')
  await button('提前 0.5 秒').click()
  await page.locator('audio').evaluate((el) => {
    el.currentTime = 3.6
  })
  await expect(currentLine).toHaveText('第二句')
  await expect(overlay.locator('strong')).toHaveText('第二句')
  await button('提前 0.5 秒').press('Escape')
  await playerPage.getByRole('button', { name: '第二句', exact: true }).first().click()
  await expect
    .poll(() => page.locator('audio').evaluate((el) => el.currentTime))
    .toBeGreaterThanOrEqual(3.5)
  assert.ok((await page.locator('audio').evaluate((el) => el.currentTime)) < 4)
  await button('暂停').click()
  const ids = await page.evaluate(async () => {
    const state = await window.music.state()
    return ['A', 'B'].map((title) => state.localTracks.find((t) => t.title === title).id)
  })
  assert.equal(await page.evaluate((id) => window.music.lyricTiming(id), ids[1]), 0)
  const persisted = new MusicStore(path.join(profile, 'fitbay-music'))
  assert.equal(persisted.get('lyric-offset-ms:' + ids[0]), '-500')
  persisted.db.close()
  await button('歌词校准').click()
  await button('恢复原时间').click()
  await expect(button('恢复原时间')).toBeDisabled()
  await button('提前 0.5 秒').press('Escape')
  await page.screenshot({ scale: 'css', path: path.join(root, 'now-playing-lyrics.png') })
  await overlay.screenshot({ path: path.join(root, 'desktop-lyrics.png') })
  await button('下一首').click()
  await expect(overlay.locator('strong')).toBeEmpty()
  await expect(playerPage.getByRole('heading')).toHaveText('No Lyrics')
  await expect(playerPage.getByRole('status')).toHaveText('暂无歌词')
  await expect(currentLine).toHaveCount(0)
  await page.screenshot({ path: path.join(root, 'now-playing-empty.png') })
  await button('下一首').click()
  const plainPane = playerPage.getByRole('region', { name: '歌词文本' })
  await expect(plainPane.locator('p')).toHaveText(plain)
  await expect(plainPane.getByRole('button')).toHaveCount(0)
  await button('暂停').click()
  const pausedTime = await page.locator('audio').evaluate((a) => a.currentTime)
  await plainPane.locator('p').first().click()
  assert.deepEqual(await page.locator('audio').evaluate((a) => [a.currentTime, a.paused]), [
    pausedTime,
    true,
  ])
  await page.screenshot({ path: path.join(root, 'plain-lyrics.png') })
  await button('上一首').click()
  await button('上一首').click()
  await expect(overlay.locator('strong')).toHaveText('第一句')
  await expect(currentLine).toHaveText('第一句')
  await button('暂停').click()
  const pane = playerPage.getByRole('region', { name: '同步歌词' })
  const restore = button('回到当前歌词')
  // Exercise native Chromium key scrolling while playback crosses a timestamp.
  await currentLine.focus()
  await currentLine.press('PageDown')
  await expect(restore).toBeVisible()
  await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(180)
  async function readingPosition() {
    return pane.evaluate(
      (el) =>
        new Promise((resolve) => {
          let previous = -1
          let still = 0
          function sample() {
            still = el.scrollTop === previous ? still + 1 : 0
            previous = el.scrollTop
            if (still >= 8) resolve(previous)
            else requestAnimationFrame(sample)
          }
          requestAnimationFrame(sample)
        }),
    )
  }
  const pageDownTop = await readingPosition()
  await page.locator('audio').evaluate((a) => {
    a.currentTime = 4.5
  })
  await expect(currentLine).toHaveText('第二句')
  assert.equal(await readingPosition(), pageDownTop)
  await page.screenshot({ path: path.join(root, 'keyboard-page-down.png') })
  await restore.press('Enter')
  await expect(restore).toHaveCount(0)
  await page.locator('audio').evaluate((a) => {
    a.currentTime = 0
  })
  await expect(currentLine).toHaveText('第一句')
  await currentLine.focus()
  const lastLine = pane.getByRole('button').last()
  for (let i = 1; i < (await pane.getByRole('button').count()); i++)
    await page.keyboard.press('Tab')
  await expect(lastLine).toBeFocused()
  await expect(restore).toBeVisible()
  const tabTop = await readingPosition()
  await page.locator('audio').evaluate((a) => {
    a.currentTime = 4.5
  })
  await expect(currentLine).toHaveText('第二句')
  assert.equal(await readingPosition(), tabTop)
  await page.screenshot({ path: path.join(root, 'keyboard-tab-reading.png') })
  for (const key of ['Enter', 'Space']) {
    await lastLine.press(key)
    await expect(currentLine).toHaveText(tail.at(-1)[1])
    await expect(restore).toHaveCount(0)
    await button('暂停').click()
    await page.locator('audio').evaluate((a) => {
      a.currentTime = 0
    })
    await expect(currentLine).toHaveText('第一句')
  }
  await expect
    .poll(() =>
      currentLine.evaluate((line) => {
        const p = line.parentElement
        return Math.abs(line.offsetTop - p.scrollTop - (p.clientHeight - line.offsetHeight) / 2)
      }),
    )
    .toBeLessThan(2)
  const client = await page.context().newCDPSession(page)
  const bounds = await pane.boundingBox()
  async function wheel(deltaY) {
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
      deltaX: 0,
      deltaY,
    })
  }
  await wheel(290)
  await expect(button('回到当前歌词')).toBeVisible()
  await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(180)
  await page.screenshot({ path: path.join(root, 'manual-lyrics.png') })
  const browsed = await pane.evaluate((el) => el.scrollTop)
  await page.locator('audio').evaluate((a) => {
    a.currentTime = 4.5
  })
  await expect(currentLine).toHaveText('第二句')
  assert.equal(await pane.evaluate((el) => el.scrollTop), browsed)
  await button('回到当前歌词').click()
  await expect(button('回到当前歌词')).toHaveCount(0)
  const centered = () =>
    currentLine.evaluate((el) => {
      const p = el.parentElement
      return Math.abs(el.offsetTop - p.scrollTop - (p.clientHeight - el.offsetHeight) / 2)
    })
  await expect.poll(centered).toBeLessThan(2)
  await page.screenshot({ path: path.join(root, 'resumed-lyrics.png') })
  await wheel(260)
  await expect(button('回到当前歌词')).toBeVisible()
  await pane.getByRole('button', { name: tail[0][1], exact: true }).click()
  await expect(button('回到当前歌词')).toHaveCount(0)
  await expect(button('暂停')).toBeVisible()
  await expect(currentLine).toHaveText(tail[0][1])
  const at = await page.locator('audio').evaluate((a) => a.currentTime)
  assert.ok(at >= 10 && at < 11)
  await page.screenshot({ path: path.join(root, 'seek-lyrics.png') })
  const framesDir = path.join(root, 'frames')
  await mkdir(framesDir)
  // Sample consecutive rendered frames through three natural audio-clock transitions.
  const frames = pane.evaluate(
    (el) =>
      new Promise((resolve) => {
        const records = []
        function frame(now) {
          const active = el.querySelector('[aria-current]')
          records.push({
            now,
            line: active.textContent,
            top: el.scrollTop,
            opacity: Number(getComputedStyle(active).opacity),
            previous: active.previousElementSibling
              ? Number(getComputedStyle(active.previousElementSibling).opacity)
              : null,
          })
          if (records.length > 1 && now - records[0].now >= 4200) resolve(records)
          else requestAnimationFrame(frame)
        }
        requestAnimationFrame(frame)
      }),
  )
  const start = Date.now()
  let i = 0
  while (Date.now() - start < 4150) {
    await page.screenshot({ path: path.join(framesDir, String(++i).padStart(3, '0') + '.png') })
  }
  const samples = await frames
  await writeFile(path.join(root, 'animation-frames.json'), JSON.stringify(samples))
  for (const [, text] of tail.slice(1, 4)) {
    const states = samples.filter((record) => record.line === text)
    assert.ok(new Set(states.map((r) => r.top)).size >= 4, '须有多个中间滚动位置：' + text)
    assert.ok(
      states.some(
        (r) => r.opacity > 0.58 && r.opacity < 0.98 && r.previous > 0.58 && r.previous < 0.98,
      ),
      '前后两句同时渐变：' + text,
    )
  }
  console.log('三次连续换行已验证', samples.length, '个渲染帧，', i, '张截图')
  await pane.getByRole('button', { name: '第一句', exact: true }).click()
  await button('暂停').click()
  await expect(currentLine).toHaveText('第一句')
  await playerPage.getByRole('button', { name: '返回' }).click()
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
  const versions = await page.evaluate(async () => {
    const tracks = (await window.music.state()).localTracks.filter((t) => t.title === '同名录音')
    const studio = tracks.find((t) => t.album === 'Studio').id
    const live = tracks.find((t) => t.album === 'Live').id
    await window.music.lyricTiming(live, 'later')
    return [studio, live]
  })
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  assert.equal(await page.evaluate((id) => window.music.lyricTiming(id), versions[1]), 500)
  assert.equal(await page.evaluate((id) => window.music.lyricTiming(id), versions[0]), 0)
  await page.evaluate((id) => window.music.lyricTiming(id, 'reset'), versions[1])
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
