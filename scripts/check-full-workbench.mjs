import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, writeFile, cp } from 'node:fs/promises'
import path from 'node:path'
import { recording } from '../components/music/offline-source.mjs'
import { MusicStore } from '../components/music/store.mjs'
await mkdir('tmp', { recursive: true })
const root = await mkdtemp(path.resolve('tmp/full-workbench-'))
const profile = path.join(root, 'profile')
const example = path.join(root, 'installed-sample')
const file = path.join(root, '测试.wav')
const wav = recording('fitbay-tone-1')
await writeFile(file, wav)
const store = new MusicStore(path.join(profile, 'fitbay-music'))
store.library.upsert({ file, title: '测试', artist: 'FitBay', album: '', duration: 20 })
store.db.close()
let app, shell
const report = {}
const button = (name) => shell.getByRole('button', { name, exact: true })
const item = (name) => shell.getByRole('menuitem', { name, exact: true })
const click = async (name) => button(name).click()
const layout = async (name) => {
  await click('布局')
  await item(name).click()
}
const gear = () => click('工作台设置')
const shot = (name) =>
  shell.screenshot({
    path: path.join(root, name + '.png'),
    animations: 'disabled',
    style: ':root{background:#20242b!important}',
  })
async function launch(host = path.resolve('dist/component-prototype/host'), userProfile = profile) {
  app = await electron.launch({
    args: [
      host,
      '--mode=workbench',
      '--workbench=' + path.resolve('out/renderer/index.html'),
      '--component=' + example,
      '--user-data-dir=' + userProfile,
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
  shell = await app.firstWindow()
  shell.setDefaultTimeout(5500)
}
const resize = (width) =>
  app.evaluate(
    ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 740),
    width,
  )
const tabs = () => shell.locator('.dv-tab[data-tab-panel-id]')
const activeViews = () =>
  app.evaluate(
    ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].contentView.children.filter((v) => v.getVisible()).length,
  )
async function startPolicy(option) {
  await gear()
  await click('布局与启动')
  await shell.getByRole('combobox', { name: '启动时打开' }).click()
  await shell.getByRole('option', { name: option, exact: true }).click()
  await click('关闭设置')
}
try {
  await launch()
  await resize(1180)
  await shell.locator('.fitbay-brand').evaluate(async (e) => {
    await document.fonts.ready
    if (
      !document.fonts.check('18px Lobster') ||
      getComputedStyle(e).fontFamily !== 'Lobster, cursive'
    )
      throw Error('Brand font')
  })
  report.toolbarHeight = await shell
    .locator('.app-header')
    .evaluate((e) => e.getBoundingClientRect().height)
  expect(report.toolbarHeight).toBe(40)
  await expect(shell.getByRole('heading', { name: '快速开始' })).toBeVisible()
  await expect(button('示例组件')).toHaveCount(0)
  await cp(path.resolve('dist/component-prototype/component'), example, { recursive: true })
  await expect(button('示例组件')).toBeVisible({ timeout: 8000 })
  await shot('快速开始')
  await click('打开 Music')
  await expect(tabs()).toHaveCount(1)
  await click('布局')
  await expect(item('左右并排')).toHaveCount(0)
  await shell.keyboard.press('Escape')
  const player = app.windows().find((p) => p.url().includes('/music/index.html'))
  await player.getByRole('tab', { name: '曲库', exact: true }).click()
  await player.getByRole('button', { name: '播放测试', exact: true }).click()
  await player.locator('audio').evaluate((a) => {
    window.testAudio = a
    a.loop = true
    window.interruptions = []
    for (const ev of ['pause', 'emptied'])
      a.addEventListener(ev, () => window.interruptions.push(ev))
  })
  const time = () => player.locator('audio').evaluate((a) => a.currentTime)
  const playing = async () => {
    const before = await time()
    await expect.poll(time).not.toBe(before)
    expect(
      await player
        .locator('audio')
        .evaluate((a) => !a.paused && a === window.testAudio && !window.interruptions.length),
    ).toBe(true)
  }
  await playing()
  await gear()
  await expect.poll(activeViews).toBe(0)
  await shot('宽窗外观')
  const search = shell.getByRole('searchbox')
  await search.fill('字号')
  await click('外观 › 字号')
  await expect(shell.getByRole('combobox', { name: '字号', exact: true })).toBeFocused()
  for (const slider of await shell.getByRole('slider').all()) {
    await slider.press('Home')
    await slider.press('ArrowRight')
    await expect(slider).toHaveValue('1')
  }
  await click('恢复默认')
  for (const slider of await shell.getByRole('slider').all())
    await expect(slider).toHaveValue('100')
  await playing()
  await click('关闭设置')
  await expect.poll(activeViews).toBe(1)
  await click('组件')
  await item('隐藏 Music').click()
  await playing()
  await click('组件')
  await expect(shell.getByRole('menuitemcheckbox', { name: 'Music' })).toContainText('后台运行')
  await shell.keyboard.press('Escape')
  await click('打开 Music')
  await playing()
  await expect(tabs()).toHaveCount(1)
  await click('组件')
  await shell.getByRole('menuitemcheckbox', { name: '示例组件', exact: true }).click()
  await expect(tabs()).toHaveCount(2)
  for (const [name, axis] of [
    ['左右并排', 'width'],
    ['上下并排', 'height'],
  ]) {
    await layout(name)
    await expect(shell.locator('.dv-groupview')).toHaveCount(2)
    const sash = shell.locator('.dv-sash.dv-enabled').filter({ visible: true }).first()
    const box = await sash.boundingBox()
    const vertical = axis === 'width'
    expect(vertical ? box.width < 12 : box.height < 12).toBe(true)
    const group = shell.locator('.dv-groupview').first()
    const prior = (await group.boundingBox())[axis]
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2
    await shell.mouse.move(x, y)
    await shell.mouse.down()
    await shell.mouse.move(x + (vertical ? 55 : 0), y + (vertical ? 0 : 55), { steps: 12 })
    await shell.mouse.up()
    await expect
      .poll(async () => Math.abs((await group.boundingBox())[axis] - prior))
      .toBeGreaterThan(20)
  }
  await layout('管理布局')
  await shell.getByRole('textbox', { name: '新布局名称' }).fill('双组件')
  await click('保存当前布局')
  await click('关闭布局')
  await expect(shell.locator('.toolbar-layout-name')).toHaveText('双组件')
  await gear()
  await click('组件管理')
  await expect(shell.getByRole('heading', { name: '示例组件' })).toBeVisible()
  await click('刷新')
  await shot('组件管理')
  await click('布局与启动')
  await click('切换到空白工作台')
  await expect(tabs()).toHaveCount(0)
  await playing()
  await layout('双组件')
  await expect(tabs()).toHaveCount(2)
  await expect.poll(activeViews).toBe(2)
  await playing()
  await resize(920)
  await expect(shell.locator('.toolbar-layout-name')).toBeHidden()
  await expect(button('组件')).toBeVisible()
  await expect(button('布局')).toBeVisible()
  await gear()
  await shell.locator('.category-toggle').click()
  await shot('窄窗分类展开')
  await click('布局与启动')
  await shell.getByRole('combobox').click()
  await shot('窄窗启动选项')
  await shell.keyboard.press('Escape')
  await search.fill('音乐设置')
  await click('组件管理 › 打开音乐设置')
  await click('打开音乐设置')
  await expect(player.locator('.music-settings')).toBeVisible()
  await playing()
  await resize(1180)
  report.playback = await player.locator('audio').evaluate((a) => ({
    time: a.currentTime,
    same: a === window.testAudio,
    interruptions: window.interruptions,
  }))
  for (const [policy, count] of [
    ['上次工作区', 2],
    ['空白工作台', 0],
    ['双组件', 2],
  ]) {
    await startPolicy(policy)
    await app.close()
    await launch()
    await expect(tabs()).toHaveCount(count)
    if (count) await expect.poll(activeViews).toBe(2)
  }
  await shot('宽窗恢复布局')
  await app.close()
  const isolatedHost = path.join(root, 'isolated/host')
  await cp(path.resolve('dist/component-prototype/host'), isolatedHost, { recursive: true })
  await launch(isolatedHost, path.join(root, 'isolated-profile'))
  await resize(1180)
  await expect(button('添加组件')).toBeVisible()
  await gear()
  await click('组件管理')
  await expect(shell.getByText('未安装', { exact: true })).toBeVisible()
  await expect(button('打开音乐设置')).toBeDisabled()
  await shot('未安装Music')
  await click('关闭设置')
  await cp(path.resolve('dist/component-prototype/music'), path.join(root, 'isolated/music'), {
    recursive: true,
  })
  await expect(button('打开 Music')).toBeVisible({ timeout: 8000 })
  await click('打开 Music')
  await expect(tabs()).toHaveCount(1)
  report.lateMusic = true
  await writeFile(path.join(root, '验收.json'), JSON.stringify(report, null, 2))
  console.log('PASS', root, report)
} finally {
  await app?.close()
}
