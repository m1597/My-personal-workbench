import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { recording } from '../components/music/offline-source.mjs'
const root = await mkdtemp(path.resolve('tmp/tray-playback-')),
  profile = path.join(root, 'profile')
const store = new MusicStore(path.join(profile, 'fitbay-music'))
const file = path.join(root, '连续播放.wav')
await writeFile(file, recording('fitbay-tone-1'))
store.library.upsert({ file, title: '连续播放', artist: '测试', album: '', duration: 20 })
store.set('music-guide-v1', 1)
store.db.close()
const app = await electron.launch({
  args: [
    path.resolve('dist/component-prototype/host'),
    '--mode=workbench',
    '--mute-audio',
    '--workbench=' + path.resolve('out/renderer/index.html'),
    '--user-data-dir=' + profile,
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
const shell = await app.firstWindow(),
  events = [],
  pid = await app.evaluate(() => process.pid)
const status = () => shell.evaluate(() => window.musicDock.status())
async function tray(label) {
  const labels = await app.evaluate(() => globalThis.testTrayMenu?.items.map((i) => i.label))
  assert.ok(labels.includes(label), String(labels))
  await app.evaluate((_electron, label) => {
    const action = globalThis.testTrayMenu.items.find((i) => i.label === label)
    setImmediate(() => action.click())
  }, label)
}
async function keep(on) {
  await shell.getByRole('button', { name: '工作台设置', exact: true }).press('Enter')
  await shell.getByRole('button', { name: '组件管理与更新', exact: true }).press('Enter')
  const details = shell.locator('.music-runtime-options')
  if ((await details.getAttribute('open')) === null) await details.locator('summary').click()
  const toggle = shell.getByRole('switch', { name: /Music.*后台|后台.*Music/ })
  if ((await toggle.isChecked()) !== on) await toggle.press('Space')
  await expect.poll(async () => (await status()).keepRunning).toBe(on)
  await shell.getByRole('button', { name: '关闭设置', exact: true }).press('Enter')
}
try {
  await app.evaluate(({ Tray, app, BaseWindow }) => {
    if (
      !app.commandLine.hasSwitch('mute-audio') ||
      BaseWindow.getAllWindows().some((w) => w.isFocusable())
    )
      throw Error('必须静音并使用后台桌面')
    const setMenu = Tray.prototype.setContextMenu
    Tray.prototype.setContextMenu = function (menu) {
      globalThis.testTrayMenu = menu
      return setMenu.call(this, menu)
    }
  })
  assert.equal((await status()).keepRunning, false)
  await shell.getByRole('button', { name: '打开 Music', exact: true }).press('Enter')
  await expect.poll(async () => (await status()).mode).toBe('docked')
  const player = app.windows().find((p) => p.url().includes('/music/index.html'))
  await player.getByRole('button', { name: '播放连续播放', exact: true }).press('Enter')
  await player.locator('audio').evaluate((a) => {
    a.loop = true
    window.originalAudio = a
    window.cuts = []
    for (const type of ['pause', 'emptied', 'error'])
      a.addEventListener(type, () => window.cuts.push(type))
  })
  const musicContents = () =>
    app.evaluate(({ webContents }) =>
      webContents
        .getAllWebContents()
        .filter((c) => c.getURL().includes('/music/index.html'))
        .map((c) => c.id),
    )
  const ids = await musicContents()
  assert.equal(ids.length, 1)
  async function advancing(stage) {
    const audio = player.locator('audio'),
      before = await audio.evaluate((a) => a.currentTime)
    await expect
      .poll(() =>
        audio.evaluate(
          (a) => !a.paused && a === window.originalAudio && !window.cuts.length && a.currentTime,
        ),
      )
      .toBeGreaterThan(before + 0.1)
    assert.deepEqual(await musicContents(), ids)
    events.push({
      stage,
      contents: ids[0],
      time: await audio.evaluate((a) => a.currentTime),
      status: await status(),
    })
  }
  await advancing('开始')
  await keep(true)
  await shell
    .locator('.dv-tab[data-tab-panel-id] .dv-default-tab-action')
    .first()
    .dispatchEvent('click')
  await expect.poll(async () => (await status()).presentation).toBe('background')
  await advancing('停靠标签 ×')
  await tray('显示 Music')
  await expect.poll(async () => (await status()).presentation).toBe('full')
  await advancing('托盘恢复停靠 Music')
  await shell.evaluate(() => window.musicDock.detach())
  await expect.poll(async () => (await status()).mode).toBe('standalone')
  await app.evaluate(({ BaseWindow }) =>
    BaseWindow.getAllWindows()
      .find((w) => w.getTitle() === 'Music')
      .close(),
  )
  await expect.poll(async () => (await status()).presentation).toBe('background')
  await advancing('独立窗口 ×')
  await tray('显示 Music')
  await advancing('托盘恢复独立 Music')
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.getTitle().includes('FitBay'))
      .close(),
  )
  await expect
    .poll(() =>
      app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().every((w) => !w.isVisible())),
    )
    .toBe(true)
  await advancing('关闭工作台')
  await tray('显示 FitBay')
  await tray('显示 Music')
  await advancing('两个窗口恢复')
  await keep(false)
  await app.evaluate(({ BaseWindow }) =>
    BaseWindow.getAllWindows()
      .find((w) => w.getTitle() === 'Music')
      .close(),
  )
  await expect.poll(musicContents).toEqual([])
  assert.equal((await status()).phase, 'stopped')
  events.push({ stage: '关闭选项后独立窗口 ×', contents: await musicContents() })
  await shell.evaluate(() => window.musicDock.open())
  const next = app.windows().find((p) => p.url().includes('/music/index.html'))
  await next.getByRole('button', { name: '播放连续播放', exact: true }).press('Enter')
  await expect
    .poll(() => next.locator('audio').evaluate((a) => !a.paused && a.currentTime > 0.1))
    .toBe(true)
  const ended = app.waitForEvent('close')
  await tray('退出 FitBay')
  await ended
  await expect
    .poll(() => {
      try {
        process.kill(pid, 0)
        return false
      } catch (e) {
        return e.code === 'ESRCH'
      }
    })
    .toBe(true)
  events.push({ stage: '托盘明确退出', pid, processExited: true })
  await writeFile(path.join(root, 'evidence.json'), JSON.stringify(events, null, 2))
  console.log(
    root,
    events.map((e) => [e.stage, e.time, e.contents]),
  )
} finally {
  await app.close().catch(() => {})
}
