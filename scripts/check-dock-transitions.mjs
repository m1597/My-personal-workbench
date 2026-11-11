import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve('dist/component-prototype')
await mkdir('tmp', { recursive: true })
const profile = await mkdtemp(path.resolve('tmp/dock-transitions-'))
const app = await electron.launch({
  args: [
    path.join(root, 'host'),
    '--mode=workbench',
    '--user-data-dir=' + profile,
    '--component=' + path.join(root, 'component'),
    '--workbench=' + path.join(root, 'workbench/index.html'),
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  const shell = await app.firstWindow()
  await shell.getByRole('button', { name: '示例组件', exact: true }).click()
  const mode = () => shell.evaluate(() => window.componentHost.status())
  await expect.poll(async () => (await mode()).mode).toBe('docked')
  const visible = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].contentView.children.at(-1).getVisible(),
    )
  const group = shell
    .locator('.dv-groupview')
    .filter({ has: shell.getByRole('tab', { name: '示例组件', exact: true }) })
  const box = await group.boundingBox()
  // Deliver the same preview message as a native window crossing the active sample.
  const preview = async (dragOver) =>
    app.evaluate(
      ({ BrowserWindow }, state) =>
        BrowserWindow.getAllWindows()[0].webContents.send('prototype:state', state),
      { ...(await mode()), dragOver },
    )
  await expect.poll(visible).toBe(true)
  await preview({ ...box, id: 'target', direction: 'within' })
  await expect(shell.locator('.component-drop-preview')).toBeVisible()
  await expect.poll(visible).toBe(false)
  await preview(null)
  await expect.poll(visible).toBe(true)
  console.log('PASS 原生子视图避让重叠预览并恢复')
} finally {
  await app.close()
}
