import { _electron as electron, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, symlink, copyFile } from 'node:fs/promises'
import path from 'node:path'

await mkdir('tmp', { recursive: true })
const evidence = await mkdtemp(path.resolve('tmp/builtin-windows-'))
const profile = path.join(evidence, 'local/desktop-profile')
await mkdir(path.join(evidence, 'scripts'))
for (const dir of ['dist', 'out', 'node_modules'])
  await symlink(path.resolve(dir), path.join(evidence, dir), 'junction')
await copyFile('scripts/open-workbench.cmd', path.join(evidence, 'scripts/open-workbench.cmd'))
const run = promisify(execFile)
const launchIntent = (id) =>
  run('cmd.exe', ['/d', '/c', 'scripts\\open-workbench.cmd', '--' + id], {
    cwd: evidence,
    windowsHide: true,
    timeout: 15000,
  })
const args = [
  path.resolve('dist/component-prototype/host'),
  '--user-data-dir=' + profile,
  '--workbench=' + path.resolve('out/renderer/index.html'),
  '--component=' + path.resolve('dist/component-prototype/component'),
]
const env = { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' }
const app = await electron.launch({ args: [...args, '--mode=workbench'], env })
try {
  let shell = await app.firstWindow()
  const dragOut = async (id, cancel = false) => {
    const tab = shell.locator(`[data-tab-panel-id="${id}"]`)
    const box = await tab.boundingBox()
    await shell.mouse.move(box.x + 25, box.y + 14)
    await shell.mouse.down()
    await shell.mouse.move(-100, box.y + 14, { steps: 15 })
    if (cancel) await shell.keyboard.press('Escape')
    await shell.mouse.up()
  }
  await shell.getByRole('textbox', { name: '搜索模块' }).fill('模块 2')
  const ordinaryMaterial = await shell
    .locator('.dv-groupview')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  await dragOut('module-1', true)
  await expect(shell.getByTestId('module-1')).toBeVisible()
  await app.evaluate(
    ({ app }) =>
      app.once('browser-window-created', (_, window) => {
        window.loadFile = () => new Promise(() => {})
      }) && true,
  )
  await dragOut('module-1')
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
    .toBe(2)
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), {
      timeout: 12000,
    })
    .toBe(1)
  await expect(shell.getByRole('textbox', { name: '搜索模块' })).toBeEditable()
  await dragOut('module-1')
  await expect.poll(() => app.windows().length).toBe(2)
  const pageFor = async (id) => {
    const find = () =>
      app
        .windows()
        .find((p) => new URL(p.url() || 'about:blank').searchParams.get('builtin') === id)
    await expect.poll(() => Boolean(find())).toBe(true)
    return find()
  }
  const nav = await pageFor('module-1')
  await expect(nav.locator('.builtin-window')).toHaveCSS('background-color', ordinaryMaterial)
  await expect(nav.getByRole('textbox', { name: '搜索模块' })).toHaveValue('模块 2')
  await nav.getByRole('textbox', { name: '搜索模块' }).fill('模块 4')
  await nav.getByRole('button', { name: '打开模块 4' }).click()
  await expect(shell.getByRole('button', { name: '显示模块 4' })).toHaveClass(/is-active/)
  for (const id of ['module-2', 'module-3', 'module-4']) {
    await dragOut(id)
    await expect((await pageFor(id)).getByTestId(id)).toBeVisible()
  }
  await expect(shell.getByTestId('panel-count')).toHaveText('0 个模块已打开')
  expect(app.windows()).toHaveLength(5)
  await launchIntent('module-1')
  await expect(nav.getByRole('textbox', { name: '搜索模块' })).toHaveValue('模块 4')
  expect(app.windows()).toHaveLength(5)
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => !w.webContents.getURL().includes('builtin='))
      .close(),
  )
  await expect.poll(() => app.windows().length).toBe(4)
  await launchIntent('workbench')
  await expect.poll(() => app.windows().length).toBe(5)
  shell = app.windows().find((p) => !new URL(p.url() || 'about:blank').searchParams.has('builtin'))
  await expect(shell.getByTestId('panel-count')).toHaveText('0 个模块已打开')
  console.log('PASS 四窗同时分离、重复入口与关闭/重开空工作台')

  const groupFor = (id) =>
    shell.locator('.dv-groupview').filter({ has: shell.locator(`[data-tab-panel-id="${id}"]`) })
  const drop = async (id, targetId, direction, delay = 0) => {
    const area = targetId ? groupFor(targetId) : shell.locator('.docking-area')
    const box = await area.boundingBox()
    const u = direction === 'left' ? 0.08 : direction === 'right' ? 0.92 : 0.5
    const v = direction === 'above' ? 0.08 : direction === 'below' ? 0.92 : 0.5
    const info = await app.evaluate(
      ({ BrowserWindow, screen }, { id, x, y, delay }) => {
        const windows = BrowserWindow.getAllWindows()
        const shell = windows.find((w) => !w.webContents.getURL().includes('builtin='))
        const source = windows.find((w) => w.webContents.getURL().includes('builtin=' + id))
        for (const w of windows) if (w !== shell && w !== source) w.setPosition(-12000, 0)
        const origin = shell.getContentBounds()
        const point = { x: Math.round(origin.x + x), y: Math.round(origin.y + y) }
        screen.getCursorScreenPoint = () => point
        source.setPosition(point.x - 150, point.y - 80)
        if (delay) {
          const send = shell.webContents.send.bind(shell.webContents)
          shell.webContents.send = (channel, ...args) => {
            if (channel !== 'builtin:dock') return send(channel, ...args)
            shell.webContents.send = send
            setTimeout(() => send(channel, ...args), delay)
          }
        }
        return {
          handle: source.getNativeWindowHandle().readBigUInt64LE().toString(),
          id: source.id,
          point,
        }
      },
      { id, x: box.x + box.width * u, y: box.y + box.height * v, delay },
    )
    const message = (value) =>
      run(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-WindowStyle',
          'Hidden',
          '-File',
          path.resolve('scripts/native-dock-probe.ps1'),
          info.handle,
          String(value),
        ],
        { windowsHide: true, timeout: 10000 },
      )
    await message(0x231)
    await app.evaluate(
      ({ BrowserWindow }, { id, point }) =>
        BrowserWindow.fromId(id).setPosition(point.x - 120, point.y - 16),
      info,
    )
    await message(0x216)
    await expect(shell.locator('.component-drop-preview')).toHaveAttribute(
      'data-direction',
      direction,
    )
    await message(0x232)
    if (delay === 2000) await nav.getByRole('textbox', { name: '搜索模块' }).fill('交接中编辑')
    if (delay > 5000) {
      await shell.waitForTimeout(5900)
      await expect(shell.getByTestId(id)).toHaveCount(0)
      await expect((await pageFor(id)).getByTestId(id)).toBeVisible()
      return
    }
    await expect(shell.getByTestId(id)).toBeVisible()
    await expect
      .poll(() => app.windows().some((p) => p.url().includes('builtin=' + id)))
      .toBe(false)
    if (!targetId) return
    if (direction === 'within') {
      await expect(groupFor(id).locator(`[data-tab-panel-id="${targetId}"]`)).toHaveCount(1)
      return
    }
    const target = await groupFor(targetId).boundingBox(),
      placed = await groupFor(id).boundingBox()
    const horizontal = ['left', 'right'].includes(direction)
    const axis = horizontal ? 'x' : 'y',
      size = horizontal ? 'width' : 'height',
      cross = horizontal ? 'y' : 'x'
    const [first, second] = ['left', 'above'].includes(direction)
      ? [placed, target]
      : [target, placed]
    expect(Math.abs(second[axis] - first[axis] - first[size] - 8)).toBeLessThanOrEqual(1)
    expect(Math.abs(first[cross] - second[cross])).toBeLessThanOrEqual(1)
  }
  await drop('module-2', null, 'within')
  await drop('module-1', 'module-2', 'within', 5400)
  await drop('module-1', 'module-2', 'within', 2000)
  await expect(shell.getByRole('textbox', { name: '搜索模块' })).toHaveValue('交接中编辑')
  await shell.screenshot({ path: path.join(evidence, 'docked.png') })
  for (const [id, direction] of [
    ['module-3', 'left'],
    ['module-4', 'right'],
    ['module-1', 'above'],
    ['module-2', 'below'],
  ]) {
    if (await shell.locator(`[data-tab-panel-id="${id}"]`).count()) await dragOut(id)
    await pageFor(id)
    await drop(id, id === 'module-2' ? 'module-4' : 'module-2', direction)
  }
  console.log('PASS 空工作台接回、同组、四边实际位置、超时重试、导航搜索保持')
  await dragOut('module-3')
  const inspector = await pageFor('module-3')
  await shell.getByRole('button', { name: '显示模块 2' }).click()
  await expect(inspector.getByText('模块 2', { exact: true })).toBeVisible()
  const content = await shell.getByTestId('module-2').boundingBox()
  await expect
    .poll(async () =>
      Math.abs(Number(await inspector.locator('output').first().textContent()) - content.width),
    )
    .toBeLessThan(5)
  await inspector.screenshot({ path: path.join(evidence, 'inspector.png') })
  await inspector.evaluate(() => {
    delete document.documentElement.dataset.backdrop
  })
  await inspector.screenshot({ path: path.join(evidence, 'inspector-fallback.png') })
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('builtin=module-3'))
      .close(),
  )
  await expect.poll(() => app.windows().length).toBe(1)
  await shell.getByRole('button', { name: '显示模块 3' }).click()
  await expect(shell.getByTestId('module-3')).toBeVisible()
  await app.evaluate(({ ipcMain }) => {
    const [report] = ipcMain.listeners('builtin:workspace')
    ipcMain.removeListener('builtin:workspace', report)
    const delayed = (event, info) => setTimeout(() => report(event, info), 2500)
    ipcMain.on('builtin:workspace', delayed)
  })
  await shell.reload()
  await launchIntent('module-2')
  await expect(shell.getByRole('button', { name: '显示模块 2' })).toHaveClass(/is-active/, {
    timeout: 8000,
  })
  expect(app.windows()).toHaveLength(1)
  await expect(shell.getByTestId('panel-count')).toHaveText('4 个模块已打开')
  console.log('PASS 独立检查器尺寸、关闭单窗、重载布局；证据目录 ' + evidence)
} finally {
  await app.close()
}

for (const id of ['module-1', 'module-2', 'module-3', 'module-4']) {
  const isolated = await electron.launch({ args: [...args, '--mode=' + id], env })
  try {
    const page = await isolated.firstWindow()
    await expect(page.getByTestId(id)).toBeVisible()
    expect(isolated.windows()).toHaveLength(1)
    await launchIntent(id)
    expect(isolated.windows()).toHaveLength(1)
    if (id === 'module-1') {
      await page.getByRole('button', { name: '打开模块 3' }).click()
      await expect.poll(() => isolated.windows().length).toBe(2)
    }
  } finally {
    await isolated.close()
  }
}
console.log('PASS 四个独立启动意图、仅模块启动时的导航')
