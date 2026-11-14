import { _electron as electron, expect } from '@playwright/test'
import path from 'node:path'
import { mkdtemp, writeFile } from 'node:fs/promises'
const root = await mkdtemp(path.resolve('tmp/compact-title-'))
const app = await electron.launch({
  args: [
    path.resolve('dist/component-prototype/host'),
    '--mode=workbench',
    '--workbench=' + path.resolve('out/renderer/index.html'),
    '--user-data-dir=' + path.join(root, 'profile'),
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  const page = await app.firstWindow()
  const report = []
  for (const width of [1400, 920]) {
    await app.evaluate(
      ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 700),
      width,
    )
    await page.evaluate(() => document.fonts.ready)
    const boxes = await page.evaluate(() => {
      const box = (e) => {
        const { x, y, width, height } = e.getBoundingClientRect()
        return { x, y, width, height }
      }
      return {
        icon: box(document.querySelector('.workbench-caption img')),
        brand: box(document.querySelector('.fitbay-brand')),
        buttons: [...document.querySelectorAll('.app-header>button')].map(box),
        sys: navigator.windowControlsOverlay.getTitlebarAreaRect().toJSON(),
        height: document.querySelector('.app-header').clientHeight,
      }
    })
    expect(boxes.buttons).toHaveLength(3)
    const [a, b, gear] = boxes.buttons
    expect(Math.abs(a.y + a.height / 2 - boxes.icon.y - boxes.icon.height / 2)).toBeLessThan(1)
    expect(b.x - a.x - a.width).toBeLessThanOrEqual(3)
    expect(gear.x + gear.width).toBeLessThanOrEqual(boxes.sys.width)
    await expect(page.locator('.toolbar-layout-name')).toHaveCount(0)
    const hit = await app.evaluate(({ BrowserWindow, screen }, boxes) => {
      const win = BrowserWindow.getAllWindows()[0],
        bounds = win.getContentBounds()
      const ffi = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')(
          'koffi',
        ),
        user = ffi.load('user32.dll'),
        send = user.func('intptr_t __stdcall SendMessageW(uintptr_t,uint32_t,uintptr_t,intptr_t)')
      const hwnd = Number(win.getNativeWindowHandle().readBigUInt64LE())
      const test = (x, y) => {
        const pt = screen.dipToScreenPoint({
          x: bounds.x + Math.round(x),
          y: bounds.y + Math.round(y),
        })
        return Number(send(hwnd, 0x84, 0, ((pt.y & 65535) << 16) | (pt.x & 65535)))
      }
      return {
        drag: test(420, 19),
        menus: boxes.buttons.map((b) => test(b.x + b.width / 2, b.y + b.height / 2)),
        system: [23, 69, 115].map((dx) => test(bounds.width - dx, 18)),
      }
    }, boxes)
    expect(hit.system).toEqual([20, 9, 8])
    expect(hit.drag).toBe(2)
    expect(hit.menus).toEqual([1, 1, 1])
    await page.getByRole('button', { name: '组件', exact: true }).click()
    await expect(page.getByRole('menuitemcheckbox', { name: 'Music' })).toBeVisible()
    await page.keyboard.press('Escape')
    const layout = page.getByRole('button', { name: '布局', exact: true })
    await layout.focus()
    await layout.press('Enter')
    await expect(page.getByRole('menuitem', { name: '管理布局' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(layout).toBeFocused()
    await page.getByRole('button', { name: '工作台设置' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('button', { name: '关闭设置' }).click()
    await page.screenshot({
      path: path.join(root, width + '-工作台.png'),
      style: ':root{background:#252a31!important}',
      animations: 'disabled',
    })
    report.push({ width, boxes, hit })
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize())
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()))
    .toBe(true)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore())
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize())
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()))
    .toBe(true)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore())
  await writeFile(path.join(root, 'geometry.json'), JSON.stringify(report, null, 2))
  console.log(
    'PASS',
    root,
    report.map((r) => r.hit),
  )
} finally {
  await app.close()
}
