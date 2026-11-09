import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import path from 'node:path'

let app: ElectronApplication
let page: Page
let errors: string[]
let profilePath: string

test.beforeEach(async ({}, testInfo) => {
  profilePath = testInfo.outputPath('profile')
  app = await electron.launch({
    args: ['.', `--user-data-dir=${profilePath}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: process.env.WORKBENCH_TEST_RENDERER_URL ?? '' }
  })
  page = await app.firstWindow()
  errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await expect(page.getByTestId('panel-count')).toHaveText('4 个模块已打开')
})

test.afterEach(async () => {
  try { expect(errors).toEqual([]) } finally { await app?.close() }
})

test('默认深色，切换同步原生主题且重启后保留选择', async () => {
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect.poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark')
  await expect.poll(() => page.evaluate(() => typeof window.workbench?.setTheme)).toBe('function')
  await page.getByRole('button', { name: '切换到浅色', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect.poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('light')
  await page.screenshot({ path: path.resolve('tmp/workbench-light.png') })
  await app.close()
  app = await electron.launch({ args: ['.', `--user-data-dir=${profilePath}`], env: { ...process.env, ELECTRON_RENDERER_URL: process.env.WORKBENCH_TEST_RENDERER_URL ?? '' } })
  page = await app.firstWindow()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect.poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('light')
  await page.getByRole('button', { name: '切换到深色', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect.poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark')
})

test('四个模块可见，最小窗口保持可用，渲染进程隔离', async () => {
  for (let i = 1; i <= 4; i++) await expect(page.getByTestId(`module-${i}`)).toBeVisible()
  expect(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe('undefined')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 720))
  for (let i = 1; i <= 4; i++) await expect(page.getByTestId(`module-${i}`)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: '操作帮助', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
})

test('鼠标拖动分隔线改变模块宽度和高度', async () => {
  const first = page.getByTestId('module-1')
  const before = (await first.boundingBox())!
  const sashes = page.locator('.dv-sash.dv-enabled')
  let vertical: { x: number; y: number; width: number; height: number } | undefined
  for (const sash of await sashes.all()) {
    const box = await sash.boundingBox()
    if (box && box.width < 10 && Math.abs(box.x - (before.x + before.width)) < 12) vertical = box
  }
  expect(vertical).toBeDefined()
  await page.mouse.move(vertical!.x + 2, vertical!.y + 120)
  await page.mouse.down()
  await page.mouse.move(vertical!.x + 92, vertical!.y + 120, { steps: 15 })
  await page.mouse.up()
  await expect.poll(async () => (await first.boundingBox())!.width).toBeGreaterThan(before.width + 60)

  const bottom = page.getByTestId('module-4')
  const bottomBefore = (await bottom.boundingBox())!
  let horizontal: typeof vertical
  for (const sash of await sashes.all()) {
    const box = await sash.boundingBox()
    if (box && box.height < 10 && box.width > 100) horizontal = box
  }
  expect(horizontal).toBeDefined()
  await page.mouse.move(horizontal!.x + 100, horizontal!.y + 2)
  await page.mouse.down()
  await page.mouse.move(horizontal!.x + 100, horizontal!.y - 65, { steps: 15 })
  await page.mouse.up()
  await expect.poll(async () => (await bottom.boundingBox())!.height).toBeGreaterThan(bottomBefore.height + 40)
})

test('拖拽模块合并标签，再拖到边缘分屏', async () => {
  const source = page.getByRole('tab', { name: '模块 4', exact: true })
  const target = page.getByRole('tab', { name: '模块 2', exact: true })
  await source.dragTo(target, { sourcePosition: { x: 25, y: 15 }, targetPosition: { x: 25, y: 15 } })
  await expect(page.locator('.dv-groupview')).toHaveCount(3)
  await expect(page.getByTestId('module-4')).toBeVisible()
  await target.click()
  await expect(page.getByTestId('module-2')).toBeVisible()
  const canvas = page.locator('.dv-groupview').filter({ has: target })
  const rect = (await canvas.boundingBox())!
  await source.dragTo(canvas, { sourcePosition: { x: 25, y: 15 }, targetPosition: { x: rect.width / 2, y: rect.height - 10 } })
  await expect(page.locator('.dv-groupview')).toHaveCount(4)
  await expect(page.getByTestId('module-2')).toBeVisible()
  await expect(page.getByTestId('module-4')).toBeVisible()
})

test('关闭重开、最大化还原、空工作区恢复', async () => {
  await page.getByRole('button', { name: 'Close 模块 4', exact: true }).click()
  await expect(page.getByTestId('panel-count')).toHaveText('3 个模块已打开')
  await page.getByRole('button', { name: '窗口', exact: true }).click()
  await page.locator('#window-menu').getByRole('button', { name: '模块 4', exact: true }).click()
  await expect(page.getByTestId('panel-count')).toHaveText('4 个模块已打开')
  await page.getByRole('button', { name: '重置布局', exact: true }).click()
  const group = page.locator('.dv-groupview').filter({ has: page.getByTestId('module-2') })
  const originalWidth = (await page.getByTestId('module-2').boundingBox())!.width
  await group.getByRole('button', { name: '最大化面板', exact: true }).click()
  await expect.poll(async () => (await page.getByTestId('module-2').boundingBox())!.width).toBeGreaterThan(originalWidth + 100)
  await group.getByRole('button', { name: '还原面板', exact: true }).click()
  for (let i = 1; i <= 4; i++) await page.getByRole('button', { name: `Close 模块 ${i}`, exact: true }).click()
  await expect(page.getByTestId('panel-count')).toHaveText('0 个模块已打开')
  await page.getByRole('button', { name: '恢复默认布局', exact: true }).click()
  await expect(page.getByTestId('panel-count')).toHaveText('4 个模块已打开')
  await page.mouse.move(0, 0)
  await page.screenshot({ path: path.resolve('tmp/workbench-verified.png') })
})
