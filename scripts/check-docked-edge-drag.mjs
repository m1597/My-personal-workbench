import { _electron as electron, expect } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
const root = await mkdtemp(path.resolve('tmp/docked-edge-'))
const app = await electron.launch({
  args: [
    path.resolve('dist/component-prototype/host'),
    '--mode=workbench',
    '--component=' + path.resolve('dist/component-prototype/component'),
    '--workbench=' + path.resolve('out/renderer/index.html'),
    '--user-data-dir=' + root,
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  const page = await app.firstWindow()
  page.setDefaultTimeout(6000)
  const button = (name) => page.getByRole('button', { name, exact: true })
  const tabs = page.locator('.dv-tab[data-tab-panel-id]')
  const groups = page.locator('.dv-groupview:visible')
  await expect(page.locator('.quick-component')).toHaveCount(4)
  for (const [name, quick] of [
    ['提示词库', '提示词库'],
    ['工具集', '工具集'],
    ['示例组件', '示例组件'],
  ]) {
    await page
      .locator('.quick-components')
      .getByRole('button', { name: quick, exact: true })
      .click()
    await expect(button('还原面板')).toBeVisible()
    await button('组件').click()
    const row = page
      .locator('.component-menu-row')
      .filter({ has: page.getByRole('menuitemcheckbox', { name, exact: true }) })
    await expect(row.getByRole('menuitem', { name: '隐藏' + name, exact: true })).toBeEnabled()
    await row.getByRole('menuitem', { name: '关闭' + name, exact: true }).click()
    await expect(tabs).toHaveCount(0)
  }
  await button('打开 Music').click()
  await expect(button('还原面板')).toBeVisible()
  await button('组件').click()
  await page.getByRole('menuitemcheckbox', { name: '工具集', exact: true }).click()
  await expect(groups).toHaveCount(2)
  // CDP captures the host surface independently of its native child views. Compose
  // actual captured surfaces at their Electron bounds for the recorded drag frame.
  async function frame(name) {
    const base = (await page.screenshot()).toString('base64')
    const layers = await app.evaluate(async ({ BrowserWindow }) => {
      const shell = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes('/out/renderer'),
      )
      return Promise.all(
        shell.contentView.children
          .filter((v) => v.getVisible() && v.webContents)
          .map(async (v) => ({
            bounds: v.getBounds(),
            image: (await v.webContents.capturePage(undefined, { stayHidden: true })).toDataURL(),
          })),
      )
    })
    const png = await page.evaluate(
      async ({ base, layers }) => {
        async function load(url) {
          const img = new Image()
          img.src = url
          await img.decode()
          return img
        }
        const bg = await load('data:image/png;base64,' + base)
        const canvas = document.createElement('canvas')
        canvas.width = bg.width
        canvas.height = bg.height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(bg, 0, 0)
        ctx.scale(bg.width / window.innerWidth, bg.height / window.innerHeight)
        for (const { bounds: b, image } of layers)
          ctx.drawImage(await load(image), b.x, b.y, b.width, b.height)
        return canvas.toDataURL('image/png').split(',')[1]
      },
      { base, layers },
    )
    await writeFile(path.join(root, name + '.png'), Buffer.from(png, 'base64'))
  }
  async function nativeState() {
    return app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('/out/renderer'))
        .contentView.children.filter((v) => v.webContents)
        .map((v) => ({
          id: v.webContents.id,
          component: v.webContents.getURL().includes('/music/')
            ? 'music'
            : v.webContents.getURL().includes('/prompts/')
              ? 'prompts'
              : 'other',
          visible: v.getVisible(),
          focused: v.webContents.isFocused(),
        })),
    )
  }
  const evidence = []
  async function drag(axis, end, stage) {
    const count = await groups.count()
    const sessions = await nativeState()
    const before = await tabs.evaluateAll((els) => els.map((el) => el.dataset.tabPanelId).sort())
    const split = await page.locator('.dv-sash.dv-enabled').evaluateAll((els, axis) => {
      const sash = els.find((el) => {
        const r = el.getBoundingClientRect()
        return r.height > 0 && r.width > 0 && r.height > r.width === (axis === 'width')
      })
      const parent = sash.parentElement.parentElement
      parent.dataset.edgeProbe = '1'
      const b = parent.getBoundingClientRect(),
        r = sash.getBoundingClientRect()
      return {
        x: r.x + r.width / 2,
        y: r.y + r.height / 2,
        left: b.left,
        right: b.right,
        top: b.top,
        bottom: b.bottom,
      }
    }, axis)
    const horizontal = axis === 'width'
    await page.mouse.move(split.x, split.y)
    await page.mouse.down()
    await page.mouse.move(
      split.x + (horizontal ? (end ? 32 : -32) : 0),
      split.y + (horizontal ? 0 : end ? 32 : -32),
      { steps: 5 },
    )
    await expect(groups).toHaveCount(count)
    await frame(stage + '-drag')
    await page.mouse.move(
      horizontal ? (end ? split.right - 45 : split.left + 16) : split.x,
      horizontal ? split.y : end ? split.bottom - 45 : split.top + 16,
      { steps: 15 },
    )
    await expect.poll(() => groups.count()).toBeLessThan(count)
    const actual = await page.locator('[data-edge-probe]').evaluate((el, horizontal) => {
      const box = el.getBoundingClientRect(),
        bounds = [...el.querySelectorAll(':scope > .dv-view-container > .dv-view')].map((view) =>
          view.getBoundingClientRect(),
        )
      const start = horizontal ? 'left' : 'top',
        end = horizontal ? 'right' : 'bottom',
        size = horizontal ? 'width' : 'height'
      const active = bounds.filter((b) => b[size] > 0)
      return {
        gapBefore: Math.min(...active.map((b) => b[start])) - box[start],
        gapAfter: box[end] - Math.max(...active.map((b) => b[end])),
        sizes: bounds.map((b) => b[size]),
      }
    }, horizontal)
    const visible = await groups
      .locator('.dv-tab[aria-selected=true]')
      .evaluateAll((els) => els.map((el) => el.dataset.tabPanelId))
    await expect
      .poll(
        async () =>
          (await nativeState()).filter(
            (s) =>
              s.component !== 'other' &&
              (s.visible !== visible.includes('component-' + s.component) ||
                (!s.visible && s.focused)),
          ).length,
      )
      .toBe(0)
    evidence.push({ stage, axis, end, ...actual, sessions: await nativeState() })
    await writeFile(path.join(root, 'drag.json'), JSON.stringify(evidence, null, 2))
    expect(actual.gapBefore).toBeLessThanOrEqual(1)
    expect(actual.gapAfter).toBeLessThanOrEqual(1)
    expect(actual.sizes).toContain(0)
    await frame(stage + '-collapsed')
    await page.mouse.up()
    await page.locator('[data-edge-probe]').evaluate((el) => delete el.dataset.edgeProbe)
    await button('布局').click()
    await page.getByRole('menuitem', { name: /恢复分屏/ }).click()
    await expect(groups).toHaveCount(count)
    expect((await nativeState()).map((s) => s.id).sort()).toEqual(sessions.map((s) => s.id).sort())
    expect(await tabs.evaluateAll((els) => els.map((el) => el.dataset.tabPanelId).sort())).toEqual(
      before,
    )
  }
  await drag('width', false, 'two')
  await button('组件').click()
  await page.getByRole('menuitemcheckbox', { name: '提示词库', exact: true }).click()
  await expect(groups).toHaveCount(4)
  await drag('width', true, 'four-right')
  await drag('height', true, 'four-bottom')
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('out/renderer'))
      .setContentSize(820, 620),
  )
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(1000)
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  await drag('height', false, 'narrow-top')
  console.log('PASS', root)
} finally {
  await app.close()
}
