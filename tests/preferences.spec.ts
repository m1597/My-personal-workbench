import { _electron as electron, expect, test } from '@playwright/test'

test('工作台设置即时生效，重启保留六项偏好和旧布局', async ({}, info) => {
  const args = ['.', '--user-data-dir=' + info.outputPath('profile')]
  const env = {
    ...process.env,
    WORKBENCH_TEST_BACKGROUND: '1',
    FITBAY_TEST_PANELS: '1',
    ELECTRON_RENDERER_URL: process.env.WORKBENCH_TEST_RENDERER_URL ?? '',
  }
  for (const stage of [0, 1, 2]) {
    const app = await electron.launch({ args, env })
    try {
      const page = await app.firstWindow()
      if (stage === 0) {
        await page.getByRole('button', { name: 'Close 模块 4' }).click()
        await page.getByRole('button', { name: '工作台设置' }).click()
        const original = await page
          .getByRole('slider')
          .evaluateAll((elements) => elements.map((el) => (el as HTMLInputElement).value))
        expect(original).toEqual(['100', '100', '100'])
        await page.getByLabel('界面语言').click()
        await page.getByRole('option', { name: 'English', exact: true }).click()
        await page.getByLabel('Font', { exact: true }).click()
        await page.getByRole('option', { name: 'Microsoft YaHei UI', exact: true }).click()
        await page.getByLabel('Font size').click()
        await page.getByRole('option', { name: 'Large', exact: true }).click()
        for (const slider of await page.getByRole('slider').all()) {
          await slider.press('End')
          await slider.press('ArrowLeft')
        }
      } else {
        await page.getByRole('button', { name: 'Workbench settings' }).click()
      }
      await expect(page.getByRole('combobox')).toHaveCount(3)
      await expect(page.getByLabel('Interface language')).toHaveText('English')
      await expect(page.getByLabel('Font', { exact: true })).toHaveText('Microsoft YaHei UI')
      await expect(page.getByLabel('Font size')).toHaveText('Large')
      const sliders = page.getByRole('slider')
      if (stage < 2) {
        for (const slider of await sliders.all()) await expect(slider).toHaveValue('99')
      }
      if (stage === 1) await page.getByRole('button', { name: 'Restore defaults' }).click()
      if (stage > 0) {
        for (const [index, value] of ['100', '100', '100'].entries()) {
          await expect(sliders.nth(index)).toHaveValue(value)
        }
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
