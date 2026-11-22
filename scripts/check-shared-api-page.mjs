import { _electron as electron, expect } from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { MusicStore } from '../components/music/store.mjs'
import { createServer } from 'node:http'
const received = []
let expectedKey
const server = createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const payload = JSON.parse(Buffer.concat(chunks))
  if (Object.hasOwn(payload, 'thinking')) {
    res.writeHead(400)
    res.end('unsupported field')
    return
  }
  const { model } = payload
  received.push({
    path: req.url,
    model,
    authorized: req.headers.authorization === 'Bearer ' + expectedKey,
  })
  res.end(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify({ keyword: 'fixture' }) } }] }),
  )
})
const root = await mkdtemp(path.resolve('tmp/api-settings-')),
  proto = path.resolve('dist/component-prototype')
const store = new MusicStore(path.join(root, 'fitbay-music'))
store.set('music-guide-v1', '1')
store.set('lx-bootstrap', 'done')
store.db.close()
const app = await electron.launch({
  args: [
    path.join(proto, 'host'),
    '--mode=workbench',
    '--mute-audio',
    '--workbench=' + path.resolve('out/renderer/index.html'),
    '--user-data-dir=' + root,
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  app.context().setDefaultTimeout(10000)
  const w = await app.firstWindow()
  const b = (p, name) => p.getByRole('button', { name, exact: true })
  await b(w, '工作台设置').click()
  await b(w, 'API 与模型').click()
  const section = w.locator('.api-connections')
  await b(section, '模型与推荐').click()
  const form = section.locator('form')
  await form.getByLabel('服务地址').fill('https://example.invalid/v1')
  await form.getByLabel('模型', { exact: true }).fill('demo-a')
  await expect(form.getByLabel('API Key')).toHaveAttribute('type', 'password')
  await form.getByLabel('API Key').fill(randomBytes(32).toString('hex'))
  await b(form, '保存配置').click()
  await expect(form.getByLabel('API Key')).toHaveValue('')
  await expect(section.getByText('已配置', { exact: true })).toHaveCount(1)
  await w.screenshot({ path: path.join(root, 'overview.png') })
  await w.getByRole('searchbox').fill('模型与推荐')
  await b(w, 'Music › 音乐设置 › 模型与推荐').click()
  await expect
    .poll(() => app.windows().some((p) => p.url().includes('/music/index.html')))
    .toBe(true)
  const player = app.windows().find((p) => p.url().includes('/music/index.html')),
    music = player.locator('.api-connections form')
  if (await b(player, '跳过').isVisible()) await b(player, '跳过').click()
  await b(player.getByRole('navigation', { name: '设置分类' }), '模型与推荐').click()
  await expect(music.getByLabel('模型', { exact: true })).toHaveValue('demo-a')
  await b(w, '工作台设置').click()
  await b(w, 'API 与模型').click()
  await b(section, '模型与推荐').click()
  await expect(form.getByLabel('模型', { exact: true })).toHaveValue('demo-a')
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  for (const [source, target, model] of [
    [music, form, 'demo-b'],
    [form, music, 'demo-c'],
  ]) {
    const endpoint = 'http://127.0.0.1:' + server.address().port + '/' + model
    expectedKey = randomBytes(32).toString('hex')
    await source.getByLabel('服务地址').fill(endpoint)
    await source.getByLabel('模型', { exact: true }).fill(model)
    await source.getByLabel('API Key').fill(expectedKey)
    await b(source, '保存配置').click()
    await expect(target.getByLabel('服务地址')).toHaveValue(endpoint)
    await expect(target.getByLabel('模型', { exact: true })).toHaveValue(model)
    await expect(target.getByLabel('API Key')).toHaveAttribute('placeholder', '••••••••')
    await expect(target.getByLabel('API Key')).toHaveValue('')
    const keyword = await player.evaluate(() => window.music.aiCatalogQuery('artists', 'fixture'))
    expect(keyword).toEqual('fixture')
    expect(received.splice(0)).toEqual([
      { path: '/' + model + '/chat/completions', model, authorized: true },
    ])
  }
  await w.getByRole('searchbox').fill('提示词库')
  await b(w, '提示词库 › API 与模型').click()
  await expect
    .poll(() => app.windows().some((p) => p.url().includes('/prompts/index.html')))
    .toBe(true)
  const prompts = app.windows().find((p) => p.url().includes('/prompts/index.html'))
  await expect(prompts.locator('input[type=password]')).toBeVisible()
  console.log('PASS global to Music and Music to global; masked key', root)
} finally {
  server.close()
  await app.close()
}
