import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { syncBuiltinESMExports } from 'node:module'
import dns from 'node:dns/promises'
import https from 'node:https'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { openPublic } from '../examples/component-host/lx-net.mjs'

const lookedUp = []
const connections = []
mock.method(dns, 'lookup', async (name) => {
  lookedUp.push(name)
  return [{ address: name === 'private.example' ? '127.0.0.1' : '8.8.8.8', family: 4 }]
})
mock.method(https, 'request', (url, options, receive) => {
  const req = new EventEmitter()
  req.end = () => {
    options.lookup(url.hostname, {}, (_, ip) => connections.push(ip))
    const locations = {
      '/first': '/second',
      '/second': 'https://other.example/final',
      '/bad': 'https://private.example/final',
    }
    const location = locations[url.pathname]
    receive(
      Object.assign(Readable.from([]), { statusCode: location ? 302 : 200, headers: { location } }),
    )
  }
  return req
})
syncBuiltinESMExports()
try {
  const response = await openPublic('https://media.example/first')
  response.destroy()
  assert.deepEqual(lookedUp, ['media.example', 'other.example'])
  await assert.rejects(openPublic('https://media.example/bad'), /仅支持公网/)
  assert.deepEqual(lookedUp, ['media.example', 'other.example', 'media.example', 'private.example'])
  assert.deepEqual(connections, Array(4).fill('8.8.8.8'))
  console.log('PASS 同次下载同主机仅解析一次，新请求重新解析，跨主机重定向仍校验地址')
} finally {
  mock.restoreAll()
  syncBuiltinESMExports()
}
