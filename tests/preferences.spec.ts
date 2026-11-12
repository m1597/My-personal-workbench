import { _electron as electron, expect, test } from '@playwright/test'

test('工作台设置即时生效，重启保留六项偏好和旧布局', async ({}, info) => {
  const args = ['.', '--user-data-dir=' + info.outputPath('profile')]
  const env = {
    ...process.env,
    WORKBENCH_TEST_BACKGROUND: '1',
    FITBAY_TEST_PANELS: '1',
    ELECTRON_RENDERER_URL: process.env.WORKBENCH_TEST_RENDERER_URL ?? '',
  }
  for (const restart of [false, true]) {
    const app = await electron.launch({ args, env })
    try {
      const page = await app.firstWindow()
      if (!restart) {
        await page.getByRole('button', { name: 'Close 模块 4' }).click()
        await page.getByRole('button', { name: '工作台设置' }).click()
        await page.getByLabel('界面语言').selectOption('en')
        await page.getByLabel('Font', { exact: true }).selectOption('yahei')
        await page.getByLabel('Font size').selectOption('large')
        for (const slider of await page.getByRole('slider').all()) {
          await slider.press('End')
          await slider.press('ArrowLeft')
        }
      } else {
        await page.getByRole('button', { name: 'Workbench settings' }).click()
      }
      await expect(page.getByRole('combobox')).toHaveCount(3)
      await expect(page.getByLabel('Interface language')).toHaveValue('en')
      await expect(page.getByLabel('Font', { exact: true })).toHaveValue('yahei')
      await expect(page.getByLabel('Font size')).toHaveValue('large')
      for (const name of ['Transparency', 'Frost strength', 'Background brightness']) {
        await expect(page.getByRole('slider', { name })).toHaveValue('99')
      }
      await page.keyboard.press('Escape')
      const menu = page.getByRole('button', { name: 'Window', exact: true })
      await expect(menu).toHaveCSS('font-family', /^"Microsoft YaHei UI"/)
      await expect(menu).toHaveCSS('font-size', '16px')
      await expect(page.locator('.dv-tab[data-tab-panel-id]')).toHaveCount(3)
    } finally {
      await app.close()
    }
  }
})
