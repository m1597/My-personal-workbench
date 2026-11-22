import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { _electron, chromium, expect } from '@playwright/test'
import { actionCatalogue } from '../examples/component-host/prompt-actions.mjs'
const folder = await mkdtemp(path.resolve('tmp/toolkit-'))
const profile = path.join(folder, 'profile')
await mkdir(path.join(profile, 'toolkit'), { recursive: true })
const requests = []
let fail = false
const server = createServer(async (req, res) => {
  const chunks = []
  for await (const c of req) chunks.push(c)
  requests.push({ ...JSON.parse(Buffer.concat(chunks)), path: req.url })
  res.writeHead(fail ? 503 : 200, { 'content-type': 'application/json' })
  const content = requests.at(-1).messages[0].content
  const answer =
    typeof content === 'string' && content.includes('只返回 JSON 数组')
      ? JSON.stringify(
          JSON.parse(content.slice(content.indexOf('\n') + 1)).map(({ id }) => ({
            id,
            zh: '测试译文',
          })),
        )
      : '测试接口回答 ' + requests.length
  res.end(JSON.stringify({ choices: [{ message: { content: answer } }] }))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const keys = {
  capture: { enabled: true, key: 'Control+Alt+F8' },
  selection: { enabled: true, key: 'Control+Alt+F9' },
}
await writeFile(
  path.join(profile, 'toolkit/settings.json'),
  JSON.stringify({
    ...keys,
    endpoint: 'http://127.0.0.1:' + server.address().port + '/v1',
    model: 'test',
    secret: '',
  }),
)
await writeFile(path.join(folder, 'math.md'), '推导这道题')
await actionCatalogue(profile).pin(folder, 'math.md', '解释推导', 'image')
const app = await _electron.launch({
  args: [path.resolve('components/toolkit'), '--workbench-profile=' + profile],
})
try {
  const home = await app.firstWindow()
  await expect(home.getByText('工具集', { exact: true })).toBeVisible()
  await home.getByRole('button', { name: '设置', exact: true }).click()
  await category(home, 'API 与模型')
  const marker = randomUUID()
  await expect(home.getByText('保存 API 配置')).toBeEnabled()
  await home.getByLabel('API 密钥').fill(marker)
  await home.getByText('保存 API 配置').click()
  await expect(home.getByRole('status')).toContainText('已保存')
  assert(
    !(
      await (
        await import('node:fs/promises')
      ).readFile(path.join(profile, 'toolkit/settings.json'), 'utf8')
    ).includes(marker),
  )
  await home.getByRole('combobox', { name: '用途' }).click()
  await home.getByRole('option', { name: '视觉问答', exact: true }).click()
  await home.getByLabel('服务地址').fill('http://127.0.0.1:' + server.address().port + '/vision')
  await home.getByLabel('模型名').fill('vision-test')
  await home.getByText('保存 API 配置').click()
  await expect(home.getByRole('status')).toContainText('已保存')
  await category(home, '快捷键')
  const captureRow = home.getByRole('region', { name: '屏幕截图' })
  const field = captureRow.getByRole('textbox')
  await field.click()
  await field.press(keys.selection.key)
  await captureRow.getByRole('button', { name: '保存屏幕截图快捷键' }).click()
  await expect(home.getByRole('status')).toContainText('占用')
  assert(
    await app.evaluate(
      ({ globalShortcut }, key) => globalShortcut.isRegistered(key),
      keys.capture.key,
    ),
  )
  await home.getByText('停用', { exact: true }).first().click()
  assert(
    !(await app.evaluate(
      ({ globalShortcut }, key) => globalShortcut.isRegistered(key),
      keys.capture.key,
    )),
  )
  await captureRow.getByText('启用', { exact: true }).click()
  await expect
    .poll(() =>
      app.evaluate(({ globalShortcut }, key) => globalShortcut.isRegistered(key), keys.capture.key),
    )
    .toBe(true)
  await home.setViewportSize({ width: 320, height: 600 })
  await home.screenshot({ path: path.join(folder, 'home-narrow.png') })
  assert(await home.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  console.log('PASS settings, conflict, narrow window', folder)
  // Keep the captured region on a dedicated, synthetic surface.
  const fixtureReady = app.waitForEvent('window')
  await app.evaluate(async ({ BrowserWindow, screen, desktopCapturer }) => {
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    globalThis.toolkitFixture = new BrowserWindow({ ...d.bounds, frame: false, skipTaskbar: true })
    await globalThis.toolkitFixture.loadURL(
      'data:text/html,' +
        encodeURIComponent(
          '<title>FitBaySelectionTest</title><body style="margin:0;background:white;color:black"><div style="font:48px Arial;margin:30px">HELLO FITBAY 123</div></body>',
        ),
    )
    desktopCapturer.getSources = async ({ thumbnailSize }) => [
      {
        display_id: String(d.id),
        thumbnail: (await globalThis.toolkitFixture.webContents.capturePage()).resize(
          thumbnailSize,
        ),
      },
    ]
  })
  const fixture = await fixtureReady
  async function region() {
    const [overlay] = await Promise.all([
      app.waitForEvent('window', { timeout: 12000 }),
      home.evaluate(() => window.toolkit.capture()),
    ])
    await expect(overlay.locator('.screen img')).toBeVisible()
    await overlay.waitForFunction(() => document.querySelector('img')?.naturalWidth > 0)
    await overlay.mouse.click(9, 9)
    await expect(overlay.getByText('贴图置顶')).toBeHidden()
    await overlay.mouse.move(10, 10)
    await overlay.mouse.down()
    await overlay.mouse.move(570, 140)
    await overlay.mouse.up()
    await expect(overlay.getByText('贴图置顶')).toBeVisible()
    return overlay
  }
  let overlay = await region()
  const saved = path.join(folder, 'saved.png')
  await app.evaluate(({ dialog }, file) => {
    globalThis.originalSave = dialog.showSaveDialog
    dialog.showSaveDialog = async () => ({ filePath: file, canceled: false })
  }, saved)
  await overlay.getByText('保存', { exact: true }).click()
  await expect.poll(async () => (await import('node:fs')).existsSync(saved)).toBe(true)
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = globalThis.originalSave
  })
  assert.equal(requests.length, 0)
  overlay = await region()
  await app.evaluate(({ clipboard }) => {
    globalThis.clipboardImage = clipboard.write
    clipboard.write = async ([item]) => {
      globalThis.copiedImage = (await item.getType('image/png')).size
    }
  })
  await overlay.getByText('复制', { exact: true }).click()
  assert(
    await app.evaluate(({ clipboard }) => {
      clipboard.write = globalThis.clipboardImage
      return globalThis.copiedImage > 0
    }),
  )
  assert.equal(requests.length, 0)
  overlay = await region()
  let waiting = app.waitForEvent('window')
  await overlay.getByText('贴图置顶').click()
  const pin = await waiting
  await expect(pin.locator('.pinned img')).toBeVisible()
  assert(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some(
        (w) => w.getTitle() === 'FitBay 贴图' && w.isAlwaysOnTop(),
      ),
    ),
  )
  const pinWidth = await pin.evaluate(() => innerWidth)
  assert(Math.abs(pinWidth / 560 - 1) < 0.02, '贴图应保持框选时的显示宽度，实际 ' + pinWidth)
  await pin.screenshot({ path: path.join(folder, 'pin.png') })
  await pin.close()
  assert.equal(requests.length, 0)
  console.log('PASS native capture and pin')
  overlay = await region()
  waiting = app.waitForEvent('window')
  await overlay.getByText('翻译', { exact: true }).click()
  let result = await waiting
  await expect(result.getByRole('button', { name: '仅中文', exact: true })).toBeVisible({
    timeout: 25000,
  })
  assert.equal(requests[0].model, 'test')
  assert.equal(requests[0].path, '/v1/chat/completions')
  assert(/HELLO/i.test(requests[0].messages[0].content), 'OCR 未返回合成样张文字')
  await result.close()
  console.log('PASS local OCR to text-only API')
  overlay = await region()
  await writeFile(path.join(folder, 'math.md'), '最新推导模板')
  fail = true
  waiting = app.waitForEvent('window')
  await overlay.getByText('解释推导').click()
  result = await waiting
  await expect(result.getByRole('status')).toContainText('503')
  fail = false
  await result.getByText('解释推导').click()
  await expect(result.getByText('测试接口回答 3')).toBeVisible()
  assert.equal(requests[2].messages[0].content[0].text, '最新推导模板')
  assert.match(requests[2].messages[0].content[1].image_url.url, /^data:image\/png;base64,/)
  await result.getByLabel('问题').fill('下一步？')
  await result.getByText('追问', { exact: true }).click()
  await expect(result.getByText('测试接口回答 4')).toBeVisible()
  for (const request of requests.slice(1, 4)) {
    assert.equal(request.model, 'vision-test')
    assert.equal(request.path, '/vision/chat/completions')
  }
  assert.equal(requests[3].messages.length, 3)
  await app.evaluate(({ clipboard }) => {
    globalThis.clipboardText = clipboard.writeText
    clipboard.writeText = (text) => {
      globalThis.copiedResult = text
    }
  })
  await result.getByText('复制结果').click()
  assert.equal(
    await app.evaluate(({ clipboard }) => {
      clipboard.writeText = globalThis.clipboardText
      return globalThis.copiedResult
    }),
    '测试接口回答 4',
  )
  await result.getByText('固定', { exact: true }).click()
  await expect(result.getByText('取消固定')).toBeVisible()
  await result.screenshot({ path: path.join(folder, 'answer.png') })
  console.log('PASS custom action, PNG, 503 retry, follow-up and pin')
  if (process.argv.includes('--pdf')) {
    const pdf = path.join(folder, 'FitBaySelectionTest.pdf')
    await writeFile(
      pdf,
      Buffer.from(
        await app.evaluate(async () =>
          (await globalThis.toolkitFixture.webContents.printToPDF({})).toString('base64'),
        ),
        'base64',
      ),
    )
    const browser = await chromium.launchPersistentContext(path.join(folder, 'chrome'), {
      channel: 'chrome',
      headless: false,
      args: ['--force-renderer-accessibility', '--disable-extensions-except=', '--no-first-run'],
    })
    try {
      const page = browser.pages()[0]
      await page.goto(pathToFileURL(pdf).href, { waitUntil: 'commit', timeout: 15000 })
      await page.bringToFront()
      await page.waitForTimeout(2200)
      await page.screenshot({ path: path.join(folder, 'viewer.png') })
      await page.mouse.move(440, 150)
      await page.mouse.down()
      await page.mouse.move(872, 150, { steps: 14 })
      await page.mouse.up()
      await page.keyboard.press('Control+a')
      await page.waitForTimeout(200)
      waiting = app.waitForEvent('window', { timeout: 15000 })
      execFileSync('python', ['scripts/toolkit-pdf-hotkey.py'])
      const selected = await waiting
      await expect(selected.locator('pre').first()).toContainText('HELLO FITBAY 123')
      await selected.getByText('翻译', { exact: true }).click()
      await expect(selected.getByText('测试接口回答 5')).toBeVisible()
      assert.equal(typeof requests[4].messages[0].content, 'string')
      await selected.screenshot({ path: path.join(folder, 'pdf-selection.png') })
      await selected.getByText('问 AI', { exact: true }).click()
      await expect(selected.getByText('测试接口回答 6')).toBeVisible()
      assert.match(requests.at(-1).messages[0].content, /解释/)
      assert.equal(requests.at(-1).model, 'test')
      for (const question of ['这段文字是什么意思？', '再举一个例子']) {
        await selected.getByLabel('问题').fill(question)
        await selected.getByRole('button', { name: '追问', exact: true }).click()
        await expect(selected.getByRole('heading', { name: question, exact: true })).toBeVisible()
      }
      assert.equal(requests.at(-1).messages.length, 5)
      assert(requests.at(-1).messages.every((message) => typeof message.content === 'string'))
      await selected.close()
      await page.mouse.click(700, 350)
      const before = requests.length
      const empty = app.waitForEvent('window', { timeout: 15000 })
      execFileSync('python', ['scripts/toolkit-pdf-hotkey.py'])
      const message = await empty
      await expect(message.getByText(/没有读到文字/)).toBeVisible()
      assert.equal(requests.length, before)
      await message.close()
      console.log('PASS Chrome PDF, OS shortcut, extracted text, translation and empty selection')
    } finally {
      await browser.close()
    }
  }
  overlay = await region()
  waiting = app.waitForEvent('window')
  await overlay.getByText('问 AI', { exact: true }).click()
  const visual = await waiting
  await expect(visual.getByText(/^测试接口回答/)).toBeVisible()
  await visual.getByLabel('问题').fill('图中的数字是什么？')
  await visual.getByText('问 AI', { exact: true }).click()
  await expect(visual.getByText(/^测试接口回答/)).toBeVisible()
  await expect.poll(() => requests.at(-1).messages[0].content[0].text).toBe('图中的数字是什么？')
  assert.equal(requests.at(-1).messages[0].content[1].type, 'image_url')
  console.log('PASS default visual explanation and explicit free question with original screenshot')
  await visual.close()
  if (process.argv.includes('--host')) {
    const host = await _electron.launch({
      args: [
        path.resolve('dist/component-prototype/host'),
        '--mode=workbench',
        '--user-data-dir=' + profile,
        '--workbench=' + path.resolve('out/renderer/index.html'),
      ],
      env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
    })
    try {
      const shell = await host.firstWindow()
      await shell.getByRole('button', { name: '组件', exact: true }).click()
      await shell.getByRole('menuitemcheckbox', { name: '文件库' }).click()
      await expect
        .poll(() => shell.evaluate(async () => (await window.promptDock.status()).phase))
        .toBe('ready')
      await shell.getByRole('button', { name: '组件', exact: true }).click()
      await shell.locator('#window-menu').getByText('工具集', { exact: true }).click()
      const waiting = app.waitForEvent('window', { timeout: 20000 })
      await shell.getByRole('button', { name: '框选屏幕' }).click()
      const overlay = await waiting
      await expect(overlay.locator('.screen')).toBeVisible()
      assert(
        (await overlay.evaluate(() => window.toolkit.actions())).some(
          (a) => a.displayName === '解释推导',
        ),
      )
      await overlay.keyboard.down('Escape').catch((err) => {
        if (!overlay.isClosed()) throw err
      })
      await shell.screenshot({ path: path.join(folder, 'workbench.png') })
      console.log('PASS workbench dock panel to running standalone capture')
    } finally {
      await host.close()
    }
  }
  await fixture.close()
} finally {
  await app.close()
  server.close()
}
if (process.argv.includes('--absent')) {
  const standalone = await _electron.launch({
    executablePath: path.resolve('.cache/fitbay-build/toolkit/win-unpacked/FitBay Toolkit.exe'),
    args: ['--workbench-profile=' + profile],
  })
  try {
    const home = await standalone.firstWindow()
    await home.getByRole('button', { name: '设置', exact: true }).click()
    await category(home, 'API 与模型')
    await expect(home.getByLabel('模型名')).toHaveValue('test')
    await home.getByRole('combobox', { name: '用途' }).click()
    await home.getByRole('option', { name: '视觉问答', exact: true }).click()
    await expect(home.getByLabel('模型名')).toHaveValue('vision-test')
    const waiting = standalone.waitForEvent('window')
    await home.getByRole('button', { name: '返回', exact: true }).click()
    await home.getByText('框选屏幕', { exact: true }).click()
    const overlay = await waiting
    await expect(overlay.locator('.screen')).toBeVisible()
    assert.deepEqual(await overlay.evaluate(() => window.toolkit.actions()), [])
    await overlay.mouse.move(12, 12)
    await overlay.mouse.down()
    await overlay.mouse.move(130, 90)
    await overlay.mouse.up()
    await expect(overlay.getByText('贴图置顶')).toBeVisible()
    console.log('PASS packaged runtime without prompt repository, stale action hidden')
  } finally {
    await standalone.close()
  }
}

async function category(page, name) {
  const action = page.getByRole('button', { name, exact: true })
  const toggle = page.locator('.fitbay-category-toggle')
  if ((await toggle.isVisible()) && !(await action.isVisible())) await toggle.click()
  await action.click()
}
