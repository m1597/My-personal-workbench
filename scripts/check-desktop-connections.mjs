import { chromium, expect } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
const dir = path.resolve(process.argv[2])
const [port] = (await readFile(path.join(dir, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)
const browser = await chromium.connectOverCDP('http://127.0.0.1:' + Number(port))
try {
  const page = browser
    .contexts()[0]
    .pages()
    .find((p) => p.url().includes('/out/renderer/index.html'))
  const b = (name) => page.getByRole('button', { name, exact: true })
  await b('工作台设置').click()
  await b('API 与模型').click()
  await expect(page.locator('.api-connections tbody tr')).toHaveCount(4)
  await page.screenshot({ path: path.join(dir, 'connections.png') })
  await writeFile(
    path.join(dir, 'desktop-verified.json'),
    JSON.stringify({
      installedUses: await page.locator('.api-connections tbody').textContent(),
      entry: 'FitBay.cmd --verify-desktop',
    }),
  )
  await page.evaluate(() => window.close())
  console.log('PASS', dir)
} finally {
  await browser.close()
}
