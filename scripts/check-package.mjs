import { _electron as electron, expect } from '@playwright/test'
import { mkdtemp, mkdir } from 'node:fs/promises'
import path from 'node:path'

await mkdir('tmp', { recursive: true })
const profile = await mkdtemp(path.resolve('tmp/packaged-profile-'))
const executablePath = path.resolve('.cache/fitbay-build/workbench/win-unpacked/FitBay.exe')
let app
const errors = []
async function launch(count) {
  app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${profile}`, '--mute-audio'],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1', ELECTRON_RENDERER_URL: '' },
  })
  const page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await expect(page.getByTestId('panel-count')).toHaveText(`${count} 个模块已打开`)
  const state = await app.evaluate(({ app, BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows()[0]
    const bounds = window.getBounds()
    return {
      packaged: app.isPackaged,
      profile: app.getPath('userData'),
      background:
        !window.isFocused() &&
        screen.getAllDisplays().every((display) => bounds.x + bounds.width <= display.bounds.x),
    }
  })
  expect(state).toEqual({ packaged: true, profile, background: true })
  return page
}
try {
  let page = await launch(0)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('heading', { name: '工作区为空' })).toBeVisible()
  await app.close()
  page = await launch(0)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect.poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark')
  await page.getByRole('button', { name: '窗口', exact: true }).click()
  await page.getByRole('menuitem', { name: '布局', exact: true }).click()
  await page.getByRole('button', { name: '还原默认布局', exact: true }).click()
  await expect(page.getByTestId('panel-count')).toHaveText('0 个模块已打开')
  await page.screenshot({ path: 'tmp/packaged-verified.png', animations: 'disabled' })
  expect(errors).toEqual([])
  console.log('PASS 打包程序：后台启动、独立 profile、固定深色与布局重启恢复、重置。')
} finally {
  await app?.close()
}
