import { _electron as electron, expect } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { recording } from '../components/music/offline-source.mjs'
import { MusicStore } from '../components/music/store.mjs'
const root = await mkdtemp(path.resolve('tmp/host-cross-entry-'))
const profile = path.join(root, 'profile')
const store = new MusicStore(path.join(profile, 'fitbay-music'))
const audio = recording('fitbay-tone-1')
for (let n = 0; n < 44; n++) {
  const file = path.join(root, n + '.wav')
  await writeFile(file, audio)
  store.library.upsert({ file, title: '巡检' + n, artist: 'FitBay', album: '测试', duration: 20 })
}
store.db.close()
const app = await electron.launch({
  args: [
    path.resolve('dist/component-prototype/host'),
    '--mode=workbench',
    '--workbench=' + path.resolve('out/renderer/index.html'),
    '--component=' + path.resolve('dist/component-prototype/component'),
    '--user-data-dir=' + profile,
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  const shell = await app.firstWindow()
  shell.setDefaultTimeout(7000)
  const button = (name) => shell.getByRole('button', { name, exact: true })
  const check = (name) => shell.getByRole('menuitemcheckbox', { name, exact: true })
  const gear = () => button('工作台设置').click()
  const snap = (name) =>
    shell.screenshot({
      path: path.join(root, name + '.png'),
      animations: 'disabled',
      style: ':root{background:#272d34!important}',
    })
  const menu = () => button('组件').click()
  await menu()
  const sample = check('示例组件')
  await expect(sample).not.toBeChecked()
  await expect(shell.getByLabel('隐藏示例组件', { exact: true })).toHaveAttribute(
    'title',
    '隐藏示例组件',
  )
  await sample.click()
  await expect
    .poll(() => shell.evaluate(async () => (await window.componentHost.status()).mode))
    .toBe('docked')
  await menu()
  await expect(sample).toBeChecked()
  await shell.getByLabel('隐藏示例组件', { exact: true }).click()
  await expect(shell.getByRole('tab', { name: '示例组件' })).toHaveCount(0)
  await menu()
  await expect(sample).toContainText('后台运行')
  await expect(sample).toBeChecked()
  await snap('后台组件菜单')
  await shell.keyboard.press('Escape')
  await gear()
  const search = shell.getByRole('searchbox')
  await search.fill('在工作台显示示例组件')
  await button('组件管理 › 在工作台显示示例组件').click()
  await expect(button('在工作台显示示例组件')).toBeFocused()
  await button('在工作台显示示例组件').click()
  await expect(shell.getByRole('tab', { name: '示例组件' })).toBeVisible()
  await menu()
  await sample.click()
  await expect(shell.getByRole('tab', { name: '示例组件' })).toHaveCount(0)
  await button('打开 Music').click()
  await expect
    .poll(() => app.windows().some((p) => p.url().includes('/music/index.html')))
    .toBe(true)
  const player = app.windows().find((p) => p.url().includes('/music/index.html'))
  await player.getByRole('tab', { name: '曲库', exact: true }).click()
  const scroll = player.locator('.music-scroll')
  await expect(scroll).toBeVisible()
  const initial = await scroll.evaluate((e) => {
    e.scrollTop = 260
    return e.scrollTop
  })
  expect(initial).toBeGreaterThan(0)
  const prior = await player.evaluate(() => performance.timeOrigin)
  const layout = () => shell.locator('.dv-tab').allTextContents()
  const before = await layout()
  for (let i = 0; i < 3; i++) {
    await gear()
    await expect(shell.locator('.docking-area')).toBeHidden()
    await button('关闭设置').click()
    await expect(shell.locator('.docking-area')).toBeVisible()
    expect(await scroll.evaluate((e) => e.scrollTop)).toBe(initial)
    expect(await layout()).toEqual(before)
  }
  expect(await player.evaluate(() => performance.timeOrigin)).toBe(prior)
  await gear()
  await button('组件管理').click()
  const keep = shell.getByRole('switch', { name: /Music/ })
  await keep.click()
  await expect(keep).toBeChecked()
  await button('关闭设置').click()
  await button('Close Music').click()
  await expect
    .poll(() => shell.evaluate(async () => (await window.musicDock.status()).presentation))
    .toBe('background')
  await menu()
  await expect(check('Music')).toBeChecked()
  await check('Music').click()
  await expect
    .poll(() => shell.evaluate(async () => (await window.musicDock.status()).phase))
    .toBe('stopped')
  await menu()
  await expect(check('Music')).not.toBeChecked()
  await shell.keyboard.press('Escape')
  await button('布局').click()
  await shell.getByRole('menuitem', { name: '管理布局' }).click()
  const name = '排版与素材核对 · '.repeat(8)
  await shell.getByRole('textbox', { name: '新布局名称' }).fill(name)
  await button('保存当前布局').click()
  await button('关闭布局').click()
  await expect(shell.locator('.toolbar-layout-name')).toHaveText(name.trim())
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(920, 680),
  )
  await expect(shell.locator('.toolbar-layout-name')).toBeHidden()
  await button('布局').click()
  await expect(shell.getByRole('menuitem', { name: name.trim(), exact: true })).toBeVisible()
  await snap('窄窗长布局名')
  const overflow = await shell.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  await writeFile(
    path.join(root, '检查.json'),
    JSON.stringify(
      {
        scroll: initial,
        menuStop: true,
        transitions: 3,
        longTitleLength: name.trim().length,
        overflow,
      },
      null,
      2,
    ),
  )
  console.log('PASS', root)
} finally {
  await app.close()
}
