import { _electron as electron, expect } from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
import path from 'node:path'
const profile = await mkdtemp(path.resolve('tmp/empty-close-'))
const app = await electron.launch({
  args: [
    path.resolve('dist/component-prototype/host'),
    '--mode=workbench',
    '--workbench=' + path.resolve('out/renderer/index.html'),
    '--user-data-dir=' + profile,
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  const p = await app.firstWindow()
  const close = p.getByRole('button', { name: '关闭快速开始' })
  await expect(close).toBeVisible({ timeout: 6000 })
  await expect(p.getByRole('button', { name: '最大化面板' })).toBeVisible()
  await close.click()
  await expect(p.getByRole('heading', { name: '快速开始' })).toHaveCount(0)
  await expect(p.locator('.dv-groupview')).toHaveCount(0)
  await p.reload()
  await expect(p.getByRole('button', { name: '组件', exact: true })).toBeVisible()
  await expect(p.locator('.dv-groupview')).toHaveCount(0)
  await p.getByRole('button', { name: '组件', exact: true }).click()
  await p.getByRole('menuitemcheckbox', { name: 'Music', exact: true }).click()
  await expect(p.getByRole('tab', { name: 'Music', exact: true })).toBeVisible()
  const open = async (name) => {
    await p.getByRole('button', { name: '组件', exact: true }).click()
    await p.getByRole('menuitemcheckbox', { name, exact: true }).click()
  }
  const group = (name) =>
    p.locator('.dv-groupview').filter({ has: p.getByRole('tab', { name, exact: true }) })
  await open('工具集')
  const musicContentsId = () =>
    app.evaluate(
      ({ webContents }) =>
        webContents.getAllWebContents().find((w) => w.getURL().includes('/music/index.html'))?.id,
    )
  await expect.poll(musicContentsId).toBeGreaterThan(0)
  const music = await musicContentsId()
  const sash = await p.locator('.dv-sash.dv-enabled:visible').first().boundingBox()
  await p.mouse.move(sash.x + sash.width / 2, sash.y + sash.height / 2)
  await p.mouse.down()
  await p.mouse.move(sash.x + 120, sash.y + sash.height / 2, { steps: 12 })
  await p.mouse.up()
  const before = await group('Music').boundingBox()
  await open('提示词库')
  await expect(p.locator('.dv-groupview:visible')).toHaveCount(3)
  const after = await group('Music').boundingBox()
  console.log({ before, after })
  for (const k of ['x', 'y', 'width', 'height'])
    expect(Math.abs(before[k] - after[k])).toBeLessThan(2)
  expect(await musicContentsId()).toBe(music)
  await p
    .getByRole('tab', { name: '提示词库', exact: true })
    .locator('.dv-default-tab-action')
    .click()
  await expect(p.locator('.dv-groupview:visible')).toHaveCount(2)
  expect(Math.abs((await group('工具集').boundingBox()).height - before.height)).toBeLessThan(2)
  console.log('PASS', profile)
} finally {
  await app.close()
}
