import { _electron, expect } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
const root = await mkdtemp(path.resolve('tmp/host-tabs-'))
const profile = path.join(root, 'profile')
const launch = () =>
  _electron.launch({
    args: [
      path.resolve('dist/component-prototype/host'),
      '--mode=workbench',
      '--component=' + path.resolve('dist/component-prototype/component'),
      '--workbench=' + path.resolve('out/renderer/index.html'),
      '--user-data-dir=' + profile,
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
let app = await launch()
try {
  let page = await app.firstWindow()
  page.setDefaultTimeout(8000)
  const button = (name) => page.getByRole('button', { name, exact: true })
  const tab = (id) => page.locator('.dv-tab[data-tab-panel-id="component-' + id + '"]')
  const records = {}
  async function measure(label) {
    const rows = await page.locator('.dv-groupview').evaluateAll((groups) =>
      groups.map((g) => {
        const bar = g.querySelector('.dv-tabs-and-actions-container')
        const rect = (e) => {
          const r = e.getBoundingClientRect()
          return { x: r.x, y: r.y, h: r.height, b: r.bottom }
        }
        return {
          bar: rect(bar),
          group: rect(g),
          content: rect(g.querySelector('.dv-content-container')),
          tabs: [...g.querySelectorAll('.dv-tab')].map((t) => {
            const c = t.querySelector('.dv-default-tab-content'),
              a = t.querySelector('.dv-default-tab-action')
            const icon = getComputedStyle(c, '::before'),
              style = getComputedStyle(t)
            return {
              id: t.dataset.tabPanelId,
              active: t.classList.contains('dv-active-tab'),
              tab: rect(t),
              label: rect(c),
              close: rect(a),
              icon: icon.maskImage === 'none' ? icon.backgroundImage : icon.maskImage,
              iconHeight: icon.height,
              color: style.backgroundColor,
              line: style.boxShadow,
            }
          }),
        }
      }),
    )
    if (label === 'four') {
      // Native component views sit above the HTML slots. Check their actual bounds too.
      await expect
        .poll(
          async () =>
            await app.evaluate(({ BrowserWindow }) => {
              const shell = BrowserWindow.getAllWindows().find((win) =>
                win.webContents.getURL().includes('/out/renderer/'),
              )
              return shell.contentView.children.filter(
                (v) => v.getVisible() && v.getBounds().height > 0,
              ).length
            }),
        )
        .toBeGreaterThanOrEqual(3)
      const children = await app.evaluate(({ BrowserWindow }) => {
        const shell = BrowserWindow.getAllWindows().find((win) =>
          win.webContents.getURL().includes('/out/renderer/'),
        )
        return shell.contentView.children
          .filter((v) => v.getVisible())
          .map((v) => ({ bounds: v.getBounds(), url: v.webContents.getURL() }))
      })
      for (const [id, fragment] of [
        ['music', '/music/'],
        ['prompts', '/prompts/'],
        ['example', '/component/'],
      ]) {
        const bounds = children.find((v) => v.url.includes(fragment)).bounds
        const group = rows.find((g) => g.tabs.some((t) => t.id === 'component-' + id))
        assert(Math.abs(group.content.y - bounds.y) <= 1)
        group.nativeTop = bounds.y
      }
    }
    records[label] = rows
    await page.screenshot({ path: path.join(root, label + '.png') })
    return rows
  }
  async function menu(name) {
    await button('组件').click()
    await page
      .getByRole(name === toolkit ? 'menuitem' : 'menuitemcheckbox', { name, exact: true })
      .click()
  }
  const toolkit = '工具集',
    files = '文件库'
  for (const [label, id] of [
    [toolkit, 'toolkit'],
    [files, 'prompts'],
  ]) {
    const quick = page.locator('.quick-components')
    await expect(quick.getByRole('button', { name: label, exact: true })).toBeVisible()
    if (id === 'toolkit') {
      await expect(quick.locator('.host-toolkit-icon')).toHaveCSS(
        'background-image',
        /toolkit\.png/,
      )
      assert(
        await page.evaluate(async () => {
          const img = new Image()
          img.src = './toolkit.png'
          await img.decode()
          return img.naturalWidth > 0
        }),
      )
      await page.screenshot({ path: path.join(root, 'quick.png') })
    }
    await quick.getByRole('button', { name: label, exact: true }).click()
    await expect(tab(id)).toContainText(label)
    if (id === 'toolkit') {
      await menu(toolkit)
      await expect(tab(id)).toHaveCount(1)
    }
    await tab(id).locator('.dv-default-tab-action').click()
    await expect(tab(id)).toHaveCount(0)
  }
  await button('打开 Music').click()
  await expect(tab('music')).toBeVisible()
  await measure('music')

  await menu(toolkit)
  await expect(tab('toolkit')).toBeVisible()
  await measure('split')
  await menu(files)
  await expect(tab('prompts')).toBeVisible()
  await menu('示例组件')
  await expect(tab('example')).toBeVisible()
  await measure('four')
  const src = await tab('toolkit').boundingBox(),
    dst = await tab('music').boundingBox()
  await page.mouse.move(src.x + 22, src.y + 12)
  await page.mouse.down()
  await page.mouse.move(src.x + 34, src.y + 12, { steps: 4 })
  await page.mouse.move(dst.x + 22, dst.y + 12, { steps: 24 })
  await page.mouse.move(dst.x + 23, dst.y + 12)
  await page.mouse.up()
  await expect(
    page
      .locator('.dv-groupview')
      .filter({ has: tab('music') })
      .locator('[data-tab-panel-id=component-toolkit]'),
  ).toBeVisible()
  await tab('music').click()
  await measure('mixed-music')
  await tab('toolkit').click()
  await measure('mixed-toolkit')
  function near(a, b) {
    assert(Math.abs(a - b) < 0.05)
  }
  for (const [state, groups] of Object.entries(records)) {
    const mixed = state.startsWith('mixed')
    const music = groups.flatMap((g) => g.tabs).find((t) => t.id === 'component-music')
    for (const g of groups) {
      near(g.bar.h, mixed ? 32 : 38)
      near(g.content.y, g.bar.b)
      for (const other of groups.filter((other) => Math.abs(other.group.y - g.group.y) < 1)) {
        near(g.bar.b, other.bar.b)
        near(g.content.y, other.content.y)
      }
      for (const t of g.tabs) {
        near(t.tab.y - g.bar.y, 4)
        near(t.close.y + t.close.h / 2, t.tab.y + t.tab.h / 2)
        near(t.label.y + t.label.h / 2, t.tab.y + t.tab.h / 2)
        near(t.tab.h, music.tab.h)
        if (['component-music', 'component-prompts', 'component-toolkit'].includes(t.id))
          assert.equal(t.iconHeight, '16px')
      }
    }
  }
  const active = (name, id) =>
    records[name].flatMap((g) => g.tabs).find((t) => t.id === 'component-' + id)
  const musicActive = active('mixed-music', 'music'),
    toolsActive = active('mixed-toolkit', 'toolkit')
  assert.equal(toolsActive.color, musicActive.color)
  assert.equal(toolsActive.line, musicActive.line)
  assert.match(musicActive.line, /inset/)
  assert.match(toolsActive.icon, /toolkit\.png/)
  await page.evaluate(() => {
    const key = 'workbench.layout'
    window.addEventListener('beforeunload', () => {
      const old = JSON.parse(localStorage.getItem(key))
      old.layout.panels['component-toolkit'].title = '截图与划词'
      old.layout.panels['component-prompts'].title = '提示词仓库'
      localStorage.setItem(key, JSON.stringify(old))
    })
  })
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  await expect(tab('toolkit')).toContainText('工具集')
  await expect(tab('prompts')).toContainText('文件库')
  await expect(
    page
      .locator('.dv-groupview')
      .filter({ has: tab('music') })
      .locator('[data-tab-panel-id=component-toolkit]'),
  ).toHaveCount(1)
  await expect(page.locator('.dv-tab[data-tab-panel-id]')).toHaveCount(4)
  await measure('restored')
  await writeFile(path.join(root, 'metrics.json'), JSON.stringify(records, null, 2))
  console.log(root)
} finally {
  await app.close()
}
