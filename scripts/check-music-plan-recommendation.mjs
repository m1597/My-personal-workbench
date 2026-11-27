import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { openConnections } from '../dist/component-prototype/host/api-connections.mjs'
import { sharedConnectionVault } from '../dist/component-prototype/host/connection-vault.mjs'
import { requestMusicModel } from '../dist/component-prototype/host/music-model.mjs'

await mkdir('tmp', { recursive: true })
const dir = await mkdtemp(path.resolve('tmp/music-plan-'))
const token = randomUUID()
const legacyKey = randomUUID()
const songs = Array.from({ length: 5 }, (_, i) => ({
  title: 'Song ' + i,
  artist: 'Artist ' + i,
  reason: 'Fixture song',
}))
let limited = false
const routes = []
const server = createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks))
  routes.push(req.url)
  if (req.url === '/v1/responses') {
    assert.ok(req.headers.authorization === 'Bearer ' + token)
    assert.equal(body.model, 'fixture-plan')
    assert.equal(JSON.parse(body.input).count, 5)
    assert.ok(body.instructions.includes('songs'))
    const events = limited
      ? [
          {
            type: 'response.failed',
            response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } },
          },
        ]
      : [
          { type: 'response.output_text.delta', delta: JSON.stringify({ songs }) },
          { type: 'response.completed' },
        ]
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(events.map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join(''))
  } else {
    assert.equal(req.url, '/chat/completions')
    assert.ok(req.headers.authorization === 'Bearer ' + legacyKey)
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ songs }) } }] }))
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const endpoint = 'http://127.0.0.1:' + server.address().port
const connections = openConnections(dir, undefined, {
  request: (url, options) => fetch(endpoint + new URL(url).pathname, options),
})
try {
  const id = randomUUID()
  const vault = sharedConnectionVault()
  const sqlite = new DatabaseSync(path.join(dir, 'api-connections.sqlite'))
  try {
    sqlite
      .prepare("INSERT INTO connections VALUES(?,?,?,NULL,'responses')")
      .run(id, 'https://api.openai.com/v1', 'fixture-plan')
    sqlite.prepare('INSERT INTO plan_accounts(id,credential,identity,models) VALUES(?,?,?,?)').run(
      id,
      vault.encryptString(
        JSON.stringify({
          access: token,
          expires: Date.now() + 120000,
          scope: 'chatgpt.tokens.use.direct',
        }),
      ),
      vault.encryptString('{}'),
      '[]',
    )
    sqlite.prepare("INSERT INTO bindings VALUES('default',?)").run(id)
  } finally {
    sqlite.close()
  }
  const call = () =>
    requestMusicModel(
      { connections },
      vault,
      'recommend',
      { count: 5, preference: 'fixture' },
      new AbortController().signal,
    )
  assert.equal((await call()).songs.length, 5)
  limited = true
  await assert.rejects(call, /订阅额度/)
  connections.write('music.model', {
    expectedId: id,
    separate: true,
    key: legacyKey,
    endpoint,
    protocol: 'chat',
    model: 'fixture-key',
  })
  assert.equal((await call()).songs.length, 5)
  assert.deepEqual(routes, ['/v1/responses', '/v1/responses', '/chat/completions'])
  console.log(
    'PASS Music: inherited subscription returned five songs, quota error did not fall back, dedicated API Key returned five songs.',
  )
} finally {
  connections.close()
  server.close()
}
