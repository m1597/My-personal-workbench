import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import executable from 'electron'

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
  await shell.evaluate(() => {
    document.documentElement.dataset.componentDrag = 'true'
  })
  await shell.evaluate(() => window.componentHost.open())
  await expect
    .poll(() => shell.evaluate(async () => (await window.componentHost.status()).phase))
    .toBe('attaching')
  await app.evaluate(({ BrowserWindow }) => {
    const target = BrowserWindow.getAllWindows()[0]
    const show = target.showInactive.bind(target)
    target.showInactive = () => {
      target.testRaised = true
      show()
    }
  })
  await promisify(execFile)(
    executable,
    [path.join(root, 'host'), '--user-data-dir=' + profile, '--mode=component'],
    {
      env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
      windowsHide: true,
      timeout: 10000,
    },
  )
  await expect
    .poll(
      () =>
        app.evaluate(({ BrowserWindow }) => Boolean(BrowserWindow.getAllWindows()[0].testRaised)),
      { timeout: 3000 },
    )
    .toBe(true)
  await shell.evaluate(() => {
    delete document.documentElement.dataset.componentDrag
  })
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

  await shell.evaluate(() => window.componentHost.detach())
  const tab = shell.getByRole('tab', { name: '示例组件', exact: true })
  await expect(tab).toHaveCount(0)
  // Reproduce a stale group between release and delivery in the workbench.
  await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents
    const send = contents.send.bind(contents)
    contents.send = (channel, ...args) => {
      if (channel === 'prototype:state' && args[0].phase === 'attaching') {
        contents.send = send
        args[0] = { ...args[0], placement: { id: 'removed-group', direction: 'within' } }
      }
      send(channel, ...args)
    }
  })
  await shell.evaluate(() => window.componentHost.open())
  await expect.poll(async () => (await mode()).phase, { timeout: 8000 }).toBe('ready')
  expect((await mode()).mode).toBe('standalone')
  await expect(tab).toHaveCount(0)
  console.log('PASS 目标失效时保留原窗口和布局')

  await shell.evaluate(() => {
    document.documentElement.dataset.componentDrag = 'true'
    return window.componentHost.open()
  })
  await expect(tab).toHaveCount(1)
  await shell.getByRole('button', { name: 'Close 模块 4', exact: true }).click()
  await shell.addInitScript(() => {
    window.savedOnReload = JSON.parse(localStorage.getItem('workbench.layout'))?.layout.panels
  })
  await shell.reload()
  const saved = await shell.evaluate(() => Object.keys(window.savedOnReload).sort())
  expect(saved).toEqual(['module-1', 'module-2', 'module-3'])
  await expect.poll(async () => (await mode()).phase).toBe('ready')
  expect((await mode()).mode).toBe('standalone')
  await expect(tab).toHaveCount(0)
  console.log('PASS 交接等待期间重载仅保存用户已完成的改动')

  // Hold just the success notification: the main process has already reparented the view.
  await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents
    const send = contents.send.bind(contents)
    contents.send = (channel, ...args) => {
      if (channel === 'prototype:state' && args[0].phase === 'ready' && args[0].mode === 'docked') {
        contents.send = send
        return
      }
      send(channel, ...args)
    }
  })
  await shell.evaluate(() => window.componentHost.open())
  await expect.poll(async () => (await mode()).mode).toBe('docked')
  // Exercise the final synchronous write before tearing down the document.
  expect(
    await shell.evaluate(() => {
      window.dispatchEvent(new Event('beforeunload'))
      return Object.keys(JSON.parse(localStorage.getItem('workbench.layout')).layout.panels)
    }),
  ).toContain('component-example')
  await shell.reload()
  expect(await shell.evaluate(() => Object.keys(window.savedOnReload))).toContain(
    'component-example',
  )
  await expect(tab).toHaveCount(1)
  console.log('PASS 确认消息延迟时重载保留已交接槽')
} finally {
  await app.close()
}
