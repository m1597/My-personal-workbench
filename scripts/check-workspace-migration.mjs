import { dragMusicIn, dragMusicOut } from './music-drag-fixture.mjs'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron, expect } from '@playwright/test'

await mkdir('tmp', { recursive: true })
const profile = await mkdtemp(path.resolve('tmp/music-workspace-'))
const launch = (withSample = false) =>
  electron.launch({
    args: [
      path.resolve('dist/component-prototype/host'),
      '--mode=workbench',
      '--user-data-dir=' + profile,
      '--workbench=' + path.resolve('out/renderer/index.html'),
      ...(withSample ? ['--component=' + path.resolve('dist/component-prototype/component')] : []),
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1', FITBAY_TEST_PANELS: '' },
  })
const leaf = (id, views, activeView = views[0]) => ({
  type: 'leaf',
  size: 400,
  data: { id, views, activeView },
})
const music = 'component-music',
  sample = 'component-example'
function saved(groups, activeGroup) {
  const ids = groups.flatMap((g) => g.data.views)
  return {
    version: 1,
    layout: {
      activeGroup,
      grid: {
        width: 1200,
        height: 700,
        orientation: 'HORIZONTAL',
        root: { type: 'branch', size: 1200, data: groups },
      },
      panels: Object.fromEntries(
        ids.map((id) => [
          id,
          {
            id,
            contentComponent: id.startsWith('module-') ? 'module' : 'component-slot',
            title: id === music ? '音乐试听' : id,
          },
        ]),
      ),
    },
  }
}
let app = await launch()
try {
  let shell = await app.firstWindow()
  const empty = shell.getByRole('heading', { name: '工作区为空' })
  await expect(empty).toBeVisible()
  const menu = shell.getByRole('button', { name: '窗口', exact: true })
  await menu.click()
  await expect(shell.getByRole('menuitem')).toHaveText(['Music', '重置布局'])
  await shell.screenshot({ path: path.join(profile, 'window-menu.png') })
  await shell.getByRole('menuitem', { name: 'Music', exact: true }).click()
  await expect(shell.getByRole('tab', { name: 'Music', exact: true })).toBeVisible()
  const nativeVisible = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].contentView.children.some((v) => v.getVisible()),
    )
  await expect.poll(nativeVisible).toBe(true)
  const layoutBefore = await shell.locator('.dv-tab').allTextContents()
  await menu.click()
  await expect(shell.getByRole('menu')).toBeVisible()
  await shell.waitForFunction(
    () => document.querySelector('[role="menu"]')?.getClientRects().length,
  )
  await shell.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  assert.equal(await nativeVisible(), true, '窗口菜单展开时应保留 Music 视图')
  await shell.keyboard.press('Escape')
  await expect.poll(nativeVisible).toBe(true)
  assert.deepEqual(await shell.locator('.dv-tab').allTextContents(), layoutBefore)
  const player = app.windows().find((p) => p.url().includes('/music/index.html'))
  await expect(player.getByRole('heading', { name: 'Music', exact: true })).toHaveCount(0)
  await dragMusicOut(app)
  await expect(empty).toBeVisible()
  assert.ok(
    await app.evaluate(({ BaseWindow }) =>
      BaseWindow.getAllWindows().some((w) => w.getTitle() === 'Music'),
    ),
  )
  await dragMusicIn(app)
  await shell.getByRole('button', { name: 'Close Music', exact: true }).click()
  const restore = async (layout) => {
    await shell.evaluate(
      (layout) =>
        window.addEventListener(
          'beforeunload',
          () => localStorage.setItem('workbench.layout', JSON.stringify(layout)),
          { once: true },
        ),
      layout,
    )
    await shell.reload()
  }
  for (const layout of [
    saved([leaf('old', ['module-1', 'module-2', 'module-3', 'module-4'])], 'old'),
    saved([]),
  ]) {
    await restore(layout)
    await expect(empty).toBeVisible()
    await expect
      .poll(() =>
        shell.evaluate(() =>
          Object.keys(JSON.parse(localStorage.getItem('workbench.layout')).layout.panels),
        ),
      )
      .toEqual([])
  }
  await app.close()
  app = await launch(true)
  shell = await app.firstWindow()
  await expect(shell.getByRole('heading', { name: '工作区为空' })).toBeVisible()
  await restore(
    saved(
      [
        leaf('gone', ['module-1']),
        leaf('songs', ['module-2', music], 'module-2'),
        leaf('tools', [sample, 'module-3'], sample),
      ],
      'tools',
    ),
  )
  await expect(shell.getByRole('tab', { name: 'Music', exact: true })).toBeVisible()
  const stored = () =>
    shell.evaluate(() => JSON.parse(localStorage.getItem('workbench.layout')).layout)
  await expect
    .poll(async () => Object.keys((await stored()).panels).sort())
    .toEqual([sample, music])
  let recovered = await stored()
  assert.deepEqual(
    recovered.grid.root.data.map((n) => [n.data.id, n.data.views, n.data.activeView]),
    [
      ['songs', [music], music],
      ['tools', [sample], sample],
    ],
  )
  assert.equal(recovered.activeGroup, 'tools')
  await shell.reload()
  await expect(shell.getByRole('tab', { name: 'Music', exact: true })).toBeVisible()
  recovered = await stored()
  assert.equal(recovered.panels[music].title, 'Music')
  await restore(saved([leaf('old', ['module-1']), leaf('songs', [music])], 'old'))
  await expect.poll(async () => (await stored()).activeGroup).toBe('songs')
  await app.close()
  app = await launch()
  shell = await app.firstWindow()
  await expect(shell.getByRole('tab', { name: 'Music', exact: true })).toBeVisible()
  await expect
    .poll(() => shell.evaluate(() => window.musicDock.status().then((s) => [s.mode, s.phase])))
    .toEqual(['docked', 'ready'])
  console.log(
    'PASS 空工作区、真实 Music 入口及停靠分离；混合、全占位、合法空布局与重载。' + profile,
  )
} finally {
  await app.close()
}
