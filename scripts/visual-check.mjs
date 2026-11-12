import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

// Chromium scale simulation only: never changes Windows display settings.
const output = path.resolve('tmp/visual-check')
await mkdir(output, { recursive: true })
await rm(path.join(output, 'results.json'), { force: true })
const results = []
for (const scale of [1.25, 1.5]) {
  const profile = await mkdtemp(path.join(output, 'profile-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${profile}`, `--force-device-scale-factor=${scale}`],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1', ELECTRON_RENDERER_URL: '' },
  })
  try {
    const page = await app.firstWindow()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await expect(page.locator('.dv-tab[data-tab-panel-id]')).toHaveCount(0)
    await expect(page).toHaveTitle('FitBay')
    await expect(page.locator('.app-header button').first()).toHaveAccessibleName('窗口')
    await expect(page.locator('.app-header')).not.toContainText(/个人工作台|我的工作空间|FitBay/)
    const cdp = await app.context().newCDPSession(page)
    await cdp.send('DOM.enable')
    await cdp.send('CSS.enable')
    const { root } = await cdp.send('DOM.getDocument')
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: '.empty-workspace p',
    })
    const fonts = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
    const title = page.locator('.empty-workspace p')
    const typography = await title.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        fontFamily: style.fontFamily,
      }
    })
    await title.evaluate((element) => {
      element.style.fontFamily = '"Microsoft YaHei UI", "Microsoft YaHei", sans-serif'
      element.getBoundingClientRect()
    })
    const fallback = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
    await title.evaluate((element) => element.style.removeProperty('font-family'))
    for (const [width, height] of [
      [1480, 960],
      [960, 720],
      [900, 640],
    ]) {
      await app.evaluate(
        ({ BrowserWindow }, size) => {
          BrowserWindow.getAllWindows()[0].setSize(size[0], size[1])
        },
        [width, height],
      )
      const theme = 'dark'
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      const prefix = `${scale}-${width}-${theme}`
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true)
      await expect(page.getByRole('heading', { name: '工作区为空' })).toBeVisible()
      const capture = async (suffix) => {
        // Fluent motion may start after React commits; wait for its real final frame.
        await page.evaluate(async () => {
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          )
          await Promise.all(
            document
              .getAnimations()
              .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
              .map((animation) => animation.finished.catch(() => {})),
          )
        })
        return page.screenshot({
          path: path.join(output, `${prefix}-${suffix}.png`),
          animations: 'disabled',
        })
      }
      await capture('workspace')
      for (const [trigger, role] of [
        ['窗口', 'menu'],
        ['窗口', 'dialog'],
      ]) {
        await page.getByRole('button', { name: trigger, exact: true }).click()
        if (role === 'dialog')
          await page.getByRole('menuitem', { name: '布局', exact: true }).click()
        const popup = page.getByRole(role)
        await expect(popup).toBeVisible()
        await capture(role)
        expect(
          await popup.evaluate((element) => {
            const box = element.getBoundingClientRect()
            return (
              box.left >= 0 &&
              box.top >= 0 &&
              box.right <= innerWidth &&
              box.bottom <= innerHeight &&
              element.contains(
                document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
              )
            )
          }),
        ).toBe(true)
        await page.keyboard.press('Escape')
        await expect(popup).not.toBeVisible()
        await expect(page.getByRole('button', { name: trigger, exact: true })).toBeFocused()
      }
      const background = await app.evaluate(({ BrowserWindow, screen }) => {
        const window = BrowserWindow.getAllWindows()[0]
        const bounds = window.getBounds()
        return (
          !window.isFocused() &&
          screen.getAllDisplays().every((display) => bounds.x + bounds.width <= display.bounds.x)
        )
      })
      expect(background).toBe(true)
      const viewport = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio,
      }))
      expect(viewport.dpr).toBeCloseTo(scale)
      results.push({
        scaleSimulation: scale,
        window: [width, height],
        theme,
        viewport,
        typography,
        fonts,
        fallback,
        background,
      })
      console.log(`PASS ${prefix}: geometry, focus, background; DPR=${viewport.dpr}`)
    }
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
}
await writeFile(
  path.join(output, 'results.json'),
  `${JSON.stringify(
    {
      mode: 'Chromium scale simulation; not Windows system DPI or native Acrylic acceptance',
      results,
    },
    null,
    2,
  )}\n`,
)
console.log(`视觉证据：${output}；仍需人工看图与真实 Windows 验收。`)
