import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { importInstalledMusicConnection } from '../examples/component-host/music-connection.mjs'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { _electron, expect } from '@playwright/test'
import { apiUses, openConnections } from '../examples/component-host/api-connections.mjs'
import {
  requestMusicModel,
  configureModel,
  modelInfo,
} from '../dist/component-prototype/host/music-model.mjs'

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
  await page.getByRole('tab', { name: 'AI 推荐', exact: true }).click()
  await page.locator('#music-generate-recommendations input').fill('器乐')
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
// Run the same migration against the platform's default-aware connection store
// when the Music and platform branches are integrated.
if (apiUses.default) {
  const legacyRoot = await mkdtemp(path.resolve('tmp/music-default-legacy-'))
  await mkdir(path.join(legacyRoot, 'fitbay-music'))
  const db = new DatabaseSync(path.join(legacyRoot, 'fitbay-music/music.sqlite'))
  db.exec('CREATE TABLE state(key TEXT PRIMARY KEY, value TEXT)')
  db.prepare('INSERT INTO state VALUES(?,?)').run(
    'recommendation-providers',
    JSON.stringify({
      active: 'openai',
      accounts: {
        openai: { model: 'old-dedicated', secret: Buffer.from('test-slot').toString('base64') },
      },
    }),
  )
  db.close()
  const vault = { decryptString: () => key }
  const globalConnections = openConnections(legacyRoot, vault)
  try {
    globalConnections.write('default', {
      endpoint: 'http://127.0.0.1/v1',
      model: 'global',
      key: randomUUID(),
    })
    assert.equal(globalConnections.read('music.model').source, 'default')
    importInstalledMusicConnection(legacyRoot, globalConnections)
    const dedicated = globalConnections.resolve('music.model')
    assert.equal(dedicated.model, 'old-dedicated')
    assert(dedicated.key === key)
    globalConnections.write('music.model', { expectedId: dedicated.id, inherit: true })
    importInstalledMusicConnection(legacyRoot, globalConnections)
    assert.equal(globalConnections.read('music.model').source, 'default')
  } finally {
    globalConnections.close()
  }
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
  for (const raw of ['null', '{', '{"active":"openai","accounts":null}']) {
    const info = modelInfo({ get: () => raw })
    assert(info.providers.every((p) => !p.hasKey))
  }
  // Another window may change the binding between two separate SQLite reads.
  const snapshot = connections.resolve('music.model')
  const concurrent = {
    get: () => null,
    connections: {
      resolve: () => snapshot,
      read: () => {
        throw Error('Unexpected second connection read')
      },
    },
  }
  await assert.rejects(
    requestMusicModel(concurrent, null, 'search', {}, new AbortController().signal),
    (e) => e.message.includes('401') && !e.message.includes(key),
  )
  const db = new DatabaseSync(path.join(profile, 'fitbay-music/music.sqlite'))
  try {
    const migrated = {
      connections,
      get: (k) => db.prepare('SELECT value FROM state WHERE key=?').get(k)?.value,
      set: (k, v) => db.prepare('INSERT OR REPLACE INTO state VALUES(?,?)').run(k, v),
    }
    const { importMusicConnection } = await import(
      '../examples/component-host/music-connection.mjs'
    )
    importMusicConnection(migrated, connections)
    configureModel(migrated, null, 'openai', 'first', key)
    const binding = connections.read('music.model')
    connections.write('music.model', { ...binding, clearKey: true })
    configureModel(migrated, null, 'claude', 'second', key)
    configureModel(migrated, null, 'openai', 'again', '')
    assert.equal(connections.resolve('music.model'), null)
  } finally {
    db.close()
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
