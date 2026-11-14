import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, cp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import executable from 'electron'

const root = path.resolve('dist/component-prototype')
await mkdir('tmp', { recursive: true })
const evidence = await mkdtemp(path.resolve('tmp/component-prototype-'))
const errors = []
async function launch(component, workbench = true, mode = 'standalone', reuseProfile) {
  const profile = reuseProfile ?? (await mkdtemp(path.join(evidence, 'profile-')))
  const app = await electron.launch({
    timeout: 30000,
    args: [
      path.join(root, 'host'),
      `--user-data-dir=${profile}`,
      `--component=${component}`,
      `--mode=${mode}`,
      ...(workbench ? [`--workbench=${path.join(root, 'workbench/index.html')}`] : []),
    ],
    env: { ...process.env, FITBAY_TEST_PANELS: '1', WORKBENCH_TEST_BACKGROUND: '1' },
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
async function restoreStandaloneSlot(shell) {
  await shell.evaluate(() => {
    window.addEventListener(
      'beforeunload',
      () => {
        const saved = JSON.parse(localStorage.getItem('workbench.layout'))
        const addSlot = (node) => {
          if (node.type === 'branch') return node.data.forEach(addSlot)
          if (node.data.views.includes('module-1')) node.data.views.push('component-example')
        }
        addSlot(saved.layout.grid.root)
        saved.layout.panels['component-example'] = {
          id: 'component-example',
          contentComponent: 'component-slot',
          title: '示例组件',
        }
        localStorage.setItem('workbench.layout', JSON.stringify(saved))
      },
      { once: true },
    )
  })
  await shell.reload()
}
const samplePath = path.join(root, 'component')
let app = await launch(samplePath, false)
try {
  const sample = await findPage(app, '/component/index.html')
  await expect(sample.getByText('独立窗口', { exact: true })).toBeVisible()
  await expect(sample.locator('.fui-Input')).toHaveCount(1)
  const material = await sample.evaluate(() => {
    const root = document.documentElement
    const provider = document.querySelector('.sample-shell')
    const nativeMaterial = root.dataset.backdrop
    const gradient = getComputedStyle(provider).backgroundImage
    delete root.dataset.backdrop
    const fallback = getComputedStyle(root).backgroundColor
    if (nativeMaterial) root.dataset.backdrop = nativeMaterial
    return { gradient, fallback }
  })
  expect(material.gradient).toBe('none')
  expect(material.fallback).toBe('rgb(32, 34, 39)')

  const queue = sample.getByRole('combobox', { name: '队列选择' })
  await queue.click()
  const listbox = sample.getByRole('listbox')
  if (await sample.evaluate(() => matchMedia('(forced-colors: active)').matches)) {
    await expect(listbox).toHaveCSS('backdrop-filter', 'none')
  } else if (
    await sample.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches)
  ) {
    await expect(listbox).toHaveCSS('background-color', 'rgb(40, 44, 52)')
    await expect(listbox).toHaveCSS('backdrop-filter', 'none')
  } else {
    const menuColor = await sample.evaluate(() => {
      const probe = document.createElement('span')
      probe.style.backgroundColor = 'var(--menu-surface)'
      document.body.append(probe)
      const color = getComputedStyle(probe).backgroundColor
      probe.remove()
      return color
    })
    expect(menuColor).toMatch(/^rgba\(/)
    await expect(listbox).toHaveCSS('background-color', menuColor)
    await expect(listbox).toHaveCSS('backdrop-filter', 'blur(28px)')
  }
  await expect(sample.getByRole('option', { selected: true })).toHaveText('示例 A')
  await sample.screenshot({ path: path.join(evidence, 'queue-expanded.png') })
  await queue.press('Escape')
  await expect(sample.getByRole('listbox')).toHaveCount(0)
  expect(await app.evaluate(({ Menu }) => Menu.getApplicationMenu())).toBeNull()
  expect(await sample.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
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
  await sample.getByRole('combobox', { name: '队列选择' }).click()
  await sample.getByRole('option', { name: '示例 B' }).click()
  await sample.getByRole('button', { name: '增加', exact: true }).click()
  const boot = await sample.locator('body').getAttribute('data-boot-id')
  const session = await sample.locator('#session').textContent()
  // Same two launcher intents and profile as the desktop CMD, without transfer buttons.
  const profile = await app.evaluate(({ app }) => app.getPath('userData'))
  await promisify(execFile)(
    executable,
    [path.join(root, 'host'), `--user-data-dir=${profile}`, '--mode=workbench'],
    {
      env: { ...process.env, FITBAY_TEST_PANELS: '1', WORKBENCH_TEST_BACKGROUND: '1' },
      windowsHide: true,
      timeout: 15000,
    },
  )
  const dockShell = await findPage(app, '/workbench/index.html')
  const ordinaryPanel = dockShell.locator('.dv-groupview').first()
  const panelColor = await ordinaryPanel.evaluate((el) => getComputedStyle(el).backgroundColor)
  await expect(sample.locator('.sample-shell')).toHaveCSS('background-color', panelColor)
  const ordinaryInput = dockShell.locator('.workbench-search')
  for (const property of ['background-color', 'font-family', 'color']) {
    const ordinary = await ordinaryInput.evaluate(
      (el, prop) => getComputedStyle(el).getPropertyValue(prop),
      property,
    )
    await expect(sample.locator('.fui-Input')).toHaveCSS(property, ordinary)
  }
  // Emulate preferences in these isolated pages only.
  const sessions = await Promise.all(
    [dockShell, sample].map((page) => page.context().newCDPSession(page)),
  )
  for (const feature of ['prefers-reduced-transparency', 'forced-colors']) {
    const features = [{ name: feature, value: feature === 'forced-colors' ? 'active' : 'reduce' }]
    await Promise.all(sessions.map((s) => s.send('Emulation.setEmulatedMedia', { features })))
    const reference = await ordinaryPanel.evaluate((el) => getComputedStyle(el).backgroundColor)
    await expect(sample.locator('.sample-shell')).toHaveCSS('background-color', reference)
    await sample.getByRole('combobox').click()
    await expect(sample.getByRole('listbox')).toHaveCSS('backdrop-filter', 'none')
    await sample.keyboard.press('Escape')
  }
  await Promise.all(
    sessions.map(async (s) => {
      await s.send('Emulation.setEmulatedMedia', { features: [] })
      await s.detach()
    }),
  )
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
  // Model a pointer on the test title bar without touching the system cursor.
  await app.evaluate(({ screen, BaseWindow }, id) => {
    screen.getCursorScreenPoint = () => {
      const b = BaseWindow.fromId(id).getBounds()
      return { x: Math.round(b.x + b.width / 2), y: b.y + 16 }
    }
  }, info.id)
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
  await expect(dockShell.locator('.component-drop-preview')).toBeVisible()
  const blocker = await app.evaluate(({ BaseWindow, BrowserWindow }) => {
    const target = BrowserWindow.getAllWindows()[0].getBounds()
    const blocker = new BaseWindow({ ...target, show: false, skipTaskbar: true, alwaysOnTop: true })
    blocker.showInactive()
    // Reapply the off-screen test rectangle and Z order after native window placement.
    blocker.setBounds(target)
    blocker.moveTop()
    return blocker.id
  })
  // Wait for Windows to expose the off-screen blocker before releasing the drag.
  await expect
    .poll(() =>
      app.evaluate(
        ({ BaseWindow, BrowserWindow, screen }, { helper, id }) => {
          const requireHost = process.getBuiltinModule('node:module').createRequire(helper)
          const { shellExposed } = requireHost(helper)
          return shellExposed(
            screen.getCursorScreenPoint(),
            BaseWindow.fromId(id),
            BrowserWindow.getAllWindows()[0],
          )
        },
        { helper: path.join(root, 'host/native-dock.mjs'), id: info.id },
      ),
    )
    .toBe(false)
  await expect(dockShell.locator('.component-drop-preview')).toBeVisible()
  await message(0x232)
  await expect(sample.locator('#mode')).toHaveText('独立窗口')
  await expect(dockShell.locator('.component-drop-preview')).toHaveCount(0)
  await app.evaluate(({ BaseWindow }, id) => BaseWindow.fromId(id).close(), blocker)
  await position(info.x, info.y - 500)
  await message(0x231)
  await message(0x216)
  await position(info.x, info.y)
  await expect(dockShell.locator('.component-drop-preview')).toBeVisible()
  await dockShell.screenshot({ path: path.join(evidence, 'native-drop-preview.png') })
  await message(0x232)
  await expect(sample.locator('#mode')).toHaveText('已停靠')
  // Every preview must commit to the group under the simulated cursor.
  await sample.getByRole('button', { name: '分离窗口', exact: true }).click()
  for (const [direction, u, v] of [
    ['left', 0.08, 0.5],
    ['right', 0.92, 0.5],
    ['above', 0.5, 0.08],
    ['below', 0.5, 0.92],
    ['within', 0.5, 0.5],
  ]) {
    // Restore a tab in another group while the component is running independently.
    await restoreStandaloneSlot(dockShell)
    const componentGroup = dockShell.locator('.dv-groupview').filter({
      has: dockShell.getByRole('tab', { name: '示例组件', exact: true }),
    })
    await expect(componentGroup.getByRole('tab', { name: '模块 1', exact: true })).toHaveCount(1)
    const group = dockShell
      .locator('.dv-groupview')
      .filter({ has: dockShell.getByTestId('module-2') })
    const box = await group.boundingBox()
    const origin = await app.evaluate(({ BrowserWindow, BaseWindow }, id) => {
      const shell = BrowserWindow.getAllWindows()[0].getContentBounds()
      return { x: shell.x - BaseWindow.fromId(id).getBounds().width / 2, y: shell.y - 16 }
    }, info.id)
    const drop = async () => {
      await position(info.x, info.y - 500)
      await message(0x231)
      await message(0x216)
      await position(
        Math.round(origin.x + box.x + box.width * u),
        Math.round(origin.y + box.y + box.height * v),
      )
      await expect(dockShell.locator('.component-drop-preview')).toHaveAttribute(
        'data-direction',
        direction,
      )
      await message(0x232)
    }
    if (direction === 'left' || direction === 'above') {
      const lower = dockShell
        .locator('.dv-groupview')
        .filter({ has: dockShell.getByTestId('module-4') })
      if (direction === 'above') {
        const previousHeight = (await lower.boundingBox()).height
        const sash = dockShell
          .locator('.dv-vertical > .dv-sash-container > .dv-sash.dv-enabled')
          .first()
        const handle = await sash.boundingBox()
        await dockShell.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
        await dockShell.mouse.down()
        await dockShell.mouse.move(handle.x + handle.width / 2, handle.y - 50, { steps: 10 })
        await dockShell.mouse.up()
        await expect
          .poll(async () => (await lower.boundingBox()).height)
          .toBeGreaterThan(previousHeight + 30)
      }
      const heights = async () => [
        (await group.boundingBox()).height,
        (await lower.boundingBox()).height,
      ]
      const before = await heights()
      const checkHeights = async () => {
        const actual = await heights()
        for (const [index, height] of actual.entries())
          expect(Math.abs(height - before[index])).toBeLessThanOrEqual(2)
      }
      // Hold the same bounds gate used during a tab drag, through the timeout.
      await dockShell.evaluate(() => {
        document.documentElement.dataset.componentDrag = 'true'
      })
      await drop()
      await expect(dockShell.locator('.dv-groupview')).toHaveCount(5)
      await expect
        .poll(async () => (await dockShell.evaluate(() => window.componentHost.status())).error, {
          timeout: 10000,
        })
        .toContain('TIMEOUT')
      await expect(dockShell.locator('.dv-groupview')).toHaveCount(4)
      await dockShell.evaluate(() => {
        delete document.documentElement.dataset.componentDrag
      })
      await checkHeights()
      await dockShell.reload()
      await expect(componentGroup.getByRole('tab', { name: '模块 1', exact: true })).toHaveCount(1)
      await checkHeights()
    }
    await drop()
    await expect(sample.locator('#mode')).toHaveText('已停靠')
    await expect(dockShell.locator('.dv-groupview')).toHaveCount(direction === 'within' ? 4 : 5)
    if (direction === 'within') {
      const merged = dockShell
        .locator('.dv-groupview')
        .filter({ has: dockShell.getByRole('tab', { name: '示例组件', exact: true }) })
      await expect(merged.getByRole('tab', { name: '模块 2', exact: true })).toHaveCount(1)
    } else {
      const target = await group.boundingBox()
      const placed = await componentGroup.boundingBox()
      const horizontal = direction === 'left' || direction === 'right'
      const axis = horizontal ? 'x' : 'y'
      const size = horizontal ? 'width' : 'height'
      const cross = horizontal ? 'y' : 'x'
      const crossSize = horizontal ? 'height' : 'width'
      const [first, second] = ['left', 'above'].includes(direction)
        ? [placed, target]
        : [target, placed]
      const gap = await dockShell
        .locator('.docking-area')
        .evaluate((el) => Number.parseFloat(getComputedStyle(el).getPropertyValue('--space-8')))
      expect(Math.abs(second[axis] - first[axis] - first[size] - gap)).toBeLessThanOrEqual(1)
      expect(Math.abs(first[cross] - second[cross])).toBeLessThanOrEqual(1)
      expect(Math.abs(first[crossSize] - second[crossSize])).toBeLessThanOrEqual(1)
      await sample.getByRole('button', { name: '分离窗口', exact: true }).click()
      await expect(dockShell.getByRole('tab', { name: '示例组件', exact: true })).toHaveCount(0)
    }
  }
  const tab = dockShell.getByRole('tab', { name: '示例组件', exact: true })
  const destination = dockShell.getByRole('tab', { name: '模块 1', exact: true })
  const from = await tab.boundingBox()
  const to = await destination.boundingBox()
  await dockShell.mouse.move(from.x + 24, from.y + 14)
  await dockShell.mouse.down()
  await dockShell.mouse.move(to.x + 24, to.y + 14, { steps: 24 })
  await dockShell.mouse.up()
  const regrouped = dockShell.locator('.dv-groupview').filter({ has: tab })
  await expect(regrouped.getByRole('tab', { name: '模块 1', exact: true })).toHaveCount(1)
  await expect(sample.locator('#mode')).toHaveText('已停靠')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 820))
  await expect
    .poll(async () => {
      const slot = await regrouped.locator('.dv-content-container').boundingBox()
      if (!slot) return false
      return Math.abs((await sample.evaluate(() => innerWidth)) - slot.width) < 3
    })
    .toBe(true)
  const grip = await dockShell.getByRole('tab', { name: '示例组件', exact: true }).boundingBox()
  // A click/short move and an Escape-cancelled drag must retain the panel.
  await dockShell.mouse.move(grip.x + 24, grip.y + 16)
  await dockShell.mouse.down()
  await dockShell.mouse.move(grip.x + 26, grip.y + 16)
  await dockShell.mouse.up()
  await expect(sample.locator('#mode')).toHaveText('已停靠')
  await dockShell.mouse.move(grip.x + 24, grip.y + 16)
  await dockShell.mouse.down()
  await dockShell.mouse.move(-80, grip.y + 16, { steps: 5 })
  await dockShell.keyboard.press('Escape')
  await dockShell.mouse.up()
  await expect(sample.locator('#mode')).toHaveText('已停靠')
  await dockShell.mouse.move(grip.x + 24, grip.y + 16)
  await dockShell.mouse.down()
  await dockShell.mouse.move(-80, grip.y + 16, { steps: 12 })
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
  await expect(sample.getByRole('combobox', { name: '队列选择' })).toHaveText('示例 B')
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
  await shell.getByRole('button', { name: '布局', exact: true }).click()
  await shell.getByRole('menuitem', { name: '管理布局', exact: true }).click()
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
  await expect(sample.locator('html')).toHaveAttribute('data-theme', 'dark')
  await shell.getByRole('button', { name: '布局', exact: true }).click()
  await shell.getByRole('menuitem', { name: '管理布局', exact: true }).click()
  await shell.getByRole('button', { name: '还原默认布局', exact: true }).click()
  await expect
    .poll(() => shell.evaluate(async () => (await window.componentHost.status()).presentation))
    .toBe('background')
  await shell.getByRole('button', { name: '组件', exact: true }).click()
  await shell.getByRole('menuitem', { name: '显示示例组件', exact: true }).click()
  await expect(sample.locator('#mode')).toHaveText('已停靠')
  await sample.getByRole('button', { name: '分离窗口', exact: true }).click()
  await expect(sample.locator('#mode')).toHaveText('独立窗口')
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
  // Renderer captures omit native Acrylic. Capture the supported opaque fallback
  // separately for legibility review; never label this as native material evidence.
  const savedMaterial = await sample.evaluate(() => {
    const value = document.documentElement.dataset.backdrop
    delete document.documentElement.dataset.backdrop
    return value
  })
  await sample.screenshot({ path: path.join(evidence, 'component-fallback-dark.png') })
  await expect(sample.locator('html')).toHaveAttribute('data-theme', 'dark')
  await sample.evaluate((value) => {
    if (value) document.documentElement.dataset.backdrop = value
  }, savedMaterial)
  await sample.getByRole('button', { name: '加入工作台', exact: true }).click()
  await expect(sample.locator('#mode')).toHaveText('已停靠')
  await sample.waitForTimeout(300)
  await sample.screenshot({ path: path.join(evidence, 'component-docked.png') })
  await expect(sample.locator('.sample-shell')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(sample.locator('html')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  const slotGroup = shell
    .locator('.dv-groupview')
    .filter({ has: shell.getByRole('tab', { name: '示例组件', exact: true }) })
  await expect(slotGroup).toHaveCSS('background-color', panelColor)
  await shell.screenshot({ path: path.join(evidence, 'workbench-dom.png') })
  // Compare panel tints over an identical backdrop. The unmodified shell capture above
  // includes the workbench's independently adjustable material and grain.
  const clearShell = await shell.addStyleTag({
    content:
      '.workbench, .workbench::before, .workbench::after { background: transparent !important; }',
  })
  const layerFile = path.join(evidence, 'workbench-panel-layer.png')
  await shell.screenshot({ path: layerFile })
  await clearShell.evaluate((el) => el.remove())
  const shellWidth = await shell.evaluate(() => innerWidth)
  const pixels = await app.evaluate(
    ({ BrowserWindow, nativeImage }, { evidence, shellWidth, layerFile }) => {
      const host = BrowserWindow.getAllWindows()[0]
      const view = host.contentView.children.at(-1).getBounds()
      const hostImage = nativeImage.createFromPath(layerFile)
      const scale = hostImage.getSize().width / shellWidth
      const pixel = (image, x, y) => [...image.crop({ x, y, width: 1, height: 1 }).toBitmap()]
      return {
        docked: pixel(
          hostImage,
          Math.round((view.x + 8) * scale),
          Math.round((view.y + 8) * scale),
        ),
        standalone: pixel(nativeImage.createFromPath(evidence + '/component.png'), 8, 8),
        overlay: pixel(nativeImage.createFromPath(evidence + '/component-docked.png'), 8, 8),
      }
    },
    { evidence, shellWidth, layerFile },
  )
  expect(pixels.docked).toEqual(pixels.standalone)
  expect(pixels.overlay[3]).toBe(0)
  await app.evaluate(({ webContents }) =>
    webContents
      .getAllWebContents()
      .find((wc) => wc.getURL().includes('/component/index.html'))
      .forcefullyCrashRenderer(),
  )
  await expect(shell.getByText(/CRASHED：示例组件退出/)).toBeVisible()
  await shell.getByRole('button', { name: '布局', exact: true }).click()
  await shell.getByRole('menuitem', { name: '管理布局', exact: true }).click()
  await shell.getByRole('button', { name: '还原默认布局', exact: true }).click()
  await expect(shell.locator('.dv-tab[data-tab-panel-id]')).toHaveCount(4)
  console.log('PASS 20 次同视图停靠/分离，中文/队列/计数/会话保持；权限、遮挡与崩溃隔离')
} finally {
  await app.close()
}

const restartProfile = await mkdtemp(path.join(evidence, 'restart-'))
app = await launch(samplePath, true, 'workbench', restartProfile)
try {
  const shell = await findPage(app, '/workbench/index.html')
  await shell.evaluate(() => window.componentHost.open())
  const sample = await findPage(app, '/component/index.html')
  await expect(sample.locator('#mode')).toHaveText('已停靠')
  // Opening the sample in the test host must never create a second top-level HWND just to hide it.
  expect(await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().length)).toBe(1)
  await shell.getByRole('tab', { name: '模块 2', exact: true }).click()
  await expect(shell.getByTestId('module-2')).toBeVisible()
} finally {
  await app.close()
}
app = await launch(samplePath, true, 'workbench', restartProfile)
try {
  const shell = await findPage(app, '/workbench/index.html')
  const sample = await findPage(app, '/component/index.html')
  await expect(sample.locator('#mode')).toHaveText('已停靠')
  const moduleTab = shell.getByRole('tab', { name: '模块 2', exact: true })
  const componentTab = shell.getByRole('tab', { name: '示例组件', exact: true })
  await expect(moduleTab).toHaveAttribute('aria-selected', 'true')
  const viewVisible = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].contentView.children.at(-1).getVisible(),
    )
  await expect.poll(viewVisible).toBe(false)
  await componentTab.click()
  await expect.poll(viewVisible).toBe(true)
  await moduleTab.click()
  await expect.poll(viewVisible).toBe(false)
  const boot = await sample.locator('body').getAttribute('data-boot-id')
  await promisify(execFile)(
    executable,
    [path.join(root, 'host'), `--user-data-dir=${restartProfile}`, '--mode=component'],
    {
      env: { ...process.env, FITBAY_TEST_PANELS: '1', WORKBENCH_TEST_BACKGROUND: '1' },
      windowsHide: true,
      timeout: 15000,
    },
  )
  await expect(componentTab).toHaveAttribute('aria-selected', 'true')
  await expect.poll(viewVisible).toBe(true)
  expect(await sample.locator('body').getAttribute('data-boot-id')).toBe(boot)
  await background(app)
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
    const result = await shell.evaluate(() => window.componentHost.open())
    expect(result.ok).toBe(false)
    expect(result.error).toContain(kind === 'missing' ? 'NOT_INSTALLED' : 'INCOMPATIBLE')
    await expect(shell.locator('.dv-tab[data-tab-panel-id]')).toHaveCount(4)
    if (kind === 'missing') {
      await cp(samplePath, fixture, { recursive: true })
      await shell.getByRole('tab', { name: '模块 1', exact: true }).click()
      await shell.getByRole('button', { name: '布局', exact: true }).click()
      await shell.getByRole('menuitem', { name: '管理布局', exact: true }).click()
      await expect(shell.getByRole('dialog')).toBeVisible()
      const results = await shell.evaluate(() =>
        Promise.all([window.componentHost.open(), window.componentHost.open()]),
      )
      expect(results).toEqual([{ ok: true }, { ok: true }])
      expect((await shell.evaluate(() => window.componentHost.status())).phase).toBe('attaching')
      expect(await shell.evaluate(() => window.componentHost.open())).toEqual({ ok: true })
      const pendingTab = shell.locator('[role="tab"]').filter({ hasText: '示例组件' })
      await expect(pendingTab).toHaveCount(1)
      const savedPanels = () =>
        shell.evaluate(() =>
          Object.keys(JSON.parse(localStorage.getItem('workbench.layout')).layout.panels).sort(),
        )
      const modules = ['module-1', 'module-2', 'module-3', 'module-4']
      await shell.waitForTimeout(400)
      const duringAttach = await savedPanels()
      await expect
        .poll(async () => (await shell.evaluate(() => window.componentHost.status())).error, {
          timeout: 10000,
        })
        .toContain('TIMEOUT')
      expect({ duringAttach, tabsAfterTimeout: await pendingTab.count() }).toEqual({
        duringAttach: modules,
        tabsAfterTimeout: 0,
      })
      const standalone = await findPage(app, '/missing/index.html')
      await expect(standalone.locator('#mode')).toHaveText('独立窗口')
      await shell.reload()
      await expect(shell.locator('.dv-tab[data-tab-panel-id]')).toHaveCount(4)
      expect(await savedPanels()).toEqual(modules)
      await expect(shell.locator('.dv-active-group .dv-active-tab')).toContainText('模块 1')
      await restoreStandaloneSlot(shell)
      const originalGroup = shell
        .locator('.dv-groupview')
        .filter({ has: shell.getByRole('tab', { name: '模块 1', exact: true }) })
      await expect(originalGroup.getByRole('tab', { name: '示例组件', exact: true })).toHaveCount(1)
      await shell.getByRole('button', { name: '布局', exact: true }).click()
      await shell.getByRole('menuitem', { name: '管理布局', exact: true }).click()
      await shell.evaluate(() => window.componentHost.open())
      await expect
        .poll(async () => (await shell.evaluate(() => window.componentHost.status())).phase, {
          timeout: 10000,
        })
        .toBe('ready')
      await shell.keyboard.press('Escape')
      await shell.reload()
      await expect(originalGroup.getByRole('tab', { name: '示例组件', exact: true })).toHaveCount(1)
      await expect(shell.locator('.dv-active-group .dv-active-tab')).toContainText('模块 1')
      await shell.evaluate(() => window.componentHost.open())
      const sample = await findPage(app, '/missing/index.html')
      await expect(sample.locator('#mode')).toHaveText('已停靠')
      await expect(shell.getByRole('tab', { name: '示例组件', exact: true })).toHaveCount(1)
      expect(
        await app.evaluate(
          ({ webContents }) =>
            webContents
              .getAllWebContents()
              .filter((wc) => wc.getURL().includes('/missing/index.html')).length,
        ),
      ).toBe(1)
      console.log('PASS 首次连接失败后补齐组件，并发重试共用单个已停靠视图')
    }
    await background(app)
  } finally {
    await app.close()
  }
}
expect(errors).toEqual([])
console.log(
  `PASS 缺失/不兼容反馈；证据目录 ${evidence}。未验证真实桌面标题栏拖动、声音连续性、安装卸载。`,
)
