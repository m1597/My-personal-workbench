import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { _electron, expect } from '@playwright/test'
await mkdir('tmp', { recursive: true })
const dir = await mkdtemp(path.resolve('tmp/prompt-shortcuts-'))
const profile = path.join(dir, 'profile')
const defaults = 'Control+Alt+Shift+P'
await mkdir(path.join(profile, 'prompt-library'), { recursive: true })
await writeFile(
  path.join(profile, 'prompt-library/catalogue-preferences.json'),
  JSON.stringify({ defaultRoot: '', shortcut: 'F9', shortcutEnabled: false }),
)
const dist = path.resolve('dist/component-prototype')
const launch = (mode = 'prompts') =>
  _electron.launch({
    args: [
      path.join(dist, 'host'),
      '--mode=' + mode,
      '--workbench=' + path.resolve('out/renderer/index.html'),
      '--user-data-dir=' + profile,
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
let app = await launch()
try {
  let page = await app.firstWindow()
  const button = (name) => page.getByRole('button', { name, exact: true })
  async function category(label) {
    const toggle = button('设置分类')
    if (await toggle.isVisible()) await toggle.click()
    await button(label).click()
    await expect(page.locator('.fitbay-settings-body nav [aria-pressed=true]')).toHaveCount(1)
    await expect(page.locator('.fitbay-settings-body nav [aria-pressed=true]')).toHaveText(label)
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.activeElement?.closest('.fitbay-settings-content') &&
            /INPUT|SELECT|BUTTON/.test(document.activeElement.tagName),
        ),
      )
      .toBe(true)
  }
  const input = () => page.locator('.fitbay-settings-content input[readonly]')
  const save = () => page.locator('.fitbay-settings-content form button[type=submit]')
  const enabled = () => page.getByRole('checkbox', { name: '启用全局快捷键' })
  const snapshot = () => page.evaluate(() => window.promptLibrary.state())
  async function record(key) {
    await input().click()
    await input().press(key)
  }
  const isRegistered = (key) =>
    app.evaluate(({ globalShortcut }, key) => globalShortcut.isRegistered(key), key)
  await button('提示词库设置').click()
  await category('全局快捷键')
  await expect(enabled()).not.toBeChecked()
  await record('F1')
  await save().click()
  await expect.poll(async () => (await snapshot()).shortcut).toBe('F1')
  await record('F2')
  await save().click()
  await expect.poll(async () => (await snapshot()).shortcut).toBe('F2')
  assert.equal(await isRegistered('F2'), false)
  await enabled().click()
  await expect.poll(() => isRegistered('F2')).toBe(true)
  await input().click()
  await input().press('Escape')
  assert.equal((await snapshot()).shortcut, 'F2')
  await record('Control+Alt+Shift+F7')
  await save().click()
  await expect.poll(() => isRegistered('Control+Alt+Shift+F7')).toBe(true)
  assert.equal(
    await app.evaluate(({ globalShortcut }) => globalShortcut.register('F6', () => {})),
    true,
  )
  await record('F6')
  await save().click()
  await expect(page.getByRole('status')).toContainText('占用')
  assert.equal(await isRegistered('Control+Alt+Shift+F7'), true)
  await enabled().click()
  await expect.poll(() => isRegistered('Control+Alt+Shift+F7')).toBe(false)
  await page.locator('.fitbay-settings-content form').getByRole('button', { name: /恢复/ }).click()
  await expect.poll(async () => (await snapshot()).shortcut).toBe(defaults)
  assert.equal((await snapshot()).shortcutEnabled, false)
  await button('返回').click()
  await button('提示词库设置').click()
  await category('目录')
  await button('加入工作台').click()
  await category('目录')
  await category('全局快捷键')
  await record('F9')
  await save().click()
  await expect.poll(async () => (await snapshot()).shortcut).toBe('F9')
  await button('恢复组件全部快捷键').click()
  await expect.poll(async () => (await snapshot()).shortcut).toBe(defaults)
  await page.screenshot({ path: path.join(dir, 'docked.png') })
  await category('API 与模型')
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  await button('提示词库设置').click()
  await category('全局快捷键')
  await expect(enabled()).not.toBeChecked()
  assert.equal((await snapshot()).shortcut, defaults)
  assert.equal(await isRegistered(defaults), false)
  await record('F2')
  await save().click()
  await enabled().click()
  await expect.poll(() => isRegistered('F2')).toBe(true)
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  await expect.poll(() => isRegistered('F2')).toBe(true)
  assert.equal((await snapshot()).shortcutEnabled, true)
  await app.close()
  app = await launch('workbench')
  const workbench = await app.firstWindow()
  await workbench.getByRole('button', { name: '工作台设置', exact: true }).click()
  await workbench.getByRole('searchbox').fill('全局快捷键')
  await workbench.getByRole('button', { name: '提示词库 › 全局快捷键', exact: true }).click()
  await expect
    .poll(() => app.windows().some((w) => w.url().includes('/prompts/index.html')))
    .toBe(true)
  page = app.windows().find((w) => w.url().includes('/prompts/index.html'))
  await expect(input()).toBeVisible()
  await expect(enabled()).toBeChecked()
  await expect(input()).toHaveValue('F2')
  await page.screenshot({ path: path.join(dir, 'workbench-settings.png') })
  console.log('PASS', dir)
} finally {
  await app.close()
}
