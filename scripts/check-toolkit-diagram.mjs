import { installScreenFixture } from './toolkit-screen-fixture.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { _electron, expect } from '@playwright/test'
import { openConnections } from '../examples/component-host/api-connections.mjs'

const candidateRoot = process.argv.includes('--candidate')
  ? process.env.FITBAY_CANDIDATE_ROOT
  : undefined
if (process.argv.includes('--candidate') && (!candidateRoot || !path.isAbsolute(candidateRoot))) {
  throw Error('请设置 FITBAY_CANDIDATE_ROOT 为含候选组件的绝对目录')
}
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
let unblock
const responseGate = new Promise((resolve) => {
  unblock = resolve
})
const requests = []
const server = createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const input = JSON.parse(Buffer.concat(chunks))
  requests.push(input)
  if (requests.length === 1) await responseGate
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
            zh:
              process.argv.includes('--long-label') && /^Module$/i.test(text)
                ? '模块需要在准备完成之后通过认证并为每个受保护的设备建立独立连接以保证后续请求能够安全完成'
                : translations.find(([re]) => re.test(text))?.[1] || text,
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
let app, host, prompts
const b = (p, n) => p.getByRole('button', { name: n, exact: true })
async function checkDiagram() {
  const profileArg = '--workbench-profile=' + profile
  let panel
  if (candidateRoot || process.argv.includes('--packaged')) {
    app = await _electron.launch({
      executablePath: candidateRoot
        ? path.join(candidateRoot, 'Toolkit', 'FitBay Toolkit.exe')
        : path.resolve('.cache/fitbay-build/toolkit/win-unpacked/FitBay Toolkit.exe'),
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
  const template = '逐步推导并说明每个分支的作用'
  if (candidateRoot) {
    const library = path.join(folder, 'library')
    await mkdir(library)
    await writeFile(path.join(library, '解释推导.md'), template)
    prompts = await _electron.launch({
      executablePath: path.join(candidateRoot, 'Prompts', 'FitBay Prompts.exe'),
      args: ['--user-data-dir=' + profile],
      env,
    })
    const ui = await prompts.firstWindow()
    await prompts.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
    }, library)
    await b(ui, '选择提示词目录').click()
    await b(ui, '解释推导').click()
    await ui.getByText('更多', { exact: true }).click()
    await b(ui, '固定为工具集动作').click()
    await ui.getByLabel('显示名').fill('解释推导')
    await ui.getByRole('combobox', { name: '输入类型' }).click()
    await ui.getByRole('option', { name: '图片', exact: true }).click()
    await b(ui, '固定动作').click()
    await expect(ui.getByRole('status')).toContainText('已固定')
    await ui.screenshot({ path: path.join(folder, 'registered-action.png') })
  }
  if (candidateRoot && process.argv.includes('--dock')) {
    await prompts.close()
    prompts = undefined
    host = await _electron.launch({
      executablePath: path.join(candidateRoot, 'FitBay.exe'),
      args: ['--user-data-dir=' + profile],
      env,
    })
    const shell = await host.firstWindow()
    await b(shell, '组件').click()
    await shell.getByRole('menuitemcheckbox', { name: '工具集', exact: true }).click()
    panel = shell.locator('.toolkit-panel')
    await expect(b(panel, '开始取色')).toBeVisible()
  }
  const frame = execFileSync(
    'python',
    [
      '-c',
      `
import io,sys
from PIL import Image,ImageDraw
im=Image.new('RGB',(900,640),'white')
im.paste(Image.open(io.BytesIO(sys.stdin.buffer.read())).convert('RGB'),(94,94))
d=ImageDraw.Draw(im)
d.rectangle((20,20,49,49),fill='#3978AD')
d.rectangle((50,20,79,49),fill='#C45B39')
im.save(sys.stdout.buffer,'PNG')`,
    ],
    { input: png },
  )
  const display = await installScreenFixture(app, frame)
  await writeFile(path.join(folder, 'display.json'), JSON.stringify(display, null, 2))
  const mapX = (x) => Math.round((x * display.fixture.bounds.width) / 900)
  const mapY = (y) => Math.round((y * display.fixture.bounds.height) / 640)
  async function region() {
    const next = app.waitForEvent('window')
    await b(panel, '框选屏幕').click()
    const overlay = await next
    await overlay.locator('.screen img').waitFor()
    await overlay.mouse.move(mapX(82), mapY(82))
    await overlay.mouse.down()
    await overlay.mouse.move(mapX(678), mapY(440))
    await overlay.mouse.up()
    await b(overlay, '翻译').waitFor()
    return overlay
  }
  let overlay = await region()
  let next = app.waitForEvent('window')
  await b(overlay, '翻译').click()
  let result = await next
  await expect.poll(() => requests.length, { timeout: 30000 }).toBe(1)
  await expect(result.locator('[aria-busy=true]')).toBeVisible()
  for (const name of ['翻译', '问 AI']) {
    const action = b(result, name)
    await expect(action).toBeDisabled()
    await action.evaluate((n) => n.click())
  }
  unblock()
  await expect(result.getByRole('status')).toContainText('缺少对应文字块', { timeout: 30000 })
  bad = false
  await b(result, '重试').click()
  await expect(b(result, '仅中文')).toBeVisible({ timeout: 30000 })
  assert.equal(requests.length, 2)
  assert.deepEqual(requests[1], requests[0])
  const diagram = result.locator('.diagram-scroll svg')
  const original = await diagram.locator('image').getAttribute('href')
  await writeFile(path.join(folder, 'capture.png'), Buffer.from(original.split(',')[1], 'base64'))
  const blocks = await diagram
    .locator('[data-mode="仅中文"] [role=button]')
    .evaluateAll((ns) => ns.map((n) => n.getAttribute('aria-label')))
  assert(blocks.length >= 9, JSON.stringify(blocks))
  assert(
    blocks.some((t) => /GnuTLS|PKCS|Smart card|Keyring/i.test(t)),
    JSON.stringify(blocks),
  )
  const boxes = await diagram.locator('[data-mode="仅中文"] [role=button]').evaluateAll((nodes) =>
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
  const requestsBeforeModes = requests.length
  for (const [mode, name] of [
    ['原图', 'original'],
    ['仅中文', 'chinese'],
    ['双语', 'bilingual'],
  ]) {
    await b(result, mode).click()
    await writeFile(path.join(folder, name + '.png'), Buffer.from(await raster(), 'base64'))
  }
  assert.equal(requests.length, requestsBeforeModes)
  const bilingual = diagram.locator('[data-mode="双语"] [role=button]')
  const actual = await bilingual.evaluateAll((nodes) =>
    nodes.map((n) => {
      const texts = [...n.querySelectorAll('text')].filter(
        (t) => t.getBoundingClientRect().width > 0,
      )
      return {
        pair: n.getAttribute('aria-label'),
        visible: texts.map((t) => t.textContent).join(''),
        font: Math.min(
          ...texts.map((t) => Number(t.getAttribute('font-size')) * t.getScreenCTM().a),
        ),
      }
    }),
  )
  for (const [pair, target] of [
    ['GnuTLS', '库'],
    ['User', '用户'],
  ]) {
    const row = actual.find((r) => r.pair.startsWith(pair + '：'))
    assert(
      row?.visible.includes(pair) && row.visible.includes(target) && row.font >= 10,
      JSON.stringify(actual),
    )
  }
  if (process.argv.includes('--long-label'))
    assert.equal(actual.find((r) => r.pair.startsWith('Module：')).visible, '')
  assert(actual.filter((r) => r.visible).length >= actual.length * 0.8)
  await result.screenshot({ path: path.join(folder, 'bilingual-window.png') })
  if (process.argv.includes('--long-label')) {
    await bilingual
      .filter({ has: result.locator('[data-compact-label]:visible') })
      .filter({ hasText: 'Module →' })
      .click()
    await expect(result.locator('.block-detail')).toContainText('建立独立连接')
    await result.screenshot({ path: path.join(folder, 'long-label-detail.png') })
  }
  await writeFile(path.join(folder, 'readability.json'), JSON.stringify(actual, null, 2))
  const bilingualBoxes = await bilingual.evaluateAll((nodes) =>
    nodes.map((n) => {
      const r = n.getBBox()
      return [r.x, r.y, r.x + r.width, r.y + r.height]
    }),
  )
  await writeFile(path.join(folder, 'bilingual-boxes.json'), JSON.stringify(bilingualBoxes))
  if (process.argv.includes('--bilingual')) {
    execFileSync('python', ['scripts/check-toolkit-diagram-pixels.py', folder], {
      stdio: 'inherit',
    })
    console.log('PASS unclicked bilingual window:', folder)
    return
  }
  const compact = diagram.locator('[data-compact-label]:visible').first()
  if (await compact.count()) await compact.click()
  else await bilingual.first().click()
  await expect(result.locator('.block-detail')).not.toBeEmpty()
  await result.getByRole('slider', { name: '图像缩放' }).press('End')
  assert(await result.locator('.diagram-scroll').evaluate((n) => n.scrollWidth > n.clientWidth))
  const block = diagram.locator('[data-mode="双语"] [role=button]').first()
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
  await b(result, '问 AI').click()
  const expected = original
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
  if (candidateRoot) {
    await result.close()
    overlay = await region()
    const crop = await overlay.evaluate(() => window.toolkit.selectionImage())
    next = app.waitForEvent('window')
    await b(overlay, '解释推导').click()
    result = await next
    await expect(result.getByText('已根据选区回答', { exact: true })).toBeVisible()
    const content = requests.at(-1).messages[0].content
    assert.equal(content[0].text, template)
    assert.equal(content[1].image_url.url, crop)
    await result.screenshot({ path: path.join(folder, 'action-result.png') })
    await result.close()
    next = app.waitForEvent('window')
    await b(panel, '开始取色').click()
    const picker = await next
    await picker.locator('.swatch').waitFor()
    const hex = await picker.locator('.screen img').evaluate(async (img) => {
      await img.decode()
      const r = img.getBoundingClientRect(),
        c = document.createElement('canvas')
      c.width = c.height = 1
      const ctx = c.getContext('2d')
      ctx.drawImage(
        img,
        Math.floor(((200 - r.left) * img.naturalWidth) / r.width),
        Math.floor(((150 - r.top) * img.naturalHeight) / r.height),
        1,
        1,
        0,
        0,
        1,
        1,
      )
      return (
        '#' +
        Array.from(ctx.getImageData(0, 0, 1, 1).data)
          .slice(0, 3)
          .map((v) => v.toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase()
      )
    })
    next = app.waitForEvent('window')
    await picker.mouse.click(200, 150)
    result = await next
    await expect(result.getByText(hex, { exact: true })).toBeVisible()
    const rgb =
      'rgb(' +
      hex
        .slice(1)
        .match(/../g)
        .map((v) => parseInt(v, 16))
        .join(', ') +
      ')'
    await expect(result.getByText(rgb, { exact: true })).toBeVisible()
    await b(result, '复制 RGB').click()
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), rgb)
    await result.screenshot({ path: path.join(folder, 'color-result.png') })
    const versions = {}
    for (const product of ['Toolkit', 'Prompts']) {
      const manifest = JSON.parse(
        await readFile(path.join(candidateRoot, product, 'resources/app/package.json'), 'utf8'),
      )
      versions[product] = manifest.version
    }
    await writeFile(
      path.join(folder, 'candidate-result.json'),
      JSON.stringify(
        {
          versions,
          entry: host ? 'docked' : 'standalone',
          blocks: blocks.length,
          colors: { hex, rgb },
          registeredAction: '解释推导',
          modes: ['原图', '仅中文', '双语'],
          templateMatched: true,
          selectionPngMatched: true,
          service: 'loopback',
        },
        null,
        2,
      ),
    )
    console.log(
      'PASS candidate prompt registration, template and image byte equality; native swatch and RGB copy',
    )
  }
  await result.close()
  overlay = await region()
  await overlay.keyboard.press('Escape').catch((e) => {
    if (!overlay.isClosed()) throw e
  })
  await expect.poll(() => overlay.isClosed()).toBe(true)
  for (const [x, hex, rgb] of [
    [35, '#3978AD', 'rgb(57, 120, 173)'],
    [65, '#C45B39', 'rgb(196, 91, 57)'],
  ]) {
    next = app.waitForEvent('window')
    await b(panel, '开始取色').click()
    const picker = await next
    await picker.locator('.swatch').waitFor()
    next = app.waitForEvent('window')
    await picker.mouse.click(mapX(x), mapY(35))
    result = await next
    await expect(result.getByText(hex, { exact: true })).toBeVisible()
    await b(result, '复制 HEX').click()
    await expect(result.getByRole('status')).toHaveText('已复制 HEX')
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), hex)
    await b(result, '复制 RGB').click()
    await expect(result.getByRole('status')).toHaveText('已复制 RGB')
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), rgb)
    await result.screenshot({ path: path.join(folder, 'sample-' + x + '.png') })
    next = app.waitForEvent('window')
    await b(result, '重新取色').click()
    const again = await next
    await again.locator('.swatch').waitFor()
    await again.keyboard.press('Escape').catch((e) => {
      if (!again.isClosed()) throw e
    })
    await expect.poll(() => again.isClosed()).toBe(true)
  }
  console.log(
    'PASS isolated GnuTLS graph, OCR blocks:',
    blocks.length,
    'text-only translation, retry, 3 layers, zoom, actual image and two follow-ups',
    folder,
  )
}
try {
  await checkDiagram()
} finally {
  await app?.close()
  await host?.close()
  await prompts?.close()
  server.close()
}
