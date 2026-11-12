import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { recording } from '../components/music/offline-source.mjs'
import { MusicStore } from '../components/music/store.mjs'

await mkdir('tmp', { recursive: true })
const evidence = await mkdtemp(path.resolve('tmp/music-settings-'))
const profile = path.join(evidence, 'profile')
const store = new MusicStore(path.join(profile, 'fitbay-music'))
for (const title of ['A', 'B', 'C']) {
  const file = path.join(evidence, title + '.wav')
  await writeFile(file, recording('fitbay-tone-1'))
  store.library.upsert({ file, title, artist: '测试', album: '', duration: 20 })
}
store.db.close()
const app = await electron.launch({
  args: [
    path.resolve('dist/component-prototype/host'),
    '--mode=workbench',
    '--workbench=' + path.resolve('out/renderer/index.html'),
    '--user-data-dir=' + profile,
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  expect(await app.evaluate(({ app }) => app.commandLine.hasSwitch('mute-audio'))).toBe(true)
  const shell = await app.firstWindow()
  await app.evaluate(({ globalShortcut }) => {
    globalThis.testMusicCallbacks = new Map()
    const register = globalShortcut.register.bind(globalShortcut)
    // Exercise Electron's real OS registration without injecting keystrokes into the user's desktop.
    globalShortcut.register = (key, callback) => {
      const ok = register(key, callback)
      if (ok) globalThis.testMusicCallbacks.set(key, callback)
      return ok
    }
    if (!register('Ctrl+Alt+F23', () => {})) throw Error('测试冲突键无法预占')
  })
  const open = async () => {
    await shell.getByRole('button', { name: '窗口', exact: true }).click()
    await shell.getByRole('menuitem', { name: 'Music', exact: true }).click()
    await expect
      .poll(() => app.windows().some((p) => p.url().includes('/music/index.html')))
      .toBe(true)
    return app.windows().find((p) => p.url().includes('/music/index.html'))
  }
  let player = await open()
  await player.waitForSelector('.music-shell', { timeout: 5000 })
  const loaded = await player.evaluate(() => window.music.state())
  expect(loaded.localTracks.map((row) => row.title)).toEqual(['A', 'B', 'C'])
  await player.getByRole('button', { name: '播放A', exact: true }).click({ timeout: 5000 })
  await player.getByRole('tab', { name: '设置', exact: true }).click()
  const prefs = () => player.evaluate(async () => (await window.music.state()).prefs)
  const combo = 'Ctrl+Alt+F22'
  await player.getByRole('textbox', { name: '播放 / 暂停', exact: true }).fill(combo)
  await player.getByRole('button', { name: '保存播放 / 暂停快捷键' }).click()
  await expect.poll(async () => (await prefs()).shortcuts.toggle).toBe(combo)
  await player.getByRole('textbox', { name: '播放 / 暂停', exact: true }).fill('Ctrl+Alt+F23')
  await player.getByRole('button', { name: '保存播放 / 暂停快捷键' }).click()
  await expect(player.getByText(/快捷键已被占用/).first()).toBeVisible()
  expect((await prefs()).shortcuts.toggle).toBe(combo)
  const key = async (accelerator) =>
    app.evaluate(({ globalShortcut }, key) => {
      if (!globalShortcut.isRegistered(key)) throw Error('未注册的快捷键：' + key)
      globalThis.testMusicCallbacks.get(key)()
    }, accelerator)
  const media = await prefs()
  const knownKeys = ['MediaPlayPause', 'MediaPreviousTrack', 'MediaNextTrack']
  for (const k of knownKeys) {
    const registered = await app.evaluate(
      ({ globalShortcut }, key) => globalShortcut.isRegistered(key),
      k,
    )
    expect(registered || media.shortcutFailures.includes(k)).toBe(true)
  }
  await player.getByLabel('启用键盘媒体键').uncheck()
  await expect.poll(async () => (await prefs()).mediaKeys).toBe(false)
  expect(
    await app.evaluate(
      ({ globalShortcut }, keys) => keys.some((k) => globalShortcut.isRegistered(k)),
      knownKeys,
    ),
  ).toBe(false)
  await player.getByLabel('启用键盘媒体键').check()
  await expect.poll(async () => (await prefs()).mediaKeys).toBe(true)
  const paused = () => player.locator('audio').evaluate((a) => a.paused)
  await key(combo)
  await expect.poll(paused).toBe(true)
  await key(combo)
  await expect.poll(paused).toBe(false)
  for (const [label, acc, expected] of [
    ['下一首', 'Ctrl+Alt+F21', 'B'],
    ['上一首', 'Ctrl+Alt+F20', 'A'],
  ]) {
    await player.getByRole('textbox', { name: label, exact: true }).fill(acc)
    await player.getByRole('button', { name: '保存' + label + '快捷键' }).click()
    await key(acc)
    await expect(player.locator('.music-transport strong')).toHaveText(expected)
  }
  expect(
    await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().some((w) => w.isFocused())),
  ).toBe(false)
  // Supply the same opaque fallback used beneath the transparent native child view.
  await player.evaluate(() => {
    document.documentElement.style.backgroundColor = 'var(--base)'
  })
  await player.getByRole('combobox', { name: '首选音质' }).click()
  await expect(player.getByRole('listbox')).toBeVisible()
  await player.screenshot({ path: path.join(evidence, 'quality-menu.png') })
  await player.getByRole('option', { name: 'flac', exact: true }).click()
  for (const label of ['选择手动下载目录', '选择推荐下载目录']) {
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
    }, evidence)
    await player.getByRole('button', { name: label, exact: true }).click()
  }
  await expect
    .poll(async () => {
      const p = await prefs()
      return [p.manualDir, p.recommendDir, p.quality]
    })
    .toEqual([evidence, evidence, 'flac'])
  await player.getByRole('button', { name: '模型设置' }).click()
  await player.getByRole('combobox', { name: '服务商' }).click()
  await expect(player.getByRole('listbox')).toBeVisible()
  await player.keyboard.press('Escape')
  await player.getByRole('button', { name: '取消', exact: true }).click()
  await player.locator('.music-scroll').evaluate((e) => {
    e.scrollTop = 0
  })
  await player.screenshot({ path: path.join(evidence, 'settings.png') })
  await player.getByRole('textbox', { name: '上一首', exact: true }).scrollIntoViewIfNeeded()
  await player.screenshot({ path: path.join(evidence, 'shortcuts.png') })
  await shell.getByRole('button', { name: 'Close Music', exact: true }).click()
  await expect
    .poll(() => app.evaluate(({ globalShortcut }, k) => globalShortcut.isRegistered(k), combo))
    .toBe(false)
  expect(
    await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Ctrl+Alt+F23')),
  ).toBe(true)
  player = await open()
  await player.getByRole('tab', { name: '设置', exact: true }).click()
  expect((await prefs()).shortcuts.toggle).toBe(combo)
  expect(await app.evaluate(({ globalShortcut }, k) => globalShortcut.isRegistered(k), combo)).toBe(
    true,
  )
  console.log(
    'PASS 设置目录、音质与原生快捷键注册／占用／后台传输／关闭释放／重开。证据：' + evidence,
  )
} finally {
  await app.close()
}
