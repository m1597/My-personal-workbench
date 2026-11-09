import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, cp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve('dist/component-prototype')
await mkdir('tmp', { recursive: true })
const evidence = await mkdtemp(path.resolve('tmp/component-prototype-'))
const errors = []
async function launch(component, workbench = true, mode = 'standalone') {
  const profile = await mkdtemp(path.join(evidence, 'profile-'))
  const app = await electron.launch({
    timeout: 30000,
    args: [
      path.join(root, 'host'),
      `--user-data-dir=${profile}`,
      `--component=${component}`,
      `--mode=${mode}`,
      ...(workbench ? [`--workbench=${path.join(root, 'workbench/index.html')}`] : []),
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
  app.on('window', (page) => page.on('pageerror', (error) => errors.push(error.message)))
  return app
}
async function findPage(app, fragment) {
  await expect.poll(() => app.windows().some((page) => page.url().includes(fragment))).toBe(true)
  return app.windows().find((page) => page.url().includes(fragment))
}
async function background(app) {
  expect(
    await app.evaluate(({ BaseWindow, screen }) =>
      BaseWindow.getAllWindows().every((window) => {
        const bounds = window.getBounds()
        return (
          !window.isFocused() &&
          screen.getAllDisplays().every((display) => bounds.x + bounds.width <= display.bounds.x)
        )
      }),
    ),
  ).toBe(true)
}
const samplePath = path.join(root, 'component')
let app = await launch(samplePath, false)
try {
  const sample = await findPage(app, '/component/index.html')
  await expect(sample.getByText('独立窗口', { exact: true })).toBeVisible()
  await sample.getByRole('button', { name: '增加', exact: true }).click()
  await sample.getByRole('button', { name: '加入工作台', exact: true }).click()
  await expect(sample.locator('#error')).toContainText('NOT_INSTALLED')
  await expect(sample.locator('#count')).toHaveText('1')
  await background(app)
  console.log('PASS 无工作台部署入口也可独立运行；缺少工作台明确反馈')
} finally {
  await app.close()
}

app = await launch(samplePath)
try {
  const sample = await findPage(app, '/component/index.html')
  await sample.getByLabel('保留输入').fill('切换保留中文状态')
  await sample.getByLabel('队列选择').selectOption({ label: '示例 B' })
  await sample.getByRole('button', { name: '增加', exact: true }).click()
  const boot = await sample.locator('body').getAttribute('data-boot-id')
  const session = await sample.locator('#session').textContent()
  // Set up both windows, then exercise the native message path without transfer buttons.
  await sample.getByRole('button', { name: '加入工作台', exact: true }).click()
  await expect(sample.locator('#mode')).toHaveText('已停靠')
  await sample.getByRole('button', { name: '分离窗口', exact: true }).click()
  const dockShell = await findPage(app, '/workbench/index.html')
  const zone = await dockShell.locator('.docking-area').boundingBox()
  const info = await app.evaluate(({ BaseWindow, BrowserWindow }, zone) => {
    const host = BrowserWindow.getAllWindows()[0]
    const win = BaseWindow.getAllWindows().find((w) => w.id !== host.id)
    const content = host.getContentBounds()
    return {
      handle: win.getNativeWindowHandle().readBigUInt64LE().toString(),
      id: win.id,
      x: Math.round(content.x + zone.x + zone.width / 2 - win.getBounds().width / 2),
      y: Math.round(content.y + zone.y + 80 - 16),
    }
  }, zone)
  const message = (value) =>
    promisify(execFile)(
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
  const position = (x, y) =>
    app.evaluate(
      ({ BaseWindow }, value) => BaseWindow.fromId(value.id).setPosition(value.x, value.y),
      { id: info.id, x, y },
    )
  await position(info.x, info.y)
  await sample.waitForTimeout(150)
  await expect(sample.locator('#mode')).toHaveText('独立窗口')
  // Resize/modal-loop notifications without WM_MOVING must not dock.
  await message(0x231)
  await position(info.x + 10, info.y)
  await message(0x232)
  await expect(sample.locator('#mode')).toHaveText('独立窗口')
  // Moving outside the workspace is a rejected drop.
  await message(0x231)
  await message(0x216)
  await position(info.x, info.y - 500)
  await message(0x232)
  await expect(sample.locator('#mode')).toHaveText('独立窗口')
  // Returning to the initial position (Escape semantics) must not dock.
  await position(info.x, info.y)
  await message(0x231)
  await message(0x216)
  await position(info.x + 10, info.y)
  await position(info.x, info.y)
  await message(0x232)
  await expect(sample.locator('#mode')).toHaveText('独立窗口')
  await position(info.x, info.y - 500)
  await message(0x231)
  await message(0x216)
  await position(info.x, info.y)
  await expect(dockShell.getByRole('button', { name: '松开窗口标题栏以停靠' })).toBeVisible()
  await dockShell.screenshot({ path: path.join(evidence, 'native-drop-preview.png') })
  await message(0x232)
  await expect(sample.locator('#mode')).toHaveText('已停靠')
  const grip = await dockShell.getByRole('button', { name: '组件拖出手柄' }).boundingBox()
  // A click/short move and an Escape-cancelled drag must retain the panel.
  await dockShell.mouse.move(grip.x + 50, grip.y + 16)
  await dockShell.mouse.down()
  await dockShell.mouse.move(grip.x + 55, grip.y + 16)
  await dockShell.mouse.up()
  await expect(sample.locator('#mode')).toHaveText('已停靠')
  await dockShell.mouse.move(grip.x + 50, grip.y + 16)
  await dockShell.mouse.down()
  await dockShell.mouse.move(grip.x + 50, 20, { steps: 5 })
  await dockShell.keyboard.press('Escape')
  await dockShell.mouse.up()
  await expect(sample.locator('#mode')).toHaveText('已停靠')
  await dockShell.mouse.move(grip.x + 50, grip.y + 16)
  await dockShell.mouse.down()
  await dockShell.mouse.move(grip.x + 50, 20, { steps: 12 })
  await dockShell.mouse.up()
  await expect(sample.locator('#mode')).toHaveText('独立窗口')
  await background(app)
  console.log(
    'PASS Windows HWND 消息模拟拖入/未命中/取消/非拖动；真实网页指针拖出分离（不是桌面系统鼠标验收）',
  )
  for (let i = 0; i < 20; i++) {
    await sample.getByRole('button', { name: '加入工作台', exact: true }).click()
    await expect(sample.locator('#mode')).toHaveText('已停靠')
    await sample.getByRole('button', { name: '分离窗口', exact: true }).click()
    await expect(sample.locator('#mode')).toHaveText('独立窗口')
  }
  expect(await sample.locator('body').getAttribute('data-boot-id')).toBe(boot)
  await expect(sample.locator('#session')).toHaveText(session)
  await expect(sample.getByLabel('保留输入')).toHaveValue('切换保留中文状态')
  await expect(sample.getByLabel('队列选择')).toHaveValue('示例 B')
  await expect(sample.locator('#count')).toHaveText('1')
  expect(await sample.evaluate(() => typeof window.require)).toBe('undefined')
  expect(
    await sample.evaluate(() =>
      fetch('https://example.com').then(
        () => false,
        () => true,
      ),
    ),
  ).toBe(true)
  await sample.getByRole('button', { name: '加入工作台', exact: true }).click()
  await expect(sample.locator('#mode')).toHaveText('已停靠')
  let shell = await findPage(app, '/workbench/index.html')
  await shell.getByRole('button', { name: '操作帮助', exact: true }).click()
  await expect(shell.getByRole('dialog')).toBeVisible()
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].contentView.children.at(-1).getVisible(),
      ),
    )
    .toBe(false)
  await shell.keyboard.press('Escape')
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].contentView.children.at(-1).getVisible(),
      ),
    )
    .toBe(true)
  await shell.evaluate(() => window.workbench.setTheme('light'))
  await expect(sample.locator('html')).toHaveAttribute('data-theme', 'light')
  await sample.screenshot({ path: path.join(evidence, 'component-light.png') })
  await shell.evaluate(() => window.workbench.setTheme('dark'))
  await expect(sample.locator('html')).toHaveAttribute('data-theme', 'dark')
  await shell.getByRole('button', { name: '重置布局', exact: true }).click()
  await expect(sample.locator('#mode')).toHaveText('独立窗口')
  await sample.getByRole('button', { name: '加入工作台', exact: true }).click()
  await expect(sample.locator('#mode')).toHaveText('已停靠')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await expect(sample.locator('#mode')).toHaveText('独立窗口')
  await expect(sample.getByLabel('保留输入')).toHaveValue('切换保留中文状态')
  await sample.getByRole('button', { name: '加入工作台', exact: true }).click()
  await expect(sample.locator('#mode')).toHaveText('已停靠')
  shell = await findPage(app, '/workbench/index.html')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 800))
  await background(app)
  await sample.getByRole('button', { name: '分离窗口', exact: true }).click()
  await expect(sample.locator('#mode')).toHaveText('独立窗口')
  await sample.waitForTimeout(300)
  await sample.screenshot({ path: path.join(evidence, 'component.png') })
  await sample.getByRole('button', { name: '加入工作台', exact: true }).click()
  await expect(sample.locator('#mode')).toHaveText('已停靠')
  await sample.waitForTimeout(300)
  await sample.screenshot({ path: path.join(evidence, 'component-docked.png') })
  await shell.screenshot({ path: path.join(evidence, 'workbench-dom.png') })
  await app.evaluate(({ webContents }) =>
    webContents
      .getAllWebContents()
      .find((wc) => wc.getURL().includes('/component/index.html'))
      .forcefullyCrashRenderer(),
  )
  await expect(shell.getByText(/CRASHED：示例组件退出/)).toBeVisible()
  await shell.getByRole('button', { name: '重置布局', exact: true }).click()
  await expect(shell.getByTestId('panel-count')).toHaveText('4 个模块已打开')
  console.log('PASS 20 次同视图停靠/分离，中文/队列/计数/会话保持；权限、遮挡与崩溃隔离')
} finally {
  await app.close()
}

for (const kind of ['missing', 'incompatible']) {
  const fixture = path.join(evidence, kind)
  if (kind === 'incompatible') {
    await cp(samplePath, fixture, { recursive: true })
    const manifest = JSON.parse(await readFile(path.join(fixture, 'component.json'), 'utf8'))
    manifest.protocol = '99.0'
    await writeFile(path.join(fixture, 'component.json'), JSON.stringify(manifest))
  }
  app = await launch(fixture, true, 'workbench')
  try {
    const shell = await findPage(app, '/workbench/index.html')
    await shell.getByRole('button', { name: '示例组件', exact: true }).click()
    await expect(
      shell.getByRole('button', {
        name: new RegExp(kind === 'missing' ? 'NOT_INSTALLED' : 'INCOMPATIBLE'),
      }),
    ).toBeVisible()
    await expect(shell.getByTestId('panel-count')).toHaveText('4 个模块已打开')
    await background(app)
  } finally {
    await app.close()
  }
}
expect(errors).toEqual([])
console.log(
  `PASS 缺失/不兼容反馈；证据目录 ${evidence}。未验证真实桌面标题栏拖动、声音连续性、安装卸载。`,
)
