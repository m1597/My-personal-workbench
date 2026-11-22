import { strict as assert } from 'node:assert'
import { mkdtemp, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { openConnections } from '../examples/component-host/api-connections.mjs'

test('independent clients inherit defaults, preserve dedicated choices and gate vision', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'fitbay-default-'))
  const a = openConnections(dir),
    b = openConnections(dir)
  t.after(async () => {
    a.close()
    b.close()
    await rm(dir, { recursive: true, force: true })
  })
  const key = randomUUID()
  const config = { endpoint: 'https://example.invalid/', model: 'text', key }
  const initial = a.write('default', config)
  assert.equal(b.read('music.model').source, 'default')
  assert.equal(b.resolve('music.model').key, key)
  assert.equal(b.read('toolkit.vision'), null)
  assert.throws(() => b.write('toolkit.vision', { reuse: initial.id }))
  b.write('music.model', { ...config, model: 'dedicated' })
  a.write('default', { ...config, model: 'vision', vision: true })
  assert.equal(b.read('toolkit.vision').model, 'vision')
  assert.equal(b.read('music.model').model, 'dedicated')
  b.write('music.model', { inherit: true })
  assert.equal(a.read('music.model').model, 'vision')
  assert.equal(JSON.stringify(a.choices()).includes(key), false)
})
