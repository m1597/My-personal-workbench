import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import type { SerializedDockview } from 'dockview-react'

let app: ElectronApplication
let page: Page
let profile: string
let errors: string[]
const key = 'workbench.layout'

async function launch(count = 4) {
  app = await electron.launch({
    args: ['.', `--user-data-dir=${profile}`],
    env: {
      ...process.env,
      WORKBENCH_TEST_BACKGROUND: '1',
      ELECTRON_RENDERER_URL: process.env.WORKBENCH_TEST_RENDERER_URL ?? '',
    },
  })
  page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await expect(page.getByTestId('panel-count')).toHaveText(`${count} 个模块已打开`)
  expect(
    await app.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0]
      const bounds = window.getBounds()
      return (
        !window.isFocused() &&
        screen.getAllDisplays().every((display) => bounds.x + bounds.width <= display.bounds.x)
      )
    }),
  ).toBe(true)
}

async function restart(count = 4) {
  await app.close()
  await launch(count)
}

async function saved(): Promise<SerializedDockview> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).layout, key)
}

test.beforeEach(async ({}, info) => {
  profile = info.outputPath('profile')
  errors = []
  await launch()
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), key)).not.toBeNull()
})

test.afterEach(async ({}, info) => {
  try {
    expect(errors).toEqual([])
  } finally {
    try {
      if (page && !page.isClosed() && info.status !== info.expectedStatus) {
        await page.screenshot({ path: info.outputPath('failure.png'), animations: 'disabled' })
      }
    } finally {
      await app?.close()
    }
  }
})

test('位置、宽高、标签分组和活动标签跨次恢复', async ({}, info) => {
  const left = page.getByTestId('module-1')
  const initial = (await left.boundingBox())!
  let vertical = (await page.locator('.dv-sash.dv-enabled').all()).at(0)!
  for (const sash of await page.locator('.dv-sash.dv-enabled').all()) {
    const box = (await sash.boundingBox())!
    if (box.width < 10 && Math.abs(box.x - initial.x - initial.width) < 12) vertical = sash
  }
  const v = (await vertical.boundingBox())!
  await page.mouse.move(v.x + 2, v.y + 100)
  await page.mouse.down()
  await page.mouse.move(v.x + 82, v.y + 100, { steps: 12 })
  await page.mouse.up()
  await expect
    .poll(async () => (await left.boundingBox())!.width)
    .toBeGreaterThan(initial.width + 50)

  const bottom = page.getByTestId('module-4')
  const originalHeight = (await bottom.boundingBox())!.height
  for (const sash of await page.locator('.dv-sash.dv-enabled').all()) {
    const box = (await sash.boundingBox())!
    if (box.height < 10 && box.width > 100) {
      await page.mouse.move(box.x + 100, box.y + 2)
      await page.mouse.down()
      await page.mouse.move(box.x + 100, box.y - 55, { steps: 12 })
      await page.mouse.up()
      break
    }
  }
  await expect
    .poll(async () => (await bottom.boundingBox())!.height)
    .toBeGreaterThan(originalHeight + 30)
  const source = page.getByRole('tab', { name: '模块 3', exact: true })
  const target = page.getByRole('tab', { name: '模块 2', exact: true })
  await source.dragTo(target, {
    sourcePosition: { x: 25, y: 15 },
    targetPosition: { x: 25, y: 15 },
  })
  await expect(page.locator('.dv-groupview')).toHaveCount(3)
  await target.click()
  const beforeLeft = (await left.boundingBox())!
  const beforeBottom = (await bottom.boundingBox())!
  // No debounce wait: a normal close must flush the latest completed change.
  await restart()
  await expect(page.locator('.dv-groupview')).toHaveCount(3)
  const group = page
    .locator('.dv-groupview')
    .filter({ has: page.getByRole('tab', { name: '模块 2', exact: true }) })
  await expect(group.getByRole('tab', { name: '模块 3', exact: true })).toBeVisible()
  await expect(page.getByTestId('module-2')).toBeVisible()
  await expect(page.getByRole('button', { name: '显示模块 2', exact: true })).toHaveClass(
    /is-active/,
  )
  const afterLeft = (await page.getByTestId('module-1').boundingBox())!
  const afterBottom = (await page.getByTestId('module-4').boundingBox())!
  expect(Math.abs(afterLeft.width - beforeLeft.width)).toBeLessThan(3)
  expect(Math.abs(afterBottom.height - beforeBottom.height)).toBeLessThan(3)
  expect(Math.abs(afterBottom.y - beforeBottom.y)).toBeLessThan(3)
  await page.screenshot({ path: info.outputPath('restored-layout.png'), animations: 'disabled' })
})

