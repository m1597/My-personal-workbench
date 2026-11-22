import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { openConnections } from '../examples/component-host/api-connections.mjs'
import { sharedConnectionVault } from '../examples/component-host/connection-vault.mjs'
import { recoverMusicProfile } from '../examples/component-host/music-connection.mjs'
import { requestMusicModel, configureModel } from '../dist/component-prototype/host/music-model.mjs'

const root = await mkdtemp(path.resolve('tmp/music-route-pairing-'))
const keys = [randomUUID(), randomUUID()]
const received = []
const servers = await Promise.all(
  keys.map(async (key, index) => {
    const server = createServer(async (req, res) => {
      const chunks = []
      for await (const b of req) chunks.push(b)
      received.push({
        index,
        path: req.url,
        model: JSON.parse(Buffer.concat(chunks)).model,
        matched: req.headers.authorization === 'Bearer ' + key,
      })
      res.writeHead(401).end()
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    return server
  }),
)
const endpoints = servers.map((s) => 'http://127.0.0.1:' + s.address().port + '/v1')
function dbStore(db, connections) {
  db.exec('CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT)')
  return {
    db,
    connections,
    get: (k) => db.prepare('SELECT value FROM state WHERE key=?').get(k)?.value,
    set: (k, v) => db.prepare('INSERT OR REPLACE INTO state VALUES(?,?)').run(k, v),
  }
}
const realFetch = globalThis.fetch
globalThis.fetch = (url, ...args) => {
  if (!endpoints.some((e) => String(url) === e + '/chat/completions'))
    throw Error('Unexpected request destination')
  return realFetch(url, ...args)
}
try {
  for (const format of ['shared', 'legacy']) {
    for (const active of [0, 1]) {
      const source = path.join(root, format + '-' + active)
      await mkdir(path.join(source, 'fitbay-music'), { recursive: true })
      const db = new DatabaseSync(path.join(source, 'fitbay-music/music.sqlite'))
      dbStore(db)
      const rows = endpoints.map((endpoint, i) => ({
        endpoint,
        model: 'route-' + i,
        protocol: 'chat',
        key: keys[i],
      }))
      const vault = sharedConnectionVault()
      if (format === 'legacy') {
        const accounts = Object.fromEntries(
          rows.map(({ endpoint, model, protocol, key }, i) => [
            i ? 'openai' : 'deepseek',
            { endpoint, model, protocol, secret: vault.encryptString(key).toString('base64') },
          ]),
        )
        dbStore(db).set(
          'recommendation-providers',
          JSON.stringify({ active: active ? 'openai' : 'deepseek', accounts }),
        )
      } else {
        const src = openConnections(source)
        const choices = rows.map((row, i) =>
          src.write(i ? 'prompts.model' : 'toolkit.translation', row),
        )
        src.write('music.model', { reuse: choices[active].id })
        src.close()
      }
      db.close()
      const connections = openConnections(path.join(source, 'destination'))
      const dst = dbStore(new DatabaseSync(':memory:'), connections)
      try {
        assert.equal(recoverMusicProfile(dst, source).model, '已恢复专用模型连接')
        await assert.rejects(
          requestMusicModel(dst, null, 'search', {}, new AbortController().signal),
          (e) => e.message.includes('401'),
        )
        assert.deepEqual(received.at(-1), {
          index: active,
          path: '/v1/chat/completions',
          model: 'route-' + active,
          matched: true,
        })
        assert.equal(received.length, (format === 'shared' ? 0 : 2) + active + 1)
      } finally {
        connections.close()
        dst.db.close()
      }
    }
  }
  const isolated = openConnections(path.join(root, 'switch'))
  const store = dbStore(new DatabaseSync(':memory:'), isolated)
  const vault = sharedConnectionVault()
  const accounts = Object.fromEntries(
    endpoints.map((endpoint, i) => [
      i ? 'openai' : 'deepseek',
      {
        endpoint,
        protocol: 'chat',
        model: 'route-' + i,
        secret: vault.encryptString(keys[i]).toString('base64'),
      },
    ]),
  )
  const set = () =>
    store.set('recommendation-providers', JSON.stringify({ active: 'deepseek', accounts }))
  try {
    accounts.deepseek.url = endpoints[1]
    set()
    const before = received.length
    await assert.rejects(
      requestMusicModel(store, vault, 'search', {}, new AbortController().signal),
      /地址无法确认/,
    )
    assert.equal(received.length, before)
    delete accounts.deepseek.url
    set()
    await assert.rejects(
      requestMusicModel(store, vault, 'search', {}, new AbortController().signal),
      (e) => e.message.includes('401'),
    )
    assert.deepEqual(received.at(-1), {
      index: 0,
      path: '/v1/chat/completions',
      model: 'route-0',
      matched: true,
    })
    isolated.write('music.model', {
      endpoint: endpoints[0],
      model: 'route-0',
      protocol: 'chat',
      key: keys[0],
    })
    configureModel(store, vault, 'openai', 'route-1', '')
    await assert.rejects(
      requestMusicModel(store, vault, 'search', {}, new AbortController().signal),
      (e) => e.message.includes('401'),
    )
    assert.deepEqual(received.at(-1), {
      index: 1,
      path: '/v1/chat/completions',
      model: 'route-1',
      matched: true,
    })
  } finally {
    isolated.close()
    store.db.close()
  }
  await writeFile(path.join(root, 'requests.json'), JSON.stringify(received, null, 2))
  console.log('PASS', root)
} finally {
  globalThis.fetch = realFetch
  for (const s of servers) s.close()
}
