import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs/promises'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { writeFixtureRecording } from './music-recording-fixture.mjs'

const root = await fs.mkdtemp(path.resolve('tmp/music-keyboard-'))
const profile = path.join(root, 'profile')
const store = new MusicStore(path.join(profile, 'fitbay-music'))
store.set('music-guide-v1', 1)
store.set('music-volume', 60)
store.set('shortcut-previous', 'Ctrl+Shift+F8')
store.set('shortcut-volumeUp', '')
for (const [i, title] of ['A', 'B', 'C'].entries()) {
  const file = path.join(root, title + '.wav')
  await writeFixtureRecording(file, i + 1, 60)
  store.library.upsert({ file, title, artist: '测试乐队', album: '轻声', duration: 60 })
}
store.db.close()
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
  await app.evaluate(({ app, BaseWindow, globalShortcut }) => {
    const register = globalShortcut.register.bind(globalShortcut)
    globalThis.keyCallbacks = new Map()
    globalShortcut.register = (key, callback) => {
      const success = register(key, callback)
      if (success) globalThis.keyCallbacks.set(key, callback)
      return success
    }
    assertPrivate()
    function assertPrivate() {
      if (
        !app.commandLine.hasSwitch('mute-audio') ||
        BaseWindow.getAllWindows().some((w) => w.isFocusable())
      )
        throw Error('后台静音验证要求未满足')
    }
    BaseWindow.getAllWindows()
      .find((w) => w.getTitle() === 'Music')
      .setContentSize(980, 720)
  })
  const state = () => page.evaluate(() => window.music.state())
  const current = () => page.locator('.music-transport strong').textContent()
  const paused = () => page.locator('audio').evaluate((a) => a.paused)
  const key = async (target, k = 'Enter') => {
    await target.focus()
    await target.press(k)
  }
  const button = (name) => page.getByRole('button', { name, exact: true })
  const bodyKey = async (k) => {
    await page.evaluate(() => document.activeElement.blur())
    await page.keyboard.press(k)
  }
  const shot = (n) =>
    page.screenshot({
      path: path.join(root, n + '.png'),
      animations: 'disabled',
      style: ':root {background:var(--base)!important}',
    })
  const stored = (await state()).prefs
  assert.equal(stored.appKeys, true)
  assert.equal(stored.globalKeys, false)
  assert.deepEqual(stored.shortcuts, {
    toggle: 'Ctrl+Alt+Q',
    previous: 'Ctrl+Shift+F8',
    next: 'Ctrl+Alt+Right',
    volumeUp: '',
    volumeDown: 'Ctrl+Alt+Down',
  })
  await key(button('播放A'))
  await expect.poll(current).toBe('A')
  await bodyKey('ArrowRight')
  await expect.poll(current).toBe('B')
  await bodyKey('ArrowLeft')
  await expect.poll(current).toBe('A')
  await bodyKey('Space')
  await expect.poll(paused).toBe(true)
  await bodyKey('Space')
  await expect.poll(paused).toBe(false)
  await bodyKey('ArrowDown')
  await expect.poll(async () => (await state()).prefs.volume).toBe(55)
  await bodyKey('ArrowUp')
  await expect.poll(async () => (await state()).prefs.volume).toBe(60)
  const input = page.getByRole('searchbox', { name: '搜索本地歌曲' })
  await input.fill('测试乐队')
  await input.press('ArrowRight')
  await input.press('Space')
  await input.press('Backspace')
  assert.equal(await current(), 'A')
  assert.equal(await paused(), false)
  await input.press('ArrowDown')
  const rows = page.locator('li.library-row')
  await expect(rows.nth(0)).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(rows.nth(1)).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(rows.nth(0)).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(rows.nth(1)).toBeFocused()
  const before = await page
    .locator('audio')
    .evaluate((a) => ({ url: a.currentSrc, time: a.currentTime }))
  await page.keyboard.press('Shift+Enter')
  const tracks = (await state()).localTracks
  await expect
    .poll(async () => (await state()).queue.map((id) => tracks.find((t) => t.id === id).title))
    .toEqual(['A', 'C', 'B'])
  await expect(rows.nth(1)).toBeFocused()
  await expect
    .poll(() => page.locator('audio').evaluate((a) => a.currentTime))
    .toBeGreaterThan(before.time)
  assert.equal(await page.locator('audio').evaluate((a) => a.currentSrc), before.url)
  assert.equal(await current(), 'A')
  assert.equal((await state()).prefs.volume, 60)
  await shot('queue-selection')
  await key(button('更多音乐操作'))
  await key(page.getByRole('menuitem', { name: '音乐设置', exact: true }))
  await key(button('快捷键'))
  await expect(page.getByLabel('启用应用内快捷键')).toBeChecked()
  const global = page.getByLabel('启用全局快捷键')
  await expect(global).not.toBeChecked()
  const field = page.getByRole('textbox', { name: '提高音量', exact: true })
  await key(field, 'Control+Alt+Shift+F11')
  await key(button('保存提高音量快捷键'))
  await expect.poll(async () => (await state()).prefs.shortcuts.volumeUp).toBe('Ctrl+Alt+Shift+F11')
  const registered = (k) =>
    app.evaluate(({ globalShortcut }, key) => globalShortcut.isRegistered(key), k)
  assert.equal(await registered('Ctrl+Alt+Shift+F11'), false)
  for (const key of ['Ctrl+Alt+Q', 'MediaPlayPause', 'MediaPreviousTrack', 'MediaNextTrack'])
    assert.equal(await registered(key), false)
  await key(global, 'Space')
  await expect.poll(() => registered('Ctrl+Alt+Shift+F11')).toBe(true)
  await app.evaluate(() => globalThis.keyCallbacks.get('Ctrl+Alt+Shift+F11')())
  await expect.poll(async () => (await state()).prefs.volume).toBe(65)
  await key(global, 'Space')
  await expect.poll(() => registered('Ctrl+Alt+Shift+F11')).toBe(false)
  const local = page.getByLabel('启用应用内快捷键')
  await key(local, 'Space')
  await expect.poll(async () => (await state()).prefs.appKeys).toBe(false)
  await bodyKey('ArrowRight')
  assert.equal(await current(), 'A')
  await key(local, 'Space')
  await expect.poll(async () => (await state()).prefs.appKeys).toBe(true)
  await shot('settings')
  await fs.writeFile(
    path.join(root, 'observations.json'),
    JSON.stringify(
      {
        defaults: stored.shortcuts,
        saved: (await state()).prefs.shortcuts,
        queue: (await state()).queue,
        current: await current(),
        before: before.time,
        after: await page.locator('audio').evaluate((a) => a.currentTime),
      },
      null,
      2,
    ),
  )
  console.log('PASS keys, scoped registration, ordinary search focus and tail queue', root)
} finally {
  await app.close()
}
