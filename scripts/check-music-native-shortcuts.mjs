import { _electron as electron, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { MusicStore } from '../components/music/store.mjs'
import { recording } from '../components/music/offline-source.mjs'

await mkdir('tmp', { recursive: true })
const profile = await mkdtemp(path.resolve('tmp/native-hotkeys-'))
const store = new MusicStore(path.join(profile, 'fitbay-music'))
for (const title of ['A', 'B']) {
  const file = path.join(profile, title + '.wav')
  await writeFile(file, recording('fitbay-tone-1'))
  store.library.upsert({ file, title, artist: 'test', album: '', duration: 20 })
}
store.set('music-media-keys', 'off')
for (const [action, fn] of [
  ['toggle', 10],
  ['previous', 8],
  ['next', 9],
]) {
  store.set('shortcut-' + action, 'Ctrl+Alt+Shift+F' + fn)
}
store.db.close()
const app = await electron.launch({
  args: [
    path.resolve('dist/component-prototype/host'),
    '--mode=music',
    '--user-data-dir=' + profile,
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  const page = await app.firstWindow()
  await page.getByRole('button', { name: '跳过', exact: true }).click()
  expect(await app.evaluate(({ app }) => app.commandLine.hasSwitch('mute-audio'))).toBe(true)
  await page.getByRole('button', { name: '播放A', exact: true }).click()
  const pid = await app.evaluate(() => process.pid)
  const notify = (...args) =>
    execFileSync('python', ['scripts/win32-test-hotkey.py', String(pid), ...args.map(String)], {
      windowsHide: true,
      encoding: 'utf8',
    }).trim()
  const foreground = notify()
  // With media keys off, the fresh process registers toggle, previous, next in that order.
  for (const [registration, fn, paused, title] of [
    [0, 10, true, 'A'],
    [0, 10, false, 'A'],
    [2, 9, false, 'B'],
    [1, 8, false, 'A'],
  ]) {
    const combo = 'Ctrl+Alt+Shift+F' + fn
    expect(
      await app.evaluate(({ globalShortcut }, key) => globalShortcut.isRegistered(key), combo),
    ).toBe(true)
    expect(notify(registration, fn)).toBe(foreground)
    await expect.poll(() => page.locator('audio').evaluate((a) => a.paused)).toBe(paused)
    await expect(page.locator('.music-transport strong')).toHaveText(title)
    expect(notify()).toBe(foreground)
    expect(
      await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().some((w) => w.isFocused())),
    ).toBe(false)
    console.log('PASS WM_HOTKEY', combo, title, paused ? 'paused' : 'playing')
  }
} finally {
  await app.close()
}
