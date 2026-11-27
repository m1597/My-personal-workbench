import assert from 'node:assert/strict'
import { mkdtemp, cp } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { complete } from '../components/toolkit/model.mjs'

// Exercise the same co-located modules used in a separately installed component.
const platform = path.resolve(process.argv[2] || '.', 'examples/component-host')
const folder = await mkdtemp(path.resolve('tmp/toolkit-plan-'))
for (const f of ['api-connections.mjs', 'chatgpt-plan.mjs', 'connection-vault.mjs'])
  await cp(path.join(platform, f), path.join(folder, f))
for (const f of ['toolkit-connections.mjs', 'model.mjs'])
  await cp(path.resolve('components/toolkit', f), path.join(folder, f))
const load = (f) => import(pathToFileURL(path.join(folder, f)).href)
const { openConnections } = await load('api-connections.mjs')
const { sharedConnectionVault } = await load('connection-vault.mjs')
const { toolkitConnections } = await load('toolkit-connections.mjs')
const fixture = openConnections(folder)
fixture.write('default', { endpoint: 'https://example.invalid', model: 'fixture', vision: true })
const id = fixture.read('default').id
fixture.close()
const sql = new DatabaseSync(path.join(folder, 'api-connections.sqlite'))
const record = {
  access: 'test-only',
  scope: 'chatgpt.tokens.use.direct',
  expires: Date.now() + 600000,
}
sql
  .prepare('INSERT INTO plan_accounts(id,credential,models) VALUES(?,?,?)')
  .run(id, sharedConnectionVault().encryptString(JSON.stringify(record)), '[]')
sql.close()
const requests = []
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://api.openai.com/v1/responses')
  requests.push(JSON.parse(options.body))
  const events =
    requests.length === 3
      ? [{ type: 'response.failed', code: 'subscription_sharing_usage_limit_exceeded' }]
      : [{ type: 'response.output_text.delta', delta: '测试回答' }, { type: 'response.completed' }]
  return new Response(events.map((event) => 'data: ' + JSON.stringify(event) + '\n\n').join(''))
}
const db = toolkitConnections({
  shared: folder,
  packaged: true,
  legacy: {},
  onChange() {},
  onMigrated() {},
})
try {
  assert((await db.snapshot()).routes.vision.subscription)
  const text = await db.resolve('translation'),
    vision = await db.resolve('vision')
  const messages = [{ role: 'user', content: '翻译选区' }]
  assert.equal(await complete(text, undefined, messages), '测试回答')
  assert.equal(requests[0].input, '翻译选区')
  const url = 'data:image/png;base64,fixture'
  const visual = [
    {
      role: 'user',
      content: [
        { type: 'text', text: '解释' },
        { type: 'image_url', image_url: { url } },
      ],
    },
  ]
  assert.equal(await complete(vision, undefined, visual), '测试回答')
  assert.deepEqual(requests[1].input[0].content, [
    { type: 'input_text', text: '解释' },
    { type: 'input_image', image_url: url },
  ])
  await assert.rejects(
    complete(vision, undefined, [
      ...visual,
      { role: 'assistant', content: '测试回答' },
      ...messages,
    ]),
    /额度/,
  )
  assert.equal(requests[2].input[0].content[1].image_url, url)
  assert.equal(requests.length, 3)
  console.log(
    'PASS packaged plan adapter, inherited text/image, selected image and follow-up context, quota without key fallback',
    folder,
  )
} finally {
  db.close()
}
