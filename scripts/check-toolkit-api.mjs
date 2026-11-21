import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { complete, modelEndpoint } from '../components/toolkit/model.mjs'

const marker = randomUUID()
let protocol
const server = createServer(async (req, res) => {
  if (protocol) {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks))
    const [suffix, field, header, answer] = {
      responses: [
        '/responses',
        'input',
        'authorization',
        { output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }] },
      ],
      claude: ['/messages', 'messages', 'x-api-key', { content: [{ type: 'text', text: 'OK' }] }],
      gemini: [
        '/models/sample:generateContent',
        'contents',
        'x-goog-api-key',
        { candidates: [{ content: { parts: [{ text: 'OK' }] } }] },
      ],
    }[protocol]
    assert.equal(req.url, suffix)
    assert(req.headers[header] === (protocol === 'responses' ? 'Bearer ' : '') + marker)
    assert.equal(body[field].length, 3)
    assert(JSON.stringify(body[field][0]).includes('U05JUA=='))
    res.end(JSON.stringify(answer))
    return
  }
  assert.equal(req.url, '/chat/completions')
  assert(req.headers.authorization === 'Bearer ' + marker)
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
      marker,
      [{ role: 'user', content: 'test' }],
      new AbortController().signal,
    )
  for (const code of [401, 415]) {
    server.responseCode = code
    await assert.rejects(request, new RegExp('HTTP ' + code))
  }
  for (protocol of ['responses', 'claude', 'gemini']) {
    const turns = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'test' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,U05JUA==' } },
        ],
      },
      { role: 'assistant', content: 'image' },
      { role: 'user', content: 'again' },
    ]
    assert.equal(
      await complete(
        { endpoint, model: 'sample', protocol },
        marker,
        turns,
        new AbortController().signal,
      ),
      'OK',
    )
  }
  protocol = undefined
  server.responseCode = 0
  const started = Date.now()
  await assert.rejects(request, /超时/)
  assert(Date.now() - started >= 59000)
  console.log(
    'PASS Responses, Claude and Gemini image history, 401, 415, root endpoint, real 60-second timeout on local test service',
  )
} finally {
  server.closeAllConnections()
  server.close()
}
