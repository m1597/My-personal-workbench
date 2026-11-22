import { _electron as electron, expect } from '@playwright/test'
import { mkdtemp, writeFile, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { recording } from '../components/music/offline-source.mjs'
import { MusicStore } from '../components/music/store.mjs'
const root = await mkdtemp(path.join(await realpath('tmp'), 'tray-'))
const profile = path.join(root, 'profile'),
  file = path.join(root, '后台.wav')
await writeFile(file, recording('fitbay-tone-1'))
const store = new MusicStore(path.join(profile, 'fitbay-music'))
store.set('music-guide-v1', '1')
store.set('lx-bootstrap', 'done')
store.library.upsert({ file, title: '后台', artist: 'FitBay', album: '', duration: 20 })
store.db.close()
const host = path.resolve('dist/component-prototype/host')
const probe = path.join(root, 'observe-tray.cjs')
await writeFile(
  probe,
  `
const {Tray}=require('electron')
const original=Tray.prototype.setContextMenu
const destroy=Tray.prototype.destroy
Tray.prototype.destroy=function(){const result=destroy.call(this);require('node:fs').writeFileSync(require('node:path').join(__dirname,'quit.json'),JSON.stringify([...global.trayProof.icons].map(i=>i.isDestroyed())));return result}
global.trayProof={icons:new Set(),menu:null}
Tray.prototype.setContextMenu=function(menu){global.trayProof.icons.add(this);global.trayProof.menu=menu;return original.call(this,menu)}
`,
)
let app, shell
async function launch(mode = 'workbench') {
  app = await electron.launch({
    args: [
      '--require',
      probe,
      host,
      '--mode=' + mode,
      ...(mode === 'workbench' ? ['--workbench=' + path.resolve('out/renderer/index.html')] : []),
      '--component=' + path.resolve('dist/component-prototype/component'),
      '--user-data-dir=' + profile,
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
  shell = await app.firstWindow()
  shell.setDefaultTimeout(5000)
}
const b = (name) => shell.getByRole('button', { name, exact: true })
const sw = (name) => shell.getByRole('switch', { name: new RegExp(name) })
const state = () =>
  app.evaluate(() => ({
    count: global.trayProof.icons.size,
    alive: [...global.trayProof.icons].filter((t) => !t.isDestroyed()).length,
    menu: global.trayProof.menu.items.map((i) => i.label),
  }))
async function settings() {
  await b('工作台设置').click()
  if (await shell.locator('.category-toggle').isVisible())
    await shell.locator('.category-toggle').click()
  await b('组件管理').click()
}
const clickTray = () => app.evaluate(() => [...global.trayProof.icons][0].emit('click'))
const menuAction = (name) =>
  app.evaluate((_, name) => global.trayProof.menu.items.find((i) => i.label === name).click(), name)
const shellVisible = () =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())
const closeWindow = () =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
try {
  await launch()
  await expect.poll(async () => (await state()).alive).toBe(1)
  await settings()
  await expect(sw('Music')).not.toBeChecked()
  await sw('Music').click()
  await expect(sw('Music')).toBeChecked()
  await expect(sw('示例组件')).not.toBeChecked()
  await shell.screenshot({
    path: path.join(root, '后台开关.png'),
    animations: 'disabled',
    style: ':root{background:#20242b!important}',
  })
  await b('关闭设置').click()
  await b('打开 Music').click()
  await expect
    .poll(() => app.windows().some((p) => p.url().includes('/music/index.html')))
    .toBe(true)
  const player = app.windows().find((p) => p.url().includes('/music/index.html'))
  await player.getByRole('tab', { name: '曲库', exact: true }).click()
  await player.getByRole('button', { name: '播放后台', exact: true }).click()
  await player.locator('audio').evaluate((a) => {
    globalThis.original = a
    a.loop = true
    globalThis.stops = 0
    a.addEventListener('pause', () => globalThis.stops++)
  })
  const playing = async () => {
    const read = () => player.locator('audio').evaluate((a) => a.currentTime)
    const before = await read()
    await expect.poll(read).not.toBe(before)
    expect(
      await player
        .locator('audio')
        .evaluate((a) => a === globalThis.original && !a.paused && !globalThis.stops),
    ).toBe(true)
  }
  const tab = shell.getByRole('tab', { name: 'Music', exact: true })
  for (let n = 0; n < 2; n++) {
    await b('Close Music').click()
    await expect(tab).toHaveCount(0)
    await expect.poll(async () => (await state()).menu).toContain('显示 Music')
    await playing()
    await menuAction('显示 Music')
    await expect(tab).toBeVisible()
    await closeWindow()
    await expect.poll(shellVisible).toBe(false)
    await playing()
    await clickTray()
    await expect.poll(shellVisible).toBe(true)
    await expect(tab).toBeVisible()
    await playing()
    expect(await state()).toMatchObject({ count: 1, alive: 1 })
  }
  await settings()
  await sw('示例组件').click()
  await expect(sw('示例组件')).toBeChecked()
  await b('关闭设置').click()
  await b('组件').click()
  await shell.getByRole('menuitemcheckbox', { name: '示例组件', exact: true }).click()
  await expect
    .poll(() =>
      shell.evaluate(async () => {
        const s = await window.componentHost.status()
        return s.mode + ' ' + s.phase
      }),
    )
    .toBe('docked ready')
  await b('布局').click()
  await shell.getByRole('menuitem', { name: '左右并排' }).click()
  const geometry = () =>
    shell
      .locator('.dv-groupview')
      .evaluateAll((list) =>
        list.map((e) => [e.offsetLeft, e.offsetTop, e.offsetWidth, e.offsetHeight, e.textContent]),
      )
  const before = await geometry()
  expect(before).toHaveLength(2)
  await closeWindow()
  await expect.poll(shellVisible).toBe(false)
  await playing()
  await expect.poll(async () => (await state()).menu).toContain('显示 示例组件')
  await clickTray()
  await expect.poll(shellVisible).toBe(true)
  expect(await geometry()).toEqual(before)
  await b('Close 示例组件').click()
  await settings()
  await sw('Music').click()
  await expect(sw('Music')).not.toBeChecked()
  await b('关闭设置').click()
  await b('Close Music').click()
  await expect.poll(() => player.isClosed()).toBe(true)
  await b('示例组件').click()
  await b('Close 示例组件').click()
  await expect.poll(async () => (await state()).menu).toContain('显示 示例组件')
  await menuAction('显示 示例组件')
  await expect(shell.getByRole('tab', { name: '示例组件' })).toBeVisible()
  const proof = path.join(root, 'quit.json')
  const exited = app.waitForEvent('close')
  await menuAction('退出 FitBay').catch(() => {})
  await exited
  expect(JSON.parse(await readFile(proof, 'utf8'))).toEqual([true])
  await launch()
  await settings()
  await expect(sw('Music')).not.toBeChecked()
  await expect(sw('示例组件')).toBeChecked()
  await sw('Music').click()
  await expect(sw('Music')).toBeChecked()
  await app.close()
  for (const [mode, name] of [
    ['music', 'Music'],
    ['component', '示例组件'],
  ]) {
    await launch(mode)
    const standalone = shell
    await expect.poll(async () => (await state()).alive).toBe(1)
    expect((await state()).menu).not.toContain('显示 FitBay')
    await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].close())
    await expect.poll(async () => (await state()).menu).toContain('显示 ' + name)
    expect(standalone.isClosed()).toBe(false)
    await clickTray()
    await expect
      .poll(() => app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].isVisible()))
      .toBe(true)
    expect(await state()).toMatchObject({ count: 1, alive: 1 })
    const exited = app.waitForEvent('close')
    await menuAction('退出 FitBay').catch(() => {})
    await exited
  }
  console.log('PASS', root)
} finally {
  await app?.close().catch(() => {})
}
