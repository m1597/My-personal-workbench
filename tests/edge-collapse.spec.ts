import { test, expect, _electron } from '@playwright/test'
test('分隔线四个方向收起后从布局菜单恢复', async ({}, info) => {
  const profile = info.outputPath('profile-' + Date.now())
  const launch = () =>
    _electron.launch({
      args: ['.', '--user-data-dir=' + profile],
      env: {
        ...process.env,
        FITBAY_TEST_PANELS: '1',
        ELECTRON_RENDERER_URL: process.env.WORKBENCH_TEST_RENDERER_URL ?? '',
        WORKBENCH_TEST_BACKGROUND: '1',
      },
    })
  let app = await launch()
  try {
    let p = await app.firstWindow()
    await expect(p.locator('.dv-groupview:visible')).toHaveCount(4)
    for (const [vertical, atEnd] of [
      [true, false],
      [true, true],
      [false, false],
      [false, true],
    ]) {
      const split = await p.locator('.dv-sash.dv-enabled').evaluateAll((items, vertical) => {
        const el = items.find((s) => {
          const r = s.getBoundingClientRect()
          return r.width && r.height && r.height > r.width === vertical
        })
        if (!el?.parentElement?.parentElement) throw Error('缺少分隔线')
        const r = el.getBoundingClientRect(),
          parent = el.parentElement.parentElement.getBoundingClientRect()
        return {
          x: r.x + r.width / 2,
          y: r.y + r.height / 2,
          left: parent.left,
          right: parent.right,
          top: parent.top,
          bottom: parent.bottom,
        }
      }, vertical)
      const before = await p
        .locator('.dv-groupview')
        .evaluateAll((els) => els.map((e) => [e.clientWidth, e.clientHeight]))
      await p.mouse.move(split.x, split.y)
      await p.mouse.down()
      await p.mouse.move(
        vertical ? (atEnd ? split.right - 2 : split.left + 2) : split.x,
        vertical ? split.y : atEnd ? split.bottom - 2 : split.top + 2,
        { steps: 10 },
      )
      await p.mouse.up()
      await expect.poll(() => p.locator('.dv-groupview:visible').count()).toBeLessThan(4)
      if (!vertical && atEnd) {
        await expect
          .poll(() => p.evaluate(() => localStorage.getItem('workbench.layout')))
          .toContain('visible":false')
        await app.close()
        app = await launch()
        p = await app.firstWindow()
      }
      await p.getByRole('button', { name: '布局', exact: true }).click()
      await expect(p.getByRole('menuitem', { name: /恢复分屏/ })).toBeVisible()
      await p.getByRole('menuitem', { name: /恢复分屏/ }).click()
      await expect(p.locator('.dv-groupview:visible')).toHaveCount(4)
      const after = await p
        .locator('.dv-groupview')
        .evaluateAll((els) => els.map((e) => [e.clientWidth, e.clientHeight]))
      expect(
        Math.max(...before.flatMap((v, i) => v.map((n, j) => Math.abs(n - after[i][j])))),
      ).toBeLessThan(5)
    }
  } finally {
    await app.close()
  }
})
