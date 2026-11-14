import { openMusicSettings, selectMusicSettings } from './music-settings-fixture.mjs'
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
const launch = () =>
  electron.launch({
    args: [
      path.resolve('dist/component-prototype/host'),
      '--mode=workbench',
      '--workbench=' + path.resolve('out/renderer/index.html'),
      '--user-data-dir=' + profile,
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
let app = await launch()
try {
  expect(await app.evaluate(({ app }) => app.commandLine.hasSwitch('mute-audio'))).toBe(true)
  let shell = await app.firstWindow()
  await app.evaluate(({ globalShortcut }) => {
    globalThis.testMusicCallbacks = new Map()
    globalThis.testMediaAttempts = new Map()
    const register = globalShortcut.register.bind(globalShortcut)
    // Exercise Electron's real OS registration without injecting keystrokes into the user's desktop.
    globalShortcut.register = (key, callback) => {
      if (key.startsWith('Media')) globalThis.testMediaAttempts.set(key, callback)
      const ok = register(key, callback)
      if (ok) globalThis.testMusicCallbacks.set(key, callback)
      return ok
    }
    if (!register('Ctrl+Alt+Shift+F12', () => {})) throw Error('测试冲突键无法预占')
  })
  const open = async () => {
    await shell.getByRole('button', { name: '组件', exact: true }).click()
    await shell.getByRole('menuitemcheckbox', { name: 'Music', exact: true }).click()
    await expect
      .poll(() => app.windows().some((p) => p.url().includes('/music/index.html')))
      .toBe(true)
    return app.windows().find((p) => p.url().includes('/music/index.html'))
  }
  let player = await open()
  await player.getByRole('button', { name: '跳过', exact: true }).click()
  await player.waitForSelector('.music-shell', { timeout: 5000 })
  // Supply the same opaque fallback used beneath the transparent native child view.
  await player.evaluate(() => {
    document.documentElement.style.backgroundColor = 'var(--base)'
  })
  const loaded = await player.evaluate(() => window.music.state())
  expect(loaded.localTracks.map((row) => row.title)).toEqual(['A', 'B', 'C'])
  await player.getByRole('button', { name: '播放A', exact: true }).click({ timeout: 5000 })
  await openMusicSettings(player)
  await expect(player.locator('.music-settings h2')).toHaveText([
    '本地曲库',
    '曲库整理',
    '曲库管理',
  ])
  for (const name of ['音乐源', 'MCP', '下载', '模型与推荐', '快捷键']) {
    await selectMusicSettings(player, name)
    await expect(player.locator('.music-settings h2')).toHaveText([
      name === 'MCP' ? '外部 Agent 连接（可选）' : name,
    ])
    if (name === '音乐源') await expect(player.getByText('复制启动命令')).toHaveCount(0)
    if (name === 'MCP') {
      // Capture this action without overwriting the user's Windows clipboard.
      await app.evaluate(({ clipboard }) => {
        clipboard.writeText = (value) => {
          globalThis.testMcpCommand = value
        }
      })
      await player.getByText('手动配置其他 Agent').click()
      await player.getByRole('button', { name: '复制启动命令' }).click()
      await expect(player.getByRole('status')).toContainText('已复制启动命令')
      expect(await app.evaluate(() => globalThis.testMcpCommand)).toBe(
        await player.locator('.music-mcp-connection code').textContent(),
      )
      await player.screenshot({ path: path.join(evidence, 'mcp-settings.png') })
    }
  }
  await expect(player.getByLabel('手动输入组合键')).toHaveCount(0)
  for (const input of await player.locator('.settings-shortcut input').all())
    await expect(input).toHaveAttribute('readonly', '')
  const prefs = () => player.evaluate(async () => (await window.music.state()).prefs)
  await player.getByLabel('启用全局快捷键').check()
  const combo = 'Ctrl+Alt+Shift+F10'
  const record = async (label, accelerator) => {
    const field = player.getByRole('textbox', { name: label, exact: true })
    await field.click()
    await player.keyboard.press(accelerator.replace('Ctrl+', 'Control+'))
    await expect(field).toHaveValue(accelerator)
  }
  await record('播放 / 暂停', combo)
  await player.getByRole('button', { name: '保存播放 / 暂停快捷键' }).click()
  await expect.poll(async () => (await prefs()).shortcuts.toggle).toBe(combo)
  const toggle = player.getByRole('textbox', { name: '播放 / 暂停', exact: true })
  await toggle.click()
  await player.keyboard.press('Escape')
  await expect(toggle).toHaveValue(combo)
  await expect(player.getByRole('button', { name: '保存播放 / 暂停快捷键' })).toBeDisabled()
  await record('播放 / 暂停', 'Ctrl+Alt+Shift+F12')
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
  const mode = player.locator('.music-order')
  await mode.click()
  await mode.click()
  await expect(mode).toHaveText('单曲循环')
  const unavailableKeys = (await prefs()).shortcutFailures
  for (const [binding, title] of [
    ['MediaNextTrack', 'B'],
    ['MediaPreviousTrack', 'A'],
  ]) {
    if (unavailableKeys.includes(binding)) {
      console.log('系统键被占用，仅调用 FitBay 提交的媒体回调', binding)
      await app.evaluate((_, k) => globalThis.testMediaAttempts.get(k)(), binding)
    } else await key(binding)
    await expect(player.locator('.music-transport strong')).toHaveText(title)
  }
  const paused = () => player.locator('audio').evaluate((a) => a.paused)
  await key(combo)
  await expect.poll(paused).toBe(true)
  await key(combo)
  await expect.poll(paused).toBe(false)
  for (const [label, acc, expected] of [
    ['下一首', 'Ctrl+Alt+Shift+F9', 'B'],
    ['上一首', 'Ctrl+Alt+Shift+F8', 'A'],
  ]) {
    await record(label, acc)
    await player.getByRole('button', { name: '保存' + label + '快捷键' }).click()
    await key(acc)
    await expect(player.locator('.music-transport strong')).toHaveText(expected)
  }
  expect(
    await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().some((w) => w.isFocused())),
  ).toBe(false)
  await selectMusicSettings(player, '下载')
  await player.getByRole('combobox', { name: '下载音质' }).click()
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
  await selectMusicSettings(player, '模型与推荐')
  await player.getByRole('button', { name: '模型设置' }).click()
  await player.getByRole('combobox', { name: '服务商' }).click()
  await expect(player.getByRole('listbox')).toBeVisible()
  await player.keyboard.press('Escape')
  await player.getByRole('button', { name: '取消', exact: true }).click()
  await player.locator('.music-scroll').evaluate((e) => {
    e.scrollTop = 0
  })
  await player.screenshot({ path: path.join(evidence, 'settings.png') })
  await selectMusicSettings(player, '快捷键')
  await player.getByRole('textbox', { name: '上一首', exact: true }).scrollIntoViewIfNeeded()
  await player.screenshot({ path: path.join(evidence, 'shortcuts.png') })
  await app.evaluate(({ BrowserWindow }) => {
    const shell = BrowserWindow.getAllWindows()[0]
    shell.setMinimumSize(380, 480)
    shell.setContentSize(440, 620)
  })
  const categories = player.getByRole('navigation', { name: '设置分类', includeHidden: true })
  await expect(categories).toBeHidden()
  await player.getByRole('button', { name: '设置分类', exact: true }).click()
  await expect(categories.getByRole('button')).toHaveText([
    '本地曲库',
    '音乐源',
    'MCP',
    '下载',
    '模型与推荐',
    '歌词',
    '播放',
    '快捷键',
    '插件',
  ])
  await player.screenshot({
    path: path.join(evidence, 'settings-narrow-menu.png'),
    animations: 'disabled',
  })
  await categories.getByRole('button', { name: '下载', exact: true }).click()
  await expect(categories).toBeHidden()
  await expect(player.locator('.music-settings h2')).toHaveText(['下载'])
  await expect(player.locator('.music-settings')).toBeInViewport()
  await shell.getByRole('button', { name: 'Close Music', exact: true }).click()
  await expect
    .poll(() => app.evaluate(({ globalShortcut }, k) => globalShortcut.isRegistered(k), combo))
    .toBe(false)
  expect(
    await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Ctrl+Alt+Shift+F12')),
  ).toBe(true)
  await app.close()
  app = await launch()
  shell = await app.firstWindow()
  player = await open()
  await openMusicSettings(player)
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
