import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { _electron, expect } from '@playwright/test'
import { openConnections } from '../examples/component-host/api-connections.mjs'
import { requestMusicModel, configureModel } from '../dist/component-prototype/host/music-model.mjs'

let profile = await mkdtemp(path.resolve('tmp/music-upgrade-'))
const key = randomUUID()
const launch = () =>
  _electron.launch({
    args: [
      path.resolve('dist/component-prototype/host'),
      '--mode=workbench',
      '--workbench=' + path.resolve('out/renderer/index.html'),
      '--user-data-dir=' + profile,
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
const standalone = await _electron.launch({
  ...(process.env.FITBAY_TEST_MUSIC_EXE
    ? { executablePath: process.env.FITBAY_TEST_MUSIC_EXE, args: ['--user-data-dir=' + profile] }
    : {
        args: [
          path.resolve('dist/component-prototype/host'),
          '--mode=music',
          '--user-data-dir=' + profile,
        ],
      }),
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  const page = await standalone.firstWindow()
  const skip = page.getByRole('button', { name: '跳过', exact: true })
  await skip.waitFor({ timeout: 5000 }).catch(() => {})
  if (await skip.isVisible()) await skip.click()
  await expect(page.locator('.api-connections')).toHaveCount(0)
  await page.getByRole('tab', { name: '找歌', exact: true }).click()
  const toggle = page.getByRole('button', { name: 'AI 推荐', exact: true })
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()
  await page.getByRole('button', { name: '生成推荐', exact: true }).click()
  const form = page.locator('.api-connections form')
  await expect(form).toBeVisible()
  await form.getByLabel('服务地址').fill('https://standalone.invalid/v1')
  await form.getByLabel('模型', { exact: true }).fill('standalone')
  await form.getByLabel('API Key').fill(key)
  await form.getByRole('button', { name: '保存配置' }).click()
  await expect(form.getByLabel('API Key')).toHaveValue('')
  const db = openConnections(profile)
  try {
    assert(db.resolve('music.model').key === key)
  } finally {
    db.close()
  }
} finally {
  await standalone.close()
}
profile = await mkdtemp(path.resolve('tmp/music-legacy-'))
let app = await launch()
try {
  const secret = await app.evaluate(
    ({ safeStorage }, input) => safeStorage.encryptString(input).toString('base64'),
    key,
  )
  await app.close()
  await mkdir(path.join(profile, 'fitbay-music'), { recursive: true })
  const legacy = new DatabaseSync(path.join(profile, 'fitbay-music/music.sqlite'))
  legacy.exec('CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
  legacy
    .prepare('INSERT OR REPLACE INTO state VALUES(?,?)')
    .run(
      'recommendation-providers',
      JSON.stringify({ active: 'openai', accounts: { openai: { model: 'legacy-model', secret } } }),
    )
  legacy.close()
  app = await launch()
  const page = await app.firstWindow()
  await page.getByRole('button', { name: '工作台设置' }).click()
  await page.getByRole('button', { name: 'API 与模型', exact: true }).click()
  await page.getByRole('button', { name: '模型与推荐', exact: true }).click()
  const form = page.locator('.api-connections form')
  await expect(form.getByLabel('模型', { exact: true })).toHaveValue('legacy-model')
  await expect(form.getByLabel('API Key')).toHaveValue('')
  await expect(page.locator('.api-connections tr').filter({ hasText: 'Music' })).toContainText(
    '已配置',
  )
} finally {
  await app.close()
}
const connections = openConnections(profile)
const store = { get: () => null, set: () => {}, connections }
let seen
const server = createServer((req, res) => {
  seen = {
    path: req.url,
    authorized: [
      req.headers.authorization,
      req.headers['x-api-key'],
      req.headers['x-goog-api-key'],
    ].some((v) => v === key || v === 'Bearer ' + key),
  }
  res.writeHead(401).end()
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
try {
  assert(connections.resolve('music.model').key === key)
  const endpoint = 'http://127.0.0.1:' + server.address().port + '/v1'
  for (const [protocol, provider, suffix] of [
    ['chat', 'deepseek', 'chat/completions'],
    ['responses', 'openai', 'responses'],
    ['claude', 'claude', 'messages'],
    ['gemini', 'gemini', 'models/new-model:generateContent'],
  ]) {
    const { id } = connections.write('toolkit.translation', {
      protocol,
      key,
      endpoint,
      model: 'shared-model',
    })
    connections.write('music.model', { reuse: id })
    configureModel(store, null, provider, 'new-model', '')
    assert.equal(connections.read('music.model').id, id)
    assert.equal(connections.read('music.model').endpoint, endpoint)
    await assert.rejects(
      requestMusicModel(store, null, 'search', {}, new AbortController().signal),
      (e) => e.message.includes('401') && !e.message.includes(key),
    )
    assert.deepEqual(seen, { path: '/v1/' + suffix, authorized: true })
  }
  console.log(
    'PASS Music first-open legacy migration, preset key retention and four protocol routes',
    profile,
  )
} finally {
  connections.close()
  server.closeAllConnections()
  server.close()
}
