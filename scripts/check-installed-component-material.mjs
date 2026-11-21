import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'

const directory = process.argv[2]
if (!directory || !path.isAbsolute(directory)) throw Error('请指定已安装三个组件的工作台绝对目录')
await mkdir('tmp', { recursive: true })
const profile = await mkdtemp(path.resolve('tmp/material-profile-'))
const app = await electron.launch({
  executablePath: path.join(directory, 'FitBay.exe'),
  args: ['--user-data-dir=' + profile],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1', ELECTRON_RENDERER_URL: '' },
})
try {
  const page = await app.firstWindow()
  for (const [name, role] of [
    ['Music', 'menuitemcheckbox'],
    ['工具集', 'menuitem'],
    ['文件库', 'menuitemcheckbox'],
  ]) {
    await page.getByRole('button', { name: '组件', exact: true }).click()
    await page.getByRole(role, { name, exact: true }).click()
  }
  await expect(page.locator('.dv-groupview')).toHaveCount(4)
  await expect(page.locator('.toolkit-panel').getByText('屏幕截图', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '工作台设置', exact: true }).click()
  const sliders = page.getByRole('slider')
  for (const slider of await sliders.all()) {
    await slider.focus()
    await slider.press('Home')
  }
  await page.getByRole('button', { name: '关闭设置', exact: true }).click()
  const states = () =>
    app.evaluate(async ({ webContents }) => {
      const pages = webContents
        .getAllWebContents()
        .filter((c) => /\/(workbench|prompts|music)\/index\.html/.test(c.getURL()))
      return Promise.all(
        pages.map((c) =>
          c.executeJavaScript(`(()=>{
      const el = document.querySelector('.library,.music-shell,.toolkit-panel')
      if (!el) return null
      const style = getComputedStyle(el)
      return [style.backgroundImage, style.backgroundColor, ...['opacity','frost','light'].map(k =>
        style.getPropertyValue('--material-' + k).trim())]
    })()`),
        ),
      )
    })
  await expect.poll(states).toEqual(Array(3).fill(['none', 'rgba(0, 0, 0, 0)', '1', '0', '0']))

  async function library(expression) {
    return app.evaluate(
      ({ webContents }, code) =>
        webContents
          .getAllWebContents()
          .find((c) => c.getURL().includes('/prompts/index.html'))
          .executeJavaScript(code),
      expression,
    )
  }
  for (const [button, surface, opacity] of [
    ['独立打开', 'window', ''],
    ['加入工作台', 'embedded', '1'],
  ]) {
    await library(
      `[...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || b.textContent.trim()) === ${JSON.stringify(button)}).click()`,
    )
    await expect
      .poll(() => library("document.querySelector('[data-surface]').dataset.surface"))
      .toBe(surface)
    await expect
      .poll(() => library("document.documentElement.style.getPropertyValue('--material-opacity')"))
      .toBe(opacity)
  }
  console.log('PASS 安装版四分屏、三项材质参数、文件库分离及重新停靠')
} finally {
  await app.close()
}
