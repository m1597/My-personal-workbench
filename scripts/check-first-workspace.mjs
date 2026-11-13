import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron, expect } from '@playwright/test'

// Run against the isolated Workbench installation used by check-separate-installers.ps1.
const [exe, root, mode] = process.argv.slice(2)
assert.ok(path.isAbsolute(exe) && path.isAbsolute(root))
assert.ok(['missing', 'installed', 'offline-install'].includes(mode))
const profile = path.join(root, 'profiles', 'first-entry-' + mode)
await mkdir(profile, { recursive: true })
let app, page
async function launch() {
  app = await electron.launch({
    executablePath: exe,
    args: ['--user-data-dir=' + profile],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
  page = await app.firstWindow()
  assert.ok(await app.evaluate(({ app }) => app.isPackaged))
}
const button = (name) => page.getByRole('button', { name, exact: true })
const tabs = () => page.getByRole('tab', { name: 'Music', exact: true })
async function restart() {
  await app.close()
  await launch()
}
try {
  await launch()
  const action = mode === 'installed' ? '打开 Music' : '添加组件'
  await expect(button(action)).toBeVisible()
  await expect(tabs()).toHaveCount(0)
  await page.screenshot({ path: path.join(root, mode + '-first.png') })
  await restart()
  await expect(button(action)).toBeVisible()
  if (mode === 'missing') {
    // Native file-picker cancellation and a genuine executable with the wrong digest.
    for (const canceled of [true, false]) {
      await app.evaluate(
        ({ dialog }, args) => {
          dialog.showOpenDialog = async () => ({
            canceled: args.cancel,
            filePaths: args.cancel ? [] : [args.exe],
          })
        },
        { cancel: canceled, exe },
      )
      await button(action).click()
      await expect(button(action)).toBeEnabled()
      if (!canceled)
        await expect(page.getByRole('alert').filter({ hasText: '同一批' })).toBeVisible()
    }
  } else {
    if (mode === 'offline-install') {
      await button('添加组件').click()
      await expect(button('打开 Music')).toBeVisible({ timeout: 180000 })
    }
    await button('打开 Music').click()
    await expect(tabs()).toBeVisible()
    await expect
      .poll(() => app.windows().some((p) => p.url().includes('/music/index.html')))
      .toBe(true)
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('workbench.firstEntryPending')))
      .toBeNull()
    await restart()
    await expect(tabs()).toBeVisible()
    await expect
      .poll(() => app.windows().some((p) => p.url().includes('/music/index.html')))
      .toBe(true)
    await page.getByRole('button', { name: '窗口', exact: true }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Music', exact: true }).click()
    await expect(tabs()).toHaveCount(0)
    await expect(button('打开 Music')).toHaveCount(0)
    await restart()
    await expect(page.getByRole('heading', { name: '工作区为空' })).toBeVisible()
    await expect(tabs()).toHaveCount(0)
    await expect(button('打开 Music')).toHaveCount(0)
    await expect(button('添加组件')).toHaveCount(0)
    await page.screenshot({ path: path.join(root, mode + '-cleared.png') })
  }
  console.log('PASS', mode, profile)
} finally {
  await app?.close()
}
