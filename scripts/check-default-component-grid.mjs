import { _electron as electron, chromium, expect } from '@playwright/test'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
const desktop = process.argv[2]
const root = desktop ? path.resolve(desktop) : await mkdtemp(path.resolve('tmp/default-grid-'))
const proto = path.resolve('dist/component-prototype')
const app = desktop
  ? null
  : await electron.launch({
      args: [
        path.join(proto, 'host'),
        '--mode=workbench',
        '--workbench=' + path.resolve('out/renderer/index.html'),
        '--component=' + path.join(proto, 'component'),
        '--user-data-dir=' + path.join(root, 'profile'),
      ],
      env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1', FITBAY_TEST_PANELS: '1' },
    })
const browser = desktop
  ? await chromium.connectOverCDP(
      'http://127.0.0.1:' +
        Number((await readFile(path.join(root, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0]),
    )
  : null
const page = app
  ? await app.firstWindow()
  : browser
      .contexts()[0]
      .pages()
      .find((p) => p.url().includes('/out/renderer/index.html'))
try {
  page.setDefaultTimeout(5000)
  const tabs = page.locator('.dv-tab[data-tab-panel-id]')
  await expect(tabs).toHaveCount(4)
  while (await tabs.count()) await tabs.first().locator('.dv-default-tab-action').click()
  const names = ['模块 1', '模块 2', '模块 3', '模块 4', '工具集', '提示词库', 'Music', '示例组件']
  const evidence = []
  for (const [i, name] of names.entries()) {
    await page.getByRole('button', { name: '组件', exact: true }).click()
    await page
      .getByRole(
        ['Music', '示例组件', '提示词库', '工具集'].includes(name)
          ? 'menuitemcheckbox'
          : 'menuitem',
        {
          name,
          exact: true,
        },
      )
      .click()
    await expect(tabs).toHaveCount(i + 1)
    const groups = await page.locator('.dv-groupview').evaluateAll((nodes) =>
      nodes
        .map((n) => {
          const b = n.getBoundingClientRect()
          return {
            x: b.x,
            y: b.y,
            w: b.width,
            h: b.height,
            contentTop: n.querySelector('.dv-content-container').getBoundingClientRect().top,
            tabs: [...n.querySelectorAll('.dv-tab[data-tab-panel-id]')].map(
              (t) => t.dataset.tabPanelId,
            ),
          }
        })
        .sort((a, b) => a.y - b.y || a.x - b.x),
    )
    const ids = [
      'module-1',
      'module-2',
      'module-3',
      'module-4',
      'component-toolkit',
      'component-prompts',
      'component-music',
      'component-example',
    ]
    const positions = [0, 1, 3, 2, 4, 5, 6, 7]
    const expected = i === 2 ? ids.slice(0, 3) : positions.map((n) => ids[n])
    for (const [slot, group] of groups.entries())
      expect(group.tabs).toEqual(expected.slice(0, i + 1).filter((_, n) => n % 4 === slot))
    await expect(page.locator('.dv-tab[data-tab-panel-id="' + ids[i] + '"]')).toHaveAttribute(
      'aria-selected',
      'true',
    )
    if (i === 1) expect(Math.abs(groups[0].w - groups[1].w)).toBeLessThan(4)
    for (const group of groups) {
      for (const peer of groups.filter((other) => Math.abs(other.y - group.y) < 1))
        expect(Math.abs(group.contentTop - peer.contentTop)).toBeLessThan(0.05)
    }
    evidence.push(groups)
    expect(groups.length).toBe(Math.min(i + 1, 4))
    if (i === 2) {
      expect(groups[0].h).toBeGreaterThan(groups[1].h * 1.9)
      expect(groups[1].x).toBe(groups[2].x)
    }
    if (i >= 3) {
      expect(
        Math.max(...groups.map((g) => g.w)) - Math.min(...groups.map((g) => g.w)),
      ).toBeLessThan(4)
      expect(
        Math.max(...groups.map((g) => g.h)) - Math.min(...groups.map((g) => g.h)),
      ).toBeLessThan(4)
      expect(groups.map((g) => g.tabs.length)).toEqual(
        [0, 1, 2, 3].map((j) => Math.floor((i + 4 - j) / 4)),
      )
    }
    if ([0, 1, 2, 3, 4, 7].includes(i))
      await page.screenshot({ path: path.join(root, i + 1 + '.png') })
  }
  if (app)
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(920, 680),
    )
  if (browser) {
    await page.setViewportSize({ width: 920, height: 680 })
  }
  await expect(tabs).toHaveCount(8)
  await page.getByRole('button', { name: '组件', exact: true }).click()
  await page.getByRole('menuitem', { name: '模块 1', exact: true }).click()
  await expect(page.getByRole('tab', { name: '模块 1', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(tabs).toHaveCount(8)
  await page.screenshot({ path: path.join(root, 'narrow.png') })
  const from = await page.getByRole('tab', { name: '模块 1', exact: true }).boundingBox(),
    to = await page.getByRole('tab', { name: '模块 2', exact: true }).boundingBox()
  await page.mouse.move(from.x + 20, from.y + 13)
  await page.mouse.down()
  await page.mouse.move(from.x + 34, from.y + 13, { steps: 4 })
  await page.mouse.move(to.x + 24, to.y + 13, { steps: 20 })
  await page.mouse.move(to.x + 25, to.y + 13)
  await page.mouse.up()
  await expect(
    page
      .locator('.dv-groupview')
      .filter({ has: page.getByRole('tab', { name: '模块 2', exact: true }) })
      .getByRole('tab', { name: '模块 1', exact: true }),
  ).toBeVisible()
  await writeFile(path.join(root, 'grid.json'), JSON.stringify(evidence, null, 2))
  console.log('PASS', root)
} finally {
  if (app) await app.close()
  if (browser) {
    await page.evaluate(() => window.close())
    await browser.close()
  }
}
