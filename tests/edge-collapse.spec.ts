import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { test, expect, _electron } from '@playwright/test'
test('分隔线四个方向收起后从布局菜单恢复', async ({}, info) => {
  const evidence = info.outputPath('drag')
  await mkdir(evidence, { recursive: true })
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
        el.parentElement.parentElement.setAttribute('data-tested-split', 'true')
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
      const direction = atEnd ? 1 : -1
      await p.mouse.move(
        split.x + (vertical ? direction * 28 : 0),
        split.y + (vertical ? 0 : direction * 28),
        { steps: 4 },
      )
      await expect(p.locator('.dv-groupview:visible')).toHaveCount(4)
      await p.screenshot({ path: path.join(evidence, `moving-${vertical}-${atEnd}.png`) })
      await p.mouse.move(split.x, split.y, { steps: 4 })
      await expect(p.locator('.dv-groupview:visible')).toHaveCount(4)
      await p.mouse.move(
        vertical ? (atEnd ? split.right - 42 : split.left + 42) : split.x,
        vertical ? split.y : atEnd ? split.bottom - 42 : split.top + 42,
        { steps: 10 },
      )
      await expect
        .poll(() => p.locator('.dv-groupview:visible').count(), { timeout: 1500 })
        .toBeLessThan(4)
      const geometry = await p.locator('[data-tested-split]').evaluate((parent, vertical) => {
        const axis = vertical ? 'width' : 'height'
        return {
          start: vertical
            ? parent.getBoundingClientRect().left
            : parent.getBoundingClientRect().top,
          span: parent.getBoundingClientRect()[axis],
          views: [...parent.querySelectorAll(':scope > .dv-view-container > .dv-view')].map(
            (view) => ({
              start: vertical
                ? view.getBoundingClientRect().left
                : view.getBoundingClientRect().top,
              size: view.getBoundingClientRect()[axis],
              visible: view.getClientRects().length > 0,
            }),
          ),
          focusHidden: !!document.activeElement?.closest('[inert],[aria-hidden=true]'),
        }
      }, vertical)
      await writeFile(path.join(evidence, `${vertical}-${atEnd}.json`), JSON.stringify(geometry))
      await p.screenshot({ path: path.join(evidence, `${vertical}-${atEnd}.png`) })
      expect(geometry.focusHidden).toBe(false)
      const occupied = geometry.views.filter((v) => v.size > 0)
      expect(
        Math.abs(Math.min(...occupied.map((v) => v.start)) - geometry.start),
      ).toBeLessThanOrEqual(1)
      expect(
        Math.abs(
          Math.max(...occupied.map((v) => v.start + v.size)) - (geometry.start + geometry.span),
        ),
      ).toBeLessThanOrEqual(1)
      await p
        .locator('[data-tested-split]')
        .evaluate((el) => el.removeAttribute('data-tested-split'))
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
