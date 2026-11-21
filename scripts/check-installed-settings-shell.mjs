import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
const root = process.argv[2]
if (!root || !path.isAbsolute(root)) throw Error('请指定已安装三个组件的工作台目录')
await mkdir('tmp', { recursive: true })
const evidence = await mkdtemp(path.resolve('tmp/settings-shell-'))
const env = { ...process.env, WORKBENCH_TEST_BACKGROUND: '1', ELECTRON_RENDERER_URL: '' }
async function check(docked) {
  const app = await electron.launch({
    executablePath: docked
      ? path.join(root, 'FitBay.exe')
      : path.join(root, 'Music/FitBay Music.exe'),
    args: ['--user-data-dir=' + path.join(evidence, docked ? 'host' : 'standalone')],
    env,
  })
  let toolkit
  try {
    if (docked) {
      toolkit = await electron.launch({
        executablePath: path.join(root, 'Toolkit/FitBay Toolkit.exe'),
        args: ['--fitbay-hosted', '--workbench-profile=' + path.join(evidence, 'host')],
        env,
      })
      await toolkit.firstWindow()
      const shell = await app.firstWindow()
      await shell.getByRole('button', { name: '组件', exact: true }).click()
      const rows = shell.locator('.component-menu-row')
      await expect(rows).toHaveCount(3)
      const columns = await rows.evaluateAll((nodes) =>
        nodes.map((el) =>
          [...el.querySelector('.component-menu-columns').children, el.lastElementChild].map((s) =>
            Math.round(s.getBoundingClientRect().x),
          ),
        ),
      )
      expect(columns[1]).toEqual(columns[0])
      expect(columns[2]).toEqual(columns[0])
      await shell.screenshot({ path: path.join(evidence, 'component-menu.png') })
      await shell.getByRole('menuitemcheckbox', { name: 'Music', exact: true }).click()
      for (const [name, role] of [
        ['工具集', 'menuitem'],
        ['文件库', 'menuitemcheckbox'],
      ]) {
        await shell.getByRole('button', { name: '组件', exact: true }).click()
        await shell.getByRole(role, { name, exact: true }).click()
      }
      await expect(shell.locator('.dv-groupview')).toHaveCount(4)
      await checkGear(shell.locator('.toolkit-panel'), '设置')
      await expect
        .poll(() => app.windows().some((p) => p.url().includes('/prompts/index.html')))
        .toBe(true)
      await checkGear(
        app.windows().find((p) => p.url().includes('/prompts/index.html')),
        '文件库设置',
      )
    }
    await expect
      .poll(() => app.windows().some((p) => p.url().includes('/music/index.html')))
      .toBe(true)
    const player = app.windows().find((p) => p.url().includes('/music/index.html'))
    await player.getByRole('button', { name: '跳过', exact: true }).click()
    const query = player.getByPlaceholder('搜索歌名、艺人或专辑').first()
    await query.fill('保留状态')
    await player.getByRole('button', { name: '音乐设置', exact: true }).click()
    await expect(player.locator('.fitbay-settings-shell')).toBeVisible()
    await expect(player.locator('.music-navigation')).toBeHidden()
    await expect(player.locator('.music-player')).toBeHidden()
    const nav = player.getByRole('navigation', { name: '设置分类', includeHidden: true })
    if (!(await nav.isVisible())) await player.getByRole('button', { name: '设置分类' }).click()
    await nav.getByRole('button', { name: '播放', exact: true }).click()
    await expect(player.locator('.music-settings')).toHaveAttribute('aria-label', '播放')
    await player.screenshot({
      path: path.join(
        evidence,
        docked ? 'music-docked-settings.png' : 'music-standalone-settings.png',
      ),
    })
    await player.getByRole('button', { name: '返回', exact: true }).click()
    await expect(query).toHaveValue('保留状态')
    await player.getByRole('button', { name: '音乐设置', exact: true }).click()
    await expect(player.locator('.music-settings')).toHaveAttribute('aria-label', '播放')
  } finally {
    await toolkit?.close()
    await app.close()
  }
}
async function checkGear(page, label) {
  const gear = page.getByRole('button', { name: label, exact: true })
  await gear.click()
  const shell = page.locator('.fitbay-settings-shell')
  await expect(shell).toBeVisible()
  await shell.getByRole('button', { name: '返回', exact: true }).click()
  await expect(gear).toBeVisible()
}
await check(true)
await check(false)
for (const [product, label] of [
  ['Prompts', '文件库设置'],
  ['Toolkit', '设置'],
]) {
  const app = await electron.launch({
    executablePath: path.join(root, product, 'FitBay ' + product + '.exe'),
    args: [
      '--user-data-dir=' + path.join(evidence, product),
      '--workbench-profile=' + path.join(evidence, product),
    ],
    env,
  })
  try {
    await expect.poll(() => app.windows().some((p) => p.url().includes('index.html'))).toBe(true)
    await checkGear(
      app.windows().find((p) => p.url().includes('index.html')),
      label,
    )
  } finally {
    await app.close()
  }
}
console.log('PASS', evidence)
