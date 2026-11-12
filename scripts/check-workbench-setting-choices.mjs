import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron, expect } from '@playwright/test'

await mkdir('tmp', { recursive: true })
const root = await mkdtemp(path.resolve('tmp/settings-options-'))
const launch = () =>
  electron.launch({
    args: [
      path.resolve('dist/component-prototype/host'),
      '--mode=workbench',
      `--workbench=${path.resolve('out/renderer/index.html')}`,
      `--user-data-dir=${path.join(root, 'profile')}`,
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
const evidence = []
let app
try {
  app = await launch()
  const page = await app.firstWindow()
  await app.evaluate(({ app, BaseWindow, screen }) => {
    const windows = BaseWindow.getAllWindows()
    const left = Math.min(...screen.getAllDisplays().map((display) => display.bounds.x))
    if (
      !app.commandLine.hasSwitch('mute-audio') ||
      !windows.length ||
      !windows.every((w) => {
        const { x, width } = w.getBounds()
        return !w.isFocusable() && x + width <= left
      })
    )
      throw Error('工作台未离屏静音')
  })
  await page.getByRole('button', { name: '工作台设置' }).click()
  const dialog = page.getByRole('dialog', { name: '工作台设置' })
  await expect(dialog).toBeVisible()
  for (const [name, initial, final] of [
    ['字体', '默认（HarmonyOS Sans SC）', 'Segoe UI Variable'],
    ['字号', '标准', '大'],
    ['界面语言', '简体中文', 'English'],
  ]) {
    const combo = dialog.getByRole('combobox', { name, exact: true })
    assert.notEqual(
      await combo.evaluate((el) => el.tagName),
      'SELECT',
      '原生选择器无法渲染 Fluent 深色列表',
    )
    await combo.click()
    const list = page.getByRole('listbox')
    await expect(list).toBeVisible()
    await expect(list.getByRole('option', { name: initial, exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    const colors = await list.evaluate((el) => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      function rgba(value) {
        ctx.clearRect(0, 0, 1, 1)
        ctx.fillStyle = value
        ctx.fillRect(0, 0, 1, 1)
        return Array.from(ctx.getImageData(0, 0, 1, 1).data)
      }
      const selected = el.querySelector('[aria-selected="true"]')
      return {
        background: rgba(getComputedStyle(el).backgroundColor),
        foreground: rgba(getComputedStyle(selected).color),
        selected: rgba(getComputedStyle(selected).backgroundColor),
      }
    })
    assert.ok(
      colors.background.slice(0, 3).every((v) => v < 105) && colors.background[3] >= 240,
      `菜单底色应为深色 ${JSON.stringify(colors)}`,
    )
    assert.ok(
      colors.foreground.slice(0, 3).every((v) => v > 145),
      '选项文字应为浅色',
    )
    assert.ok(colors.selected[3] > 0, '选中背景应可见')
    evidence.push({ field: name, initial, final, ...colors })
    await dialog.screenshot({
      path: path.join(root, `${name}-展开.png`),
      animations: 'disabled',
      style: ':root { background: var(--base) !important }',
    })
    await page.keyboard.press('End')
    await page.keyboard.press('Escape')
    await expect(list).toBeHidden()
    await expect(combo).toHaveText(initial)
    await combo.press('Space')
    await expect(list).toBeVisible()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await expect(list).toBeHidden()
    await expect(page.getByRole('combobox').filter({ hasText: final })).toHaveCount(1)
  }
  await app.close()
  app = await launch()
  const restarted = await app.firstWindow()
  await restarted.getByRole('button', { name: 'Workbench settings' }).click()
  for (const [label, value] of [
    ['Interface language', 'English'],
    ['Font', 'Segoe UI Variable'],
    ['Font size', 'Large'],
  ])
    await expect(restarted.getByRole('combobox', { name: label, exact: true })).toHaveText(value)
  await writeFile(path.join(root, '验收.json'), JSON.stringify(evidence, null, 2))
  console.log('PASS', root, JSON.stringify(evidence))
} finally {
  await app?.close()
}
