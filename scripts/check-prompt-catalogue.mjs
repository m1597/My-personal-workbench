import { _electron, expect } from '@playwright/test'
import { mkdtemp, mkdir, writeFile, rename, unlink, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { promptLibrary } from '../examples/component-host/prompt-library.mjs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import assert from 'node:assert/strict'
const dir = await mkdtemp(path.resolve('tmp/prompt-cards-')),
  root = path.join(dir, 'prompts'),
  skill = path.join(root, '软件开发', '检查'),
  profile = path.join(dir, 'profile')
await mkdir(skill, { recursive: true })
await mkdir(path.join(profile, 'prompt-library'), { recursive: true })
const prefs = path.join(profile, 'prompt-library', 'preferences.json')
await writeFile(prefs, JSON.stringify({ defaultRoot: dir, shortcut: 'Control+Alt+Shift+F12' }))
await writeFile(
  path.join(skill, 'SKILL.md'),
  '# 代码检查\n1. 阅读 {{语言}} 和 {{文件}}\n2. 核对\n```js\na()\n```',
)
await writeFile(path.join(skill, '参考.md'), 'references')
await writeFile(path.join(root, '普通.txt'), 'hello')
const refs = path.join(skill, 'refs')
await mkdir(refs)
await writeFile(path.join(refs, 'nested.txt'), 'original')
const nested = await promptLibrary(path.join(dir, 'nested-profile'), () => {})
try {
  await nested.select(refs, true)
  const doc = await nested.read(refs, 'nested.txt')
  await assert.rejects(nested.save(refs, 'nested.txt', doc.revision, 'changed'), /Skill 目录只读/)
  await assert.rejects(nested.saveOrganized(refs, 'changed'), /Skill 目录只读/)
} finally {
  nested.close()
}
const dist = path.resolve('dist/component-prototype')
const launch = () =>
  _electron.launch({
    args: [
      path.join(dist, 'host'),
      '--mode=prompts',
      '--workbench=' + path.join(dist, 'workbench/index.html'),
      '--user-data-dir=' + profile,
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
let app = await launch()
try {
  const ui = await app.firstWindow(),
    button = (label) => ui.getByRole('button', { name: label, exact: true })
  await expect(button('普通')).toHaveCount(0)
  await app.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] })
  }, root)
  await button('选择提示词目录').click()
  await ui.getByLabel('搜索提示词').fill('hello')
  await expect(button('普通')).toBeVisible()
  await expect(button('代码检查 · Skill')).toHaveCount(0)
  // Capture the final clipboard call in this isolated regression; full native readback is in check-prompt-reading.
  await app.evaluate(({ clipboard }) => {
    clipboard.writeText = async (text) => {
      globalThis.copiedPrompt = text
    }
  })
  await button('普通').click()
  await button('编辑').click()
  const draft = ui.getByRole('textbox', { name: '提示词正文' })
  await draft.fill('尚未保存的草稿')
  await button('复制当前草稿').click()
  assert.equal(await app.evaluate(() => globalThis.copiedPrompt), '尚未保存的草稿')
  assert.equal(await readFile(path.join(root, '普通.txt'), 'utf8'), 'hello')
  await draft.fill('hello')
  await button('返回').click()
  await ui.getByLabel('搜索提示词').fill('')
  await ui.getByRole('combobox', { name: '按用途筛选' }).click()
  await ui.getByRole('option', { name: '软件开发', exact: true }).click()
  await button('代码检查 · Skill').click()
  await expect(ui.locator('ol li')).toHaveCount(2)
  await expect(ui.locator('code')).toHaveText('a()')
  await ui.getByLabel('语言', { exact: true }).fill('TS')
  await button('复制替换后的提示词').click()
  assert.match(await app.evaluate(() => globalThis.copiedPrompt), /TS 和 \{\{文件\}\}/)
  await expect(button('编辑')).toBeDisabled()
  await button('原文').click()
  await ui.getByText('Markdown 源码', { exact: true }).click()
  await expect(ui.getByRole('article').locator('details[open] > pre')).toContainText('# 代码检查')
  await button('提示词库设置').click()
  await button('加入工作台').click()
  await expect(button('独立打开')).toBeVisible()
  await ui.screenshot({ path: path.join(dir, 'docked.png') })
  await button('返回').click()
  await ui.getByRole('combobox', { name: '按用途筛选' }).click()
  await ui.getByRole('option', { name: '全部用途', exact: true }).click()
  await rename(path.join(root, '普通.txt'), path.join(root, '新名.txt'))
  await expect(button('新名')).toBeVisible()
  await unlink(path.join(root, '新名.txt'))
  await expect(button('新名')).toHaveCount(0)
  await ui.getByText('整理原文', { exact: true }).click()
  await button('AI 整理').click()
  await expect(ui.getByRole('heading', { name: '提示词库设置' })).toBeVisible()
  const server = createServer((req, res) => {
    req.resume()
    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify({ choices: [{ message: { content: '# 整理预览内容\n[参考](参考.md)' } }] }),
    )
  })
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  try {
    await ui.evaluate((v) => window.promptConnections.save(v), {
      mode: 'own',
      endpoint: 'http://127.0.0.1:' + server.address().port + '/v1',
      model: 'test',
      protocol: 'chat',
      key: randomUUID(),
    })
    await button('返回').click()
    await button('AI 整理').click()
    await expect(button('取消整理')).toBeVisible()
    await button('取消整理').click()
    await expect(button('整理预览内容')).toHaveCount(0)
    await button('AI 整理').click()
    await button('确认保存副本').click()
    await expect(button('整理预览内容')).toBeVisible()
    await button('整理预览内容').click()
    await expect(ui.getByRole('article')).toContainText('[参考](软件开发/检查/参考.md)')
  } finally {
    server.close()
  }
  assert.ok((await readFile(prefs, 'utf8')).includes('defaultRoot'))
  const manifest = path.join(skill, 'SKILL.md')
  const original = await readFile(manifest, 'utf8')
  assert.ok(original.startsWith('# 代码检查'))
  assert.equal(await readFile(path.join(skill, '参考.md'), 'utf8'), 'references')
  await writeFile(manifest, original.replace('代码检查', '代码复核'))
  await expect(button('代码复核 · Skill')).toBeVisible()
  await app.close()
  await rename(manifest, path.join(skill, '改名.txt'))
  app = await launch()
  const reopened = await app.firstWindow()
  await expect(reopened.getByRole('button', { name: '代码复核 · Skill', exact: true })).toHaveCount(
    0,
  )
  await expect(reopened.getByRole('button', { name: '代码复核', exact: true })).toBeVisible()
  console.log('PASS', dir)
} finally {
  await app.close()
}
