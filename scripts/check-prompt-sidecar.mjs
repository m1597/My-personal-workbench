import assert from 'node:assert/strict'
import path from 'node:path'
import {
  mkdir,
  mkdtemp,
  copyFile,
  readFile,
  writeFile,
  rename,
  access,
  unlink,
} from 'node:fs/promises'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { _electron, expect } from '@playwright/test'
import { pathToFileURL } from 'node:url'

const source = process.argv[2]
if (!source) throw Error('请指定修复分窗收起问题.md 路径')
await mkdir('tmp', { recursive: true })
const scratch = await mkdtemp(path.resolve('tmp/prompt-sidecar-'))
const root = path.join(scratch, 'docs'),
  profile = path.join(scratch, 'profile'),
  name = path.basename(source)
await mkdir(root)
await copyFile(source, path.join(root, name))
await mkdir(path.join(profile, 'prompt-library'), { recursive: true })
await writeFile(
  path.join(profile, 'prompt-library/catalogue-preferences.json'),
  JSON.stringify({ defaultRoot: root, shortcut: 'F20', shortcutEnabled: false }),
)
const quotes = [
  '在左右分屏中打开两个组件。',
  '如果第二次留下了窄条，记录松手位置和窗格宽度，进入修复步骤。',
  '如果第二次完全收起，改用上下分屏，向上边缘重复同样的操作。',
]
let requests = 0,
  fail = false
