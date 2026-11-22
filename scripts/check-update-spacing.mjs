import { _electron, expect } from '@playwright/test'
import { mkdtemp, mkdir } from 'node:fs/promises'
import path from 'node:path'
const profile = await mkdtemp(path.resolve('tmp/host-updates-'))
const app = await _electron.launch({
  args: [
    path.resolve('dist/component-prototype/host'),
    '--mode=workbench',
    '--workbench=' + path.resolve('out/renderer/index.html'),
    '--user-data-dir=' + profile,
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
const dir = path.resolve('docs/images/host-update-layout')
await mkdir(dir, { recursive: true })
try {
  const page = await app.firstWindow(),
    b = (n) => page.getByRole('button', { name: n, exact: true })
  await b('工作台设置').click()
  await b('更新').click()
  await b('检查全部更新').click()
  await expect(b('检查全部更新')).toBeEnabled({ timeout: 40000 })
  for (const [name, width] of [
    ['wide', 1160],
    ['narrow', 520],
  ]) {
    await app.evaluate(({ BaseWindow }, w) => {
      const win =
        BaseWindow.getAllWindows().find((w) => w.getTitle().includes('FitBay')) ??
        BaseWindow.getAllWindows()[0]
      win.setMinimumSize(480, 360)
      win.setSize(w, 760)
    }, width)
    await expect(page.locator('.update-row')).toHaveCount(4)
    await expect(page.getByText('开发构建仅支持检查版本', { exact: true })).toHaveCount(1)
    const geometry = await page
      .locator('.update-row')
      .first()
      .evaluate((el) => {
        const text = el.children[0].getBoundingClientRect(),
          actions = el.children[1].getBoundingClientRect()
        return { wrapped: actions.top >= text.bottom, overflow: el.scrollWidth - el.clientWidth }
      })
    expect(geometry.overflow).toBe(0)
    expect(geometry.wrapped).toBe(name === 'narrow')
    await page.screenshot({ path: path.join(dir, name + '.png') })
    console.log(
      name,
      await page
        .locator('.update-page')
        .evaluate((el) => ({ width: innerWidth, overflow: el.scrollWidth - el.clientWidth })),
    )
  }
} finally {
  await app.close()
}
