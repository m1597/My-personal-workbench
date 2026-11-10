import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
const output = path.resolve('tmp/appearance-preview')
await mkdir(output, { recursive: true })
const profile = await mkdtemp(path.join(output, 'profile-'))
const app = await electron.launch({
  args: ['.', `--user-data-dir=${profile}`],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1', ELECTRON_RENDERER_URL: '' },
})
try {
  const page = await app.firstWindow()
  await expect(page.getByTestId('panel-count')).toHaveText('4 个模块已打开')
  // Native desktop Acrylic is not present in renderer screenshots. Use the actual
  // supported no-Acrylic fallback for visual review, without changing OS settings.
  await page.evaluate(() => {
    delete document.documentElement.dataset.backdrop
  })
  for (const [width, height] of [
    [1480, 960],
    [960, 720],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]),
      [width, height],
    )
    for (const theme of ['dark', 'light']) {
      if ((await page.locator('html').getAttribute('data-theme')) !== theme)
        await page
          .getByRole('button', { name: `切换到${theme === 'dark' ? '深' : '浅'}色`, exact: true })
          .click()
      await page.mouse.move(1, 1)
      await page.waitForTimeout(300)
      await page.screenshot({ path: path.join(output, `${width}-${theme}.png`) })
      await page.getByRole('button', { name: '软件设置', exact: true }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.waitForTimeout(300)
      await page.screenshot({ path: path.join(output, `${width}-${theme}-settings.png`) })
      await page.keyboard.press('Escape')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
    }
  }
  expect(
    await app.evaluate(({ BrowserWindow, screen }) =>
      BrowserWindow.getAllWindows().every(
        (win) =>
          !win.isFocused() &&
          screen
            .getAllDisplays()
            .every((d) => win.getBounds().x + win.getBounds().width <= d.bounds.x),
      ),
    ),
  ).toBe(true)
  console.log(`截图：${output}；为不透明底色回退预览，不是桌面原生 Acrylic 合成。`)
} finally {
  await app.close()
}