test('关闭部分及全部模块保持状态，重置后持久恢复默认', async () => {
  const baseline = await saved()
  await page.getByRole('button', { name: 'Close 模块 4', exact: true }).click()
  await restart(3)
  await expect(page.getByRole('tab', { name: '模块 4', exact: true })).toHaveCount(0)
  for (const id of [1, 2, 3])
    await page.getByRole('button', { name: `Close 模块 ${id}`, exact: true }).click()
  await restart(0)
  await expect(page.getByRole('button', { name: '恢复默认布局' })).toBeVisible()
  expect(Object.keys((await saved()).panels)).toHaveLength(0)
  await page.getByRole('button', { name: '重置布局', exact: true }).click()
  await restart()
  await expect(page.locator('.dv-groupview')).toHaveCount(4)
  const restored = await saved()
  // Generated group ids can differ, but each panel's constraints must survive.
  expect(restored.panels).toEqual(baseline.panels)
  await expect(page.getByRole('button', { name: '显示模块 2', exact: true })).toHaveClass(
    /is-active/,
  )
})

test('最大化退出后恢复正常布局和原有宽高', async () => {
  await page.getByRole('button', { name: 'Close 模块 4', exact: true }).click()
  const panel = page.getByTestId('module-2')
  const before = (await panel.boundingBox())!
  await page
    .locator('.dv-groupview')
    .filter({ has: panel })
    .getByRole('button', { name: '最大化面板' })
    .click()
  await expect
    .poll(async () => (await panel.boundingBox())!.width)
    .toBeGreaterThan(before.width + 100)
  await restart(3)
  await expect(page.getByRole('button', { name: '还原面板' })).toHaveCount(0)
  const after = (await page.getByTestId('module-2').boundingBox())!
  expect(Math.abs(after.width - before.width)).toBeLessThan(3)
  expect(Math.abs(after.height - before.height)).toBeLessThan(3)
  expect((await saved()).grid).not.toHaveProperty('maximizedNode')
  await restart(3)
  const again = (await page.getByTestId('module-2').boundingBox())!
  expect(Math.abs(again.width - before.width)).toBeLessThan(3)
  expect(Math.abs(again.height - before.height)).toBeLessThan(3)
})

for (const bad of ['JSON 损坏', '版本不兼容', '未知模块', '结构损坏']) {
  test(`${bad}安全回退且可继续操作`, async () => {
    const layout = await saved()
    let value = JSON.stringify({ version: 1, layout })
    if (bad === 'JSON 损坏') value = '{invalid'
    if (bad === '版本不兼容') value = JSON.stringify({ version: 999, layout })
    if (bad === '未知模块') value = value.replaceAll('module-2', 'module-unknown')
    if (bad === '结构损坏')
      value = JSON.stringify({
        version: 1,
        layout: { ...layout, grid: { ...layout.grid, root: null } },
      })
    // Inject only in this isolated profile, after the application's close flush.
    await page.evaluate(
      ({ key, value }) => {
        window.addEventListener('beforeunload', () => localStorage.setItem(key, value), {
          once: true,
        })
      },
      { key, value },
    )
    await restart()
    for (let i = 1; i <= 4; i++) await expect(page.getByTestId(`module-${i}`)).toBeVisible()
    await page.getByRole('button', { name: 'Close 模块 4', exact: true }).click()
    await restart(3)
  })
}
