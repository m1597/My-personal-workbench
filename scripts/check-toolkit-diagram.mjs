import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { _electron, expect } from '@playwright/test'
import { openConnections } from '../examples/component-host/api-connections.mjs'

const source =
  process.argv.slice(2).find((arg) => !arg.startsWith('--')) ||
  'C:/Program Files/Git/mingw64/share/doc/gnutls/pkcs11-vision.png'
const png = await readFile(source)
const folder = await mkdtemp(path.resolve('tmp/toolkit-diagram-'))
const profile = path.join(folder, 'profile')
await mkdir(profile)
const translations = [
  [/software|application/i, '用户应用'],
  [/other/i, '其他密码库'],
  [/package/i, '加密软件包'],
  [/G\s*n\s*uTLS/i, 'GnuTLS 库'],
  [/provider/i, '接口提供程序'],
  [/trusted/i, '用于保护设备密钥的可信平台模块'],
  [/module/i, '模块'],
  [/smart card/i, '智能卡'],
  [/daemon/i, '守护进程'],
  [/keyring/i, '密钥环'],
  [/user/i, '用户'],
  [/KCS/i, '公钥密码标准接口'],
]
let bad = true
const requests = []
const server = createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const input = JSON.parse(Buffer.concat(chunks))
  requests.push(input)
  let answer = '已根据选区回答'
  if (input.model === 'text-test' && input.messages.length === 1) {
    const prompt = input.messages[0].content
    assert.equal(typeof prompt, 'string')
    const items = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1))
    answer = JSON.stringify(
      bad
        ? []
        : items.map(({ id, text }) => ({
            id,
            zh: translations.find(([re]) => re.test(text))?.[1] || text,
          })),
    )
  }
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ choices: [{ message: { content: answer } }] }))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const db = openConnections(profile)
const endpoint = 'http://127.0.0.1:' + server.address().port
db.write('default', { endpoint, model: 'text-test', vision: false })
db.write('toolkit.vision', { endpoint, model: 'vision-test' })
db.close()
const env = { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' }
let app, host
const b = (p, n) => p.getByRole('button', { name: n, exact: true })
try {
  const profileArg = '--workbench-profile=' + profile
  let panel
  if (process.argv.includes('--packaged')) {
    app = await _electron.launch({
      executablePath: path.resolve('.cache/fitbay-build/toolkit/win-unpacked/FitBay Toolkit.exe'),
      args: [profileArg],
      env,
    })
    panel = await app.firstWindow()
  } else {
    app = await _electron.launch({ args: ['components/toolkit', profileArg], env })
    host = await _electron.launch({
      args: [
        'dist/component-prototype/host',
        '--mode=workbench',
        '--workbench=' + path.resolve('out/renderer/index.html'),
        '--user-data-dir=' + profile,
      ],
      env,
    })
    const shell = await host.firstWindow()
    await b(shell, '组件').click()
    await shell.locator('#window-menu').getByText('工具集', { exact: true }).click()
    panel = shell.locator('.toolkit-panel')
  }
  await app.evaluate(async ({ BrowserWindow, screen }, data) => {
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const win = new BrowserWindow({
      x: d.bounds.x + 80,
      y: d.bounds.y + 80,
      width: 600,
      height: 362,
      show: false,
      frame: false,
      skipTaskbar: true,
      focusable: false,
      alwaysOnTop: true,
      backgroundColor: '#ffffff',
    })
    globalThis.graphWindow = win
    await win.loadURL(
      'data:text/html,' +
        encodeURIComponent(
          '<body style="margin:0;background:white"><img style="margin:14px;width:572px;height:334px" src="data:image/png;base64,' +
            data +
            '"></body>',
        ),
    )
    await win.webContents.executeJavaScript('document.images[0].decode()')
  }, png.toString('base64'))
  async function region() {
    await app.evaluate(() => {
      globalThis.graphWindow.setAlwaysOnTop(true, 'screen-saver')
      globalThis.graphWindow.showInactive()
    })
    await new Promise((r) => setTimeout(r, 350))
    const next = app.waitForEvent('window')
    await b(panel, '框选屏幕').click()
    const overlay = await next
    await overlay.locator('.screen img').waitFor()
    await app.evaluate(() => globalThis.graphWindow.hide())
    await overlay.mouse.move(82, 82)
    await overlay.mouse.down()
    await overlay.mouse.move(678, 440)
    await overlay.mouse.up()
    await b(overlay, '翻译').waitFor()
    return overlay
  }
  let overlay = await region()
  let next = app.waitForEvent('window')
  await b(overlay, '翻译').click()
  let result = await next
  await expect(result.getByRole('status')).toContainText('缺少对应文字块', { timeout: 30000 })
  bad = false
  await b(result, '翻译').click()
  await expect(b(result, '仅中文')).toBeVisible({ timeout: 30000 })
  const diagram = result.locator('.diagram-scroll svg')
  const original = await diagram.locator('image').getAttribute('href')
  await writeFile(path.join(folder, 'capture.png'), Buffer.from(original.split(',')[1], 'base64'))
  const blocks = await diagram
    .locator('[data-mode="仅中文"] g')
    .evaluateAll((ns) => ns.map((n) => n.getAttribute('aria-label')))
  assert(blocks.length >= 9, JSON.stringify(blocks))
  assert(
    blocks.some((t) => /GnuTLS|PKCS|Smart card|Keyring/i.test(t)),
    JSON.stringify(blocks),
  )
  const boxes = await diagram.locator('[data-mode="仅中文"] g').evaluateAll((nodes) =>
    nodes.map((n) => {
      const rs = [...n.querySelectorAll('rect,[data-edge-ink]')].map((r) => r.getBBox())
      return [
        Math.min(...rs.map((r) => r.x)),
        Math.min(...rs.map((r) => r.y)),
        Math.max(...rs.map((r) => r.x + r.width)),
        Math.max(...rs.map((r) => r.y + r.height)),
      ]
    }),
  )
  await writeFile(path.join(folder, 'boxes.json'), JSON.stringify(boxes))
  const raster = async () =>
    diagram.evaluate(async (svg) => {
      const copy = svg.cloneNode(true)
      const bounds = svg.viewBox.baseVal
      copy.setAttribute('width', bounds.width)
      copy.setAttribute('height', bounds.height)
      copy.style.width = ''
      const image = new Image()
      image.src =
        'data:image/svg+xml;charset=utf-8,' +
        encodeURIComponent(new XMLSerializer().serializeToString(copy))
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = bounds.width
      canvas.height = bounds.height
      canvas.getContext('2d').drawImage(image, 0, 0)
      return canvas.toDataURL().split(',')[1]
    })
  for (const [mode, name] of [
    ['原图', 'original'],
    ['仅中文', 'chinese'],
    ['双语', 'bilingual'],
  ]) {
    await b(result, mode).click()
    await writeFile(path.join(folder, name + '.png'), Buffer.from(await raster(), 'base64'))
  }
  await result.getByRole('slider', { name: '图像缩放' }).press('End')
  assert(await result.locator('.diagram-scroll').evaluate((n) => n.scrollWidth > n.clientWidth))
  const block = diagram.locator('[data-mode="双语"] g').first()
  await block.focus()
  await expect(result.locator('.block-detail')).not.toBeEmpty()
  await result.screenshot({ path: path.join(folder, 'zoom.png') })
  execFileSync('python', ['scripts/check-toolkit-diagram-pixels.py', folder], { stdio: 'inherit' })
  await writeFile(path.join(folder, 'blocks.json'), JSON.stringify(blocks))
  await result.getByLabel('问题').fill('第一个标签为什么这样翻译？')
  await b(result, '追问').click()
  await expect(result.getByRole('heading', { name: '第一个标签为什么这样翻译？' })).toBeVisible()
  assert.equal(requests.at(-1).model, 'text-test')
  assert(requests.at(-1).messages.every((m) => typeof m.content === 'string'))
  await result.close()
  overlay = await region()
  const expected = await overlay.evaluate(() => window.toolkit.selectionImage())
  next = app.waitForEvent('window')
  await b(overlay, '问 AI').click()
  result = await next
  await expect(result.getByText('已根据选区回答', { exact: true })).toBeVisible()
  assert.equal(requests.at(-1).model, 'vision-test')
  assert.equal(requests.at(-1).messages[0].content[1].image_url.url, expected)
  assert.match(requests.at(-1).messages[0].content[0].text, /解释/)
  for (const prompt of ['请解释分支', '为什么连接到智能卡']) {
    await result.getByLabel('问题').fill(prompt)
    await b(result, '追问').click()
    await expect(result.getByRole('heading', { name: prompt, exact: true })).toBeVisible()
  }
  assert.equal(requests.at(-1).messages.length, 5)
  assert.equal(requests.at(-1).messages[0].content[1].image_url.url, expected)
  console.log(
    'PASS desktop GnuTLS graph, OCR blocks:',
    blocks.length,
    'text-only translation, retry, 3 layers, zoom, actual image and two follow-ups',
    folder,
  )
} finally {
  await app?.close()
  await host?.close()
  server.close()
}