const server = createServer(async (req, res) => {
  for await (const _ of req) {
  }
  requests++
  res.setHeader('content-type', 'application/json')
  const graph = {
    kind: 'flow',
    nodes: quotes.map((quote, i) => ({ quote, label: ['打开组件', '记录窄条', '换向复测'][i] })),
    edges: [
      [0, 1],
      [0, 2],
      [2, 0],
    ].map(([from, to]) => ({ from, to, quote: quotes[to] })),
  }
  res.end(
    JSON.stringify({ choices: [{ message: { content: fail ? '{}' : JSON.stringify(graph) } }] }),
  )
})
await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
async function launch() {
  const app = await _electron.launch({
    args: [
      path.resolve('dist/component-prototype/host'),
      '--mode=prompts',
      '--user-data-dir=' + profile,
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
  await app.evaluate(({ shell }) => {
    globalThis.opened = []
    shell.openPath = async (file) => {
      globalThis.opened.push(file)
      return ''
    }
  })
  return app
}
let app
try {
  app = await launch()
  let page = await app.firstWindow()
  const btn = (n) => page.getByRole('button', { name: n, exact: true })
  await page.evaluate((v) => window.promptConnections.save(v), {
    mode: 'own',
    endpoint: 'http://127.0.0.1:' + server.address().port + '/v1',
    model: 'fixture',
    protocol: 'chat',
    key: randomUUID(),
  })
  await btn('新建文件夹').click()
  await page.getByLabel('文件夹名称').fill('开发')
  await btn('创建').click()
  await expect(page.getByRole('combobox', { name: '按文件夹筛选' })).toHaveText(/开发/)
  await mkdir(path.join(root, '开发', '空目录'))
  const filter = () => page.getByRole('combobox', { name: '按文件夹筛选' })
  await filter().click()
  await expect(page.getByRole('option', { name: '开发 › 空目录' })).toBeVisible()
  await page.getByRole('option', { name: '全部文件' }).click()
  await btn('修复分窗收起问题').click()
  const open = async (label, n) => {
    await btn(label).click()
    await expect.poll(() => app.evaluate(() => globalThis.opened.length)).toBe(n)
  }
  await open('可视化', 1)
  const html = await app.evaluate(() => globalThis.opened[0])
  assert.equal(html, path.join(root, '修复分窗收起问题.html'))
  const first = await readFile(html, 'utf8')
  assert(first.includes('archify-i18n-data'))
  assert.equal(requests, 1)
  const next = app.waitForEvent('window')
  await app.evaluate(async ({ BrowserWindow }, url) => {
    globalThis.viewer = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    await globalThis.viewer.loadURL(url)
  }, pathToFileURL(html).href)
  const viewer = await next
  await expect(
    viewer.locator('.diagram-container svg').first().locator('[data-node-id]'),
  ).toHaveCount(3)
  await expect(viewer.locator('.cards .card').nth(1)).toContainText(quotes[1])
  await viewer.screenshot({ path: path.join(scratch, 'archify.png') })
  await viewer.locator('.diagram-container svg').first().locator('[data-node-id=n1]').click()
  await expect(viewer.locator('#prompt-original mark')).toHaveText(quotes[1])
  await open('可视化', 2)
  assert.equal(requests, 1)
  await writeFile(path.join(root, name), (await readFile(source, 'utf8')) + '\n版本二')
  await expect(page.getByText('原文已更新。')).toBeVisible()
  await open('可视化', 3)
  assert.equal(requests, 1)
  fail = true
  await btn('更新可视化').click()
  await expect(page.locator('.reader-content [role=status]')).toContainText('结构无效')
  assert.equal(await readFile(html, 'utf8'), first)
  fail = false
  await page.getByRole('button', { name: /^(重试生成|更新可视化)$/ }).click()
  await expect.poll(() => app.evaluate(() => globalThis.opened.length)).toBe(4)
  assert.equal(requests, 3)
  assert.notEqual(await readFile(html, 'utf8'), first)
  await page.locator('summary').filter({ hasText: '更多' }).click()
  await page.getByRole('combobox', { name: '移动到文件夹' }).click()
  await page.getByRole('option', { name: '开发', exact: true }).click()
  const moved = path.join(root, '开发', path.basename(html))
  await expect
    .poll(() =>
      access(moved).then(
        () => true,
        () => false,
      ),
    )
    .toBe(true)
  await assert.rejects(access(html))
  await assert.rejects(access(path.join(root, name)))
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  await btn('修复分窗收起问题').click()
  await open('可视化', 1)
  assert.equal(await app.evaluate(() => globalThis.opened[0]), moved)
  assert.equal(requests, 3)
  await btn('返回').click()
  await rename(path.join(root, '开发'), path.join(root, '流程'))
  await filter().click()
  await expect(page.getByRole('option', { name: '流程 › 空目录' })).toBeVisible()
  await expect(page.getByRole('option', { name: '开发', exact: true })).toHaveCount(0)
  await page.getByRole('option', { name: '流程', exact: true }).click()
  await expect(btn('修复分窗收起问题')).toHaveCount(1)
  await page.screenshot({ path: path.join(scratch, 'folder.png') })
  const inFolder = path.join(root, '流程')
  const duplicate = path.join(root, name)
  await writeFile(duplicate, '# 同名但内容不同')
  await assert.rejects(
    page.evaluate(({ root, name }) => window.promptLibrary.movePrompt(root, '流程\\' + name, ''), {
      root,
      name,
    }),
    /同名/,
  )
  assert.equal(await readFile(duplicate, 'utf8'), '# 同名但内容不同')
  await unlink(duplicate)
  await rename(path.join(inFolder, name), path.join(inFolder, '外部改名.md'))
  await expect
    .poll(() =>
      page.evaluate(async () => (await window.promptLibrary.catalogue('')).map((c) => c.name)),
    )
    .toEqual([path.join('流程', '外部改名.md')])
  await rename(path.join(inFolder, '外部改名.md'), path.join(root, '移出.txt'))
  await expect(btn('修复分窗收起问题')).toHaveCount(0)
  await filter().click()
  await page.getByRole('option', { name: '全部文件' }).click()
  await expect(btn('修复分窗收起问题')).toHaveCount(1)
  // An existing standalone sample is user-owned. A separate sibling remains available for FitBay.
  const reference = source.slice(0, -3) + '.html'
  await copyFile(reference, path.join(root, '移出.html'))
  const original = await readFile(reference)
  await btn('修复分窗收起问题').click()
  await open('可视化', 2)
  assert.equal(
    await app.evaluate(() => globalThis.opened.at(-1)),
    path.join(root, '移出.txt.fitbay.html'),
  )
  assert.deepEqual(await readFile(path.join(root, '移出.html')), original)
  assert.equal(requests, 4)
  console.log(
    'PASS first/reuse/stale/fail/regenerate/move/restart/external rename',
    requests,
    scratch,
  )
} finally {
  await app?.close()
  server.close()
}
