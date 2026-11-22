import { chromium, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
const profile = path.resolve(process.argv[2])
const port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0]
const browser = await chromium.connectOverCDP('http://127.0.0.1:' + Number(port))
try {
  const page = browser
    .contexts()[0]
    .pages()
    .find((p) => p.url().includes('/out/renderer/index.html'))
  const b = (n) => page.getByRole('button', { name: n, exact: true })
  const openMenu = () => b('组件').click()
  await openMenu()
  await expect(page.getByRole('menuitem', { name: '隐藏工具集', exact: true })).toBeDisabled()
  await page.getByRole('menuitemcheckbox', { name: '工具集', exact: true }).click()
  await openMenu()
  await page.getByRole('menuitem', { name: '隐藏工具集', exact: true }).click()
  await openMenu()
  await page.getByRole('menuitem', { name: '显示工具集', exact: true }).click()
  await expect(page.locator('[data-tab-panel-id="component-toolkit"]')).toBeVisible()
  await openMenu()
  await expect(page.getByRole('menuitemcheckbox', { name: '工具集', exact: true })).toContainText(
    '显示中',
  )
  await page.keyboard.press('Escape')
  await openMenu()
  await page.getByRole('menuitemcheckbox', { name: '提示词库', exact: true }).click()
  const promptTab = page.locator('.dv-tab[data-tab-panel-id="component-prompts"]')
  await expect(promptTab).toBeVisible()
  const sash = await page.locator('.dv-sash.dv-enabled:visible').first().boundingBox()
  const initial = await promptTab.boundingBox()
  const area = await page.locator('.dockview-theme-workbench').boundingBox()
  const right = initial.x > sash.x
  await page.mouse.move(sash.x + sash.width / 2, sash.y + sash.height / 2)
  await page.mouse.down()
  await page.mouse.move(right ? area.x + area.width - 2 : area.x + 2, sash.y + sash.height / 2, {
    steps: 10,
  })
  await page.mouse.up()
  const promptGroup = page.locator('.dv-groupview').filter({ has: promptTab })
  await expect.poll(() => promptGroup.evaluate((g) => g.clientWidth)).toBe(0)
  await openMenu()
  await page.getByRole('menuitem', { name: '显示提示词库', exact: true }).click()
  await expect.poll(() => promptGroup.evaluate((g) => g.clientWidth)).toBeGreaterThan(100)
  await b('工作台设置').click()
  await b('更新').click()
  await expect(page.locator('.update-row')).toHaveCount(4)
  await expect(page.getByText('开发构建仅支持检查版本', { exact: true })).toHaveCount(1)
  console.log('PASS desktop launcher', profile)
} finally {
  const session = await browser.newBrowserCDPSession()
  await session.send('Browser.close').catch(() => {})
  await browser.close()
}
