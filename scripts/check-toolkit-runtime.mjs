import { _electron, expect } from '@playwright/test'
import path from 'node:path'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
const profile = await mkdtemp(path.resolve('tmp/toolkit-runtime-'))
await mkdir(path.join(profile, 'toolkit'))
await writeFile(
  path.join(profile, 'toolkit/settings.json'),
  JSON.stringify({
    capture: { key: 'Control+Alt+F20', enabled: true },
    selection: { key: 'Control+Alt+T', enabled: false },
  }),
)
const launch = () =>
  _electron.launch({
    args: ['components/toolkit', '--workbench-profile=' + profile],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
let app = await launch()
async function settings() {
  const p = await app.firstWindow()
  p.on('pageerror', (e) => console.error(e.message))
  await p.getByRole('button', { name: '设置', exact: true }).click()
  return p
}
try {
  let p = await settings()
  const row = (page, name) => page.getByRole('region', { name, exact: true })
  const form = row(p, '屏幕截图')
  const key = form.getByRole('textbox')
  await key.click()
  await key.press('F1')
  await form.getByRole('button', { name: '保存屏幕截图快捷键' }).click()
  await expect(form.getByRole('textbox')).toHaveValue('F1')
  const registered = (key) =>
    app.evaluate(({ globalShortcut }, k) => globalShortcut.isRegistered(k), key)
  const firstBound = await registered('F1')
  if (!firstBound) {
    await expect(p.getByRole('status')).toContainText('占用')
    assert(await registered('Control+Alt+F20'))
  }
  console.log('F1', firstBound ? 'registered' : 'system conflict; previous binding retained')
  await key.click()
  await key.press('F2')
  await form.getByRole('button', { name: '保存屏幕截图快捷键' }).click()
  await expect(key).toHaveValue('F2')
  let active = 'F2'
  if (!(await registered('F2'))) {
    await expect(p.getByRole('status')).toContainText('占用')
    active = 'F8'
    await key.click()
    await key.press(active)
    await form.getByRole('button', { name: '保存屏幕截图快捷键' }).click()
    console.log('F2 system conflict; using F8 for restart')
  }
  await expect.poll(() => registered(active)).toBe(true)
  await key.click()
  await key.press('Escape')
  await expect(key).toHaveValue(active)
  await key.click()
  await key.press('Control+Alt+T')
  await form.getByRole('button', { name: '保存屏幕截图快捷键' }).click()
  await expect(p.getByRole('status')).toContainText('占用')
  const selection = row(p, '划词助手')
  await selection.getByRole('textbox').click()
  await selection.getByRole('textbox').press('F1')
  await selection.getByRole('button', { name: '保存划词助手快捷键' }).click()
  await expect(selection.getByRole('textbox')).toHaveValue('F1')
  await row(p, '屏幕取色').getByRole('button', { name: '停用', exact: true }).click()
  await app.close()
  app = await launch()
  p = await settings()
  await expect(row(p, '划词助手').getByRole('textbox')).toHaveValue('F1')
  await expect(row(p, '屏幕截图').getByRole('textbox')).toHaveValue(active)
  await expect(row(p, '屏幕取色').getByRole('button', { name: '启用', exact: true })).toBeVisible()
  await row(p, '屏幕截图').getByRole('button', { name: '停用', exact: true }).click()
  await expect(row(p, '屏幕截图').getByRole('button', { name: '启用', exact: true })).toBeVisible()
  await p.getByRole('button', { name: '全部恢复默认快捷键' }).click()
  await expect(row(p, '屏幕截图').getByRole('textbox')).toHaveValue('Ctrl+Alt+S')
  await app.close()
  app = await launch()
  p = await settings()
  await expect(row(p, '屏幕取色').getByRole('button', { name: '启用', exact: true })).toBeVisible()
  await expect(row(p, '屏幕截图').getByRole('textbox')).toHaveValue('Ctrl+Alt+S')
  await p.screenshot({ path: path.join(profile, 'settings.png') })
  console.log(
    'PASS F1/F2, cancellation, conflict, disabled state, defaults and two restarts',
    profile,
  )
} finally {
  await app.close()
}
