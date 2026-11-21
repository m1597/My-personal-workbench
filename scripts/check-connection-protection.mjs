import { mkdtempSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import assert from 'node:assert/strict'
import path from 'node:path'
import { openConnections } from '../examples/component-host/api-connections.mjs'
const dir = mkdtempSync(path.resolve('tmp/connections-protection-'))
const key = randomBytes(32).toString('hex')
const a = openConnections(dir),
  b = openConnections(dir)
try {
  const write = a.write('music.model', {
    endpoint: 'https://example.invalid/v1',
    key,
    model: 'test',
  })
  assert.ok(write.configured)
  b.write('toolkit.translation', { reuse: write.id })
  assert.ok(b.resolve('toolkit.translation').key === key)
  assert.ok(!JSON.stringify(b.choices()).includes(key))
  b.write('toolkit.vision', {
    endpoint: 'https://example.invalid/vision',
    key: randomBytes(32).toString('hex'),
    model: 'vision',
  })
  assert.equal(a.read('toolkit.vision').model, 'vision')
  b.write('toolkit.translation', {
    separate: true,
    endpoint: 'https://example.invalid/v1',
    model: 'text',
    key: '',
  })
  assert.equal(a.read('music.model').model, 'test')
  console.log('PASS isolated connection reuse, masked summaries and independent models')
} finally {
  a.close()
  b.close()
}
