import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { complete, modelEndpoint } from '../components/toolkit/model.mjs'

const server = createServer((req, res) => {
  assert.equal(req.url, '/chat/completions')
  assert.equal(req.headers.authorization, 'Bearer test-key')
  if (server.responseCode) {
    res.writeHead(server.responseCode)
    res.end()
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
try {
  const endpoint = 'http://127.0.0.1:' + server.address().port
  assert.equal(modelEndpoint(endpoint), endpoint + '/chat/completions')
  const request = () =>
    complete(
      { endpoint, model: 'test' },
      'test-key',
      [{ role: 'user', content: 'test' }],
      new AbortController().signal,
    )
  for (const code of [401, 415]) {
    server.responseCode = code
    await assert.rejects(request, new RegExp('HTTP ' + code))
  }
  server.responseCode = 0
  const started = Date.now()
  await assert.rejects(request, /超时/)
  assert(Date.now() - started >= 59000)
  console.log('PASS 401, 415, root endpoint, real 60-second timeout on local test service')
} finally {
  server.closeAllConnections()
  server.close()
}
