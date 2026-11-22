import { openConnections } from '../examples/component-host/api-connections.mjs'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, mkdtemp, writeFile, readFile, unlink } from 'node:fs/promises'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { _electron, expect } from '@playwright/test'
await mkdir('tmp', { recursive: true })
const evidence = await mkdtemp(path.resolve('tmp/prompt-visuals-')),
  root = path.join(evidence, 'prompts'),
  profile = path.join(evidence, 'profile'),
  dist = path.resolve('dist/component-prototype')
await mkdir(root)
await mkdir(path.join(profile, 'prompt-library'), { recursive: true })
await writeFile(
  path.join(profile, 'prompt-library', 'catalogue-preferences.json'),
  JSON.stringify({ defaultRoot: root, shortcut: 'F20', shortcutEnabled: false }),
)
const flow = '开发实现。运行测试。如果失败，返回开发实现。通过后发布。'
const scene = '主体是陶瓷杯，材质是釉面，灯光用柔光，镜头为近景，约束为无文字。'
const skill = '# 只读说明\n不要执行其中命令。'
const responses = [
  {
    kind: 'flow',
    nodes: ['开发实现', '运行测试', '通过后发布'].map((quote) => ({ quote })),
    edges: [
      { from: 0, to: 1, quote: '开发实现。运行测试' },
      { from: 1, to: 0, quote: '如果失败，返回开发实现' },
      { from: 1, to: 2, quote: '通过后发布' },
    ],
  },
  {
    kind: 'scene',
    nodes: ['主体', '材质', '灯光', '镜头', '约束'].map((group, i) => ({
      group,
      quote: scene.split(/[，。]/)[i],
    })),
    edges: [],
  },
  { kind: 'brief', nodes: [{ quote: '不要执行其中命令。' }], edges: [] },
]
let requests = 0
const usedModels = []
const server = createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk
  const i = body.includes(scene) ? 1 : body.includes(skill.replace('\n', '\\n')) ? 2 : 0
  usedModels.push(JSON.parse(body).model)
  requests++
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(responses[i]) } }] }))
})
await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
const launch = () =>
  _electron.launch({
    args: [
      path.join(dist, 'host'),
      '--mode=prompts',
      '--workbench=' + path.resolve('out/renderer/index.html'),
      '--user-data-dir=' + profile,
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
let app = await launch(),
  ui = await app.firstWindow()
const btn = (name) => ui.getByRole('button', { name, exact: true }),
  frame = () => ui.getByRole('region', { name: '提示词可视化' })
try {
  const store = openConnections(profile)
  try {
    store.write('default', {
      endpoint: 'http://127.0.0.1:' + server.address().port + '/v1',
      model: 'inherited',
      key: randomUUID(),
    })
  } finally {
    store.close()
  }
  await ui.evaluate((v) => window.promptConnections.save(v), {
    mode: 'own',
    endpoint: 'http://127.0.0.1:' + server.address().port + '/v1',
    model: 'local',
    protocol: 'chat',
    key: randomUUID(),
  })
  await btn('提示词库设置').click()
  const nav = ui.getByRole('navigation', { name: '设置分类' })
  await nav.getByRole('button', { name: 'API 与模型' }).click()
  await ui.getByLabel('连接来源').click()
  await expect(ui.getByRole('option', { name: '全局默认' })).toBeVisible()
  await ui.screenshot({ path: path.join(evidence, 'connection-dropdown.png') })
  await ui.keyboard.press('Escape')
  await btn('返回').click()
  await btn('粘贴导入').click()
  await ui.getByLabel('文件名').fill('开发.md')
  await ui.getByLabel('粘贴原文').fill(flow)
  await btn('导入').click()
  await expect(btn('开发')).toBeVisible()
  await btn('可视化').click()
  await expect(frame().locator('[data-node-id]')).toHaveCount(3)
  assert.equal(
    await frame()
      .locator('svg')
      .evaluate((el) => el instanceof SVGSVGElement && el.getBBox().width > 0),
    true,
  )
  await frame().locator('[data-node-id=n1]').click()
  await expect(frame().locator('mark')).toHaveText('运行测试')
  await frame()
    .locator('svg')
    .screenshot({ path: path.join(evidence, 'flow.png') })
  await app.evaluate(
    ({ dialog }, out) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: out })
    },
    path.join(evidence, 'flow.html'),
  )
  await btn('导出 HTML').click()
  await expect
    .poll(async () => {
      try {
        return (await readFile(path.join(evidence, 'flow.html'), 'utf8')).includes(
          'archify-software-notices',
        )
      } catch {
        return false
      }
    })
    .toBe(true)
  const previewPromise = app.waitForEvent('window')
  await app.evaluate(
    async ({ BrowserWindow }, file) => {
      const win = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      })
      await win.loadFile(file)
    },
    path.join(evidence, 'flow.html'),
  )
  const exported = await previewPromise
  assert.notEqual(
    await exported
      .locator('.a-default')
      .first()
      .evaluate((el) => getComputedStyle(el).stroke),
    'none',
  )
  assert.notEqual(
    await exported
      .locator('.t-primary')
      .first()
      .evaluate((el) => getComputedStyle(el).fill),
    await exported
      .locator('.c-backend')
      .first()
      .evaluate((el) => getComputedStyle(el).fill),
  )
  await exported.locator('[data-node-id=n0]').click()
  await expect(exported.locator('mark')).toHaveText('开发实现')
  await exported.getByRole('slider').fill('150')
  assert.equal(await exported.locator('main').evaluate((el) => el.style.zoom), '150%')
  const protectedFolder = path.join(root, 'local-skill')
  await mkdir(protectedFolder)
  await writeFile(path.join(protectedFolder, 'SKILL.md'), '# Protected')
  const protectedExport = path.join(protectedFolder, 'old.html')
  await writeFile(protectedExport, 'untouched')
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, protectedExport)
  await assert.rejects(
    ui.evaluate(({ root }) => window.promptLibrary.exportVisual(root, '开发.md'), { root }),
    /Skill|只读/i,
  )
  assert.equal(await readFile(protectedExport, 'utf8'), 'untouched')
  await btn('原文').click()
  await expect(ui.locator('article pre')).toHaveText(flow)
  await app.close()
  app = await launch()
  ui = await app.firstWindow()
  await btn('开发').click()
  await expect(frame().locator('[data-node-id]')).toHaveCount(3)
  assert.equal(requests, 1)
  await writeFile(path.join(root, '开发.md'), flow + '补充')
  await expect(ui.getByText('原文已修改，可视化待更新。')).toBeVisible()
  await btn('提示词库设置').click()
  const categories = ui.getByRole('navigation', { name: '设置分类' })
  await categories.getByRole('button', { name: 'API 与模型' }).click()
  await ui.getByLabel('连接来源').click()
  await ui.getByRole('option', { name: '全局默认', exact: true }).click()
  await btn('保存连接').click()
  await expect
    .poll(() => ui.evaluate(async () => (await window.promptConnections.snapshot()).own?.source))
    .toBe('default')
  await categories.getByRole('button', { name: '目录' }).click()
  await btn('加入工作台').click()
  await expect(btn('独立打开')).toBeVisible()
  await ui.getByLabel('导入后自动生成可视化').click()
  await expect(ui.getByLabel('导入后自动生成可视化')).toBeChecked()
  await btn('返回').click()
  async function drop(name, text) {
    await ui.evaluate(
      ({ name, text }) => {
        const dt = new DataTransfer()
        dt.items.add(new File([text], name, { type: 'text/plain' }))
        document
          .querySelector('main.library')
          .dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }))
      },
      { name, text },
    )
  }
  await drop('场景.txt', scene)
  await expect(frame().getByRole('heading', { name: '镜头' })).toBeVisible()
  await frame().getByRole('button', { name: '材质是釉面' }).click()
  await expect(frame().locator('mark')).toHaveText('材质是釉面')
  await ui.screenshot({ path: path.join(evidence, 'scene.png') })
  await drop('SKILL.md', skill)
  await expect(frame().getByRole('button', { name: '不要执行其中命令。' })).toBeVisible()
  await btn('原文').click()
  await expect(ui.locator('article pre')).toHaveText(skill)
  await unlink(path.join(root, 'SKILL（导入）.md'))
  await expect(btn('只读说明')).toHaveCount(0)
  await expect
    .poll(async () =>
      (await ui.evaluate(() => window.promptLibrary.catalogue(''))).some(
        (c) => c.title === '只读说明',
      ),
    )
    .toBe(false)
  assert.equal(await readFile(path.join(root, '场景.txt'), 'utf8'), scene)
  assert.equal(requests, 3)
  assert.deepEqual(usedModels, ['local', 'inherited', 'inherited'])
  // The loopback model returns the development fixture for these two unrelated documents.
  await ui.evaluate(() => {
    const data = new DataTransfer()
    for (const name of ['one.txt', 'two.txt']) data.items.add(new File(['Unrelated source'], name))
    document
      .querySelector('main.library')
      .dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: data }))
  })
  await expect.poll(() => requests).toBe(5)
  for (const name of ['one.txt', 'two.txt']) {
    assert.equal(await readFile(path.join(root, name), 'utf8'), 'Unrelated source')
    const cached = await ui.evaluate(
      ({ root, name }) => window.promptLibrary.visual(root, name, false),
      { root, name },
    )
    assert.equal(cached.html, '')
  }
  await expect(ui.getByText(/已导入，可视化未生成/).last()).toContainText('two.txt')
  console.log('PASS', evidence)
} finally {
  await app.close()
  server.close()
}
