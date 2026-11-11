import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import executable from 'electron'
const root = path.resolve('dist/component-prototype')
await mkdir('tmp', { recursive: true })
const evidence = await mkdtemp(path.resolve('tmp/music-session-'))
const profile = path.join(evidence, 'profile')
const args = [
  path.join(root, 'host'),
  '--user-data-dir=' + profile,
  '--workbench=' + path.resolve('out/renderer/index.html'),
]
const env = { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' }
const launch = (mode) => electron.launch({ args: [...args, '--mode=' + mode], env })
async function page(app, fragment) {
  await expect.poll(() => app.windows().some((p) => p.url().includes(fragment))).toBe(true)
  return app.windows().find((p) => p.url().includes(fragment))
}
let app = await launch('music')
try {
  const music = await page(app, '/music/index.html')
  await music.getByRole('tab', { name: '推荐试听' }).click()
  await music.getByRole('button', { name: '模型设置' }).click()
  await music.getByLabel('服务商').selectOption('offline')
  await music.getByRole('button', { name: '保存设置' }).click()
  await music.getByLabel('今天想听什么').fill('电子')
  await music.getByRole('button', { name: '生成离线试听单' }).click()
  await expect(music.locator('li')).toHaveCount(5)
  await music.getByText('匹配目录', { exact: true }).click()
  await music.getByRole('button', { name: '夜航变奏 · 变奏版' }).click()
  await expect(music.getByText('目录无此录音')).toBeVisible()
  const decoded = await music.evaluate(async () => {
    const context = new OfflineAudioContext(1, 320000, 16000)
    const rows = (await window.music.state()).items.filter((r) => r.status === '就绪')
    for (const row of rows) {
      const bytes = await window.music.bytes(row.id)
      const buffer = await context.decodeAudioData(bytes.buffer)
      if (buffer.duration !== 20 || !buffer.getChannelData(0).some((n) => Math.abs(n) > 0.01))
        return false
    }
    await window.music.release()
    return rows.length === 4
  })
  expect(decoded).toBe(true)
  await music.getByRole('button', { name: '试听潮汐' }).click()
  const clock = () => music.locator('audio').evaluate((a) => a.currentTime)
  await expect.poll(clock).toBeGreaterThan(0.3)
  await music.evaluate(() => {
    window.originalAudio = document.querySelector('audio')
    window.loads = 0
    window.originalAudio.addEventListener('loadstart', () => window.loads++)
  })
  const src = await music.locator('audio').evaluate((a) => a.currentSrc)
  await music.getByText('加入工作台', { exact: true }).click()
  const shell = await page(app, '/out/renderer/index.html')
  await expect(music.getByText('分离窗口', { exact: true })).toBeVisible()
  const dockTime = await clock()
  await promisify(execFile)(executable, [...args, '--mode=music'], {
    env,
    windowsHide: true,
    timeout: 10000,
  })
  await music.getByText('分离窗口', { exact: true }).click()
  await expect(music.getByText('加入工作台', { exact: true })).toBeVisible()
  await shell.evaluate(() => window.close())
  await expect.poll(clock).toBeGreaterThan(dockTime + 0.2)
  expect(
    await music.evaluate(
      () =>
        window.originalAudio === document.querySelector('audio') &&
        !window.originalAudio.paused &&
        window.loads === 0,
    ),
  ).toBe(true)
  expect(await music.locator('audio').evaluate((a) => a.currentSrc)).toBe(src)
  await music.getByRole('button', { name: '下一首' }).click()
  await expect.poll(() => music.locator('audio').evaluate((a) => a.currentSrc)).not.toBe(src)
  const library = path.join(evidence, 'library')
  await mkdir(library)
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
  }, library)
  await music.getByLabel('保留', { exact: true }).first().check()
  await music.getByRole('button', { name: /保留所选/ }).click()
  await expect(music.locator('li').first()).toContainText('已入库')
  await music.evaluate(() => {
    document.querySelector('.music-scroll').scrollTop = 0
    delete document.documentElement.dataset.backdrop
  })
  await music.screenshot({ path: path.join(evidence, 'standalone.png') })
  await app.evaluate(({ BaseWindow }) =>
    BaseWindow.getAllWindows()
      .find((w) => w.isVisible())
      .setSize(400, 480),
  )
  expect(await music.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await music.screenshot({ path: path.join(evidence, 'small.png') })
  await expect.poll(clock).toBeGreaterThan(1.2)
} finally {
  await app.close()
}
app = await launch('music')
try {
  const music = await page(app, '/music/index.html')
  await expect(music.getByRole('button', { name: /从 .* 秒继续/ })).toBeVisible()
  expect(await music.locator('audio').evaluate((a) => a.paused)).toBe(true)
  await music.getByRole('button', { name: /从 .* 秒继续/ }).click()
  await expect.poll(() => music.locator('audio').evaluate((a) => a.currentTime)).toBeGreaterThan(1)
  await music.getByText('加入工作台', { exact: true }).click()
  const shell = await page(app, '/out/renderer/index.html')
  for (const [direction, u, v] of [
    ['left', 0.08, 0.5],
    ['right', 0.92, 0.5],
    ['above', 0.5, 0.08],
    ['below', 0.5, 0.92],
    ['within', 0.5, 0.5],
  ]) {
    await music.getByText('分离窗口', { exact: true }).click()
    await expect(shell.getByRole('tab', { name: '音乐试听', exact: true })).toHaveCount(0)
    const group = shell
      .locator('.dv-groupview')
      .filter({ has: shell.getByRole('tab', { name: '模块 2', exact: true }) })
    const box = await group.boundingBox()
    const info = await app.evaluate(
      ({ BaseWindow, BrowserWindow, screen }, { box, u, v }) => {
        const source = BaseWindow.getAllWindows().find((w) => w.getTitle().includes('音乐试听'))
        const dest = BrowserWindow.getAllWindows()[0].getContentBounds()
        const x = Math.round(dest.x + box.x + u * box.width - source.getBounds().width / 2)
        const y = Math.round(dest.y + box.y + v * box.height - 16)
        source.setPosition(x, y - 600)
        screen.getCursorScreenPoint = () => {
          const b = source.getBounds()
          return { x: Math.round(b.x + b.width / 2), y: b.y + 16 }
        }
        return {
          x,
          y,
          id: source.id,
          hwnd: source.getNativeWindowHandle().readBigUInt64LE().toString(),
        }
      },
      { box, u, v },
    )
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
          info.hwnd,
          String(value),
        ],
        { windowsHide: true, timeout: 10000 },
      )
    await message(0x231)
    await message(0x216)
    await app.evaluate(({ BaseWindow }, i) => BaseWindow.fromId(i.id).setPosition(i.x, i.y), info)
    await expect(shell.locator('.component-drop-preview')).toHaveAttribute(
      'data-direction',
      direction,
    )
    await message(0x232)
    await expect(music.getByText('分离窗口', { exact: true })).toBeVisible()
    const docked = shell
      .locator('.dv-groupview')
      .filter({ has: shell.getByRole('tab', { name: '音乐试听', exact: true }) })
    const position = await docked.boundingBox(),
      base = await group.boundingBox()
    if (direction === 'within') expect(position).toEqual(base)
    if (direction === 'left') expect(position.x).toBeLessThan(base.x)
    if (direction === 'right') expect(position.x).toBeGreaterThan(base.x)
    if (direction === 'above') expect(position.y).toBeLessThan(base.y)
    if (direction === 'below') expect(position.y).toBeGreaterThan(base.y)
  }
  await shell.getByRole('button', { name: 'Close 音乐试听', exact: true }).click()
  await expect
    .poll(() => app.windows().filter((p) => p.url().includes('/music/index.html')).length)
    .toBe(0)
  const windowMenu = shell.getByRole('button', { name: '窗口', exact: true })
  const musicItem = shell.getByRole('menuitem', { name: '音乐试听', exact: true })
  await expect(shell.getByRole('button', { name: /^(音乐试听|示例组件)$/ })).toHaveCount(0)
  await windowMenu.click()
  await expect(shell.getByRole('menuitem')).toHaveText([
    '模块 1',
    '模块 2',
    '模块 3',
    '模块 4',
    '音乐试听',
    '重置布局',
  ])
  // Off-screen capture cannot composite the Windows acrylic background.
  await shell.evaluate(() => {
    delete document.documentElement.dataset.backdrop
  })
  await shell.screenshot({ path: path.join(evidence, 'window-menu.png'), animations: 'disabled' })
  await musicItem.click()
  const reopened = await page(app, '/music/index.html')
  await expect(reopened.getByText('分离窗口', { exact: true })).toBeVisible()
  expect(await reopened.locator('audio').evaluate((a) => a.paused)).toBe(true)
  await shell.getByRole('tab', { name: '模块 2', exact: true }).click()
  await windowMenu.click()
  await musicItem.click()
  await expect(shell.getByRole('tab', { name: '音乐试听', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await reopened.evaluate(() => window.music.clean())
  expect(
    await reopened.evaluate(
      async () => (await window.music.state()).items.filter((i) => i.status === '就绪').length,
    ),
  ).toBe(0)
  await reopened.screenshot({ path: path.join(evidence, 'docked.png') })
  console.log('PASS 离线流程、录音解码、同视图停靠分离、切歌、保存、重启手动恢复。截图 ' + evidence)
} finally {
  await app.close()
}

app = await launch('workbench')
try {
  const shell = await page(app, '/out/renderer/index.html')
  await expect(shell.getByRole('tab', { name: '音乐试听', exact: true })).toBeVisible()
  const music = await page(app, '/music/index.html')
  expect(await music.locator('audio').evaluate((a) => a.paused)).toBe(true)
  await shell.getByRole('button', { name: 'Close 模块 4', exact: true }).click()
  await shell.evaluate(() => {
    window.addEventListener(
      'beforeunload',
      () => {
        const saved = JSON.parse(localStorage.getItem('workbench.layout'))
        const addSample = (node) => {
          if (node.type === 'branch') node.data.forEach(addSample)
          else if (node.data.views.includes('module-1')) node.data.views.push('component-example')
        }
        addSample(saved.layout.grid.root)
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
  await expect(shell.getByRole('tab')).toHaveCount(4)
  await expect(shell.getByRole('tab', { name: '模块 4', exact: true })).toHaveCount(0)
  await expect(shell.getByRole('tab', { name: '示例组件', exact: true })).toHaveCount(0)
  await expect(shell.getByRole('tab', { name: '音乐试听', exact: true })).toBeVisible()
  await expect
    .poll(() =>
      shell.evaluate(() => {
        const { layout } = JSON.parse(localStorage.getItem('workbench.layout'))
        return Object.keys(layout.panels).sort()
      }),
    )
    .toEqual(['component-music', 'module-1', 'module-2', 'module-3'])
} finally {
  await app.close()
}
