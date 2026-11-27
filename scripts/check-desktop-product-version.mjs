import { chromium, expect } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const profile = path.resolve(process.argv[2])
const manifest = JSON.parse(await readFile('package.json', 'utf8'))
const [port] = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)
const browser = await chromium.connectOverCDP('http://127.0.0.1:' + Number(port))
try {
  const workbench = () =>
    browser
      .contexts()[0]
      .pages()
      .find((page) => page.url().includes('/out/renderer/index.html'))
  await expect.poll(() => Boolean(workbench()), { timeout: 20000 }).toBe(true)
  const page = workbench()
  const button = (name) => page.getByRole('button', { name, exact: true })
  await button('工作台设置').click()
  await button('更新').click()
  const host = page.locator('.update-row').first()
  await expect(host).toContainText('产品开发构建 ' + manifest.version)
  await expect(host).not.toContainText('已安装版本')
  await button('检查全部更新').click()
  await expect(host).toContainText(/最新正式版 \d+\.\d+\.\d+/, { timeout: 30000 })
  await expect(button('更新 FitBay')).toHaveCount(0)
  await expect(button('更新全部')).toHaveCount(0)
  await expect(page.getByText('开发构建仅支持检查版本', { exact: true })).toBeVisible()
  const summary = {
    entry: 'open-workbench.cmd --verify-desktop',
    host: await host.locator('p').first().textContent(),
  }
  await writeFile(path.join(profile, 'version.json'), JSON.stringify(summary, null, 2))
  await page.screenshot({ path: path.join(profile, 'version.png') })
  console.log('PASS', summary, profile)
} finally {
  const session = await browser.newBrowserCDPSession()
  await session.send('Browser.close').catch(() => {})
  await browser.close()
}
