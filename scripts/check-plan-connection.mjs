import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import path from 'node:path'
import { openConnections } from '../examples/component-host/api-connections.mjs'

const dir = await mkdtemp(path.resolve('tmp/plan-contract-'))
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'fixture' }
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const issued = 'oaiapp_fixture',
  scope = 'openid offline_access resource.invoke chatgpt.tokens.use.direct'
let nonce,
  challenge,
  limit = false,
  calls = 0,
  renewals = 0,
  revocations = 0,
  token,
  refresh
const server = createServer(async (req, res) => {
  try {
    const chunks = []
    for await (const part of req) chunks.push(part)
    const body = Buffer.concat(chunks).toString()
    const json = (data) =>
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(data))
    if (req.url === '/.well-known/jwks.json') return json({ keys: [jwk] })
    if (req.url === '/api/accounts/oauth/token') {
      const form = new URLSearchParams(body)
      assert.equal(form.get('client_id'), issued)
      if (form.get('grant_type') === 'refresh_token') {
        assert.equal(form.get('refresh_token'), refresh)
        renewals++
      } else
        assert.equal(
          createHash('sha256').update(form.get('code_verifier')).digest('base64url'),
          challenge,
        )
      const claims = {
        iss: 'https://auth.openai.com',
        aud: issued,
        sub: 'fixture',
        nonce,
        exp: Date.now() / 1000 + 3600,
      }
      const jwt = b64({ alg: 'RS256', kid: 'fixture' }) + '.' + b64(claims)
      token = randomUUID()
      refresh = randomUUID()
      return json({
        access_token: token,
        refresh_token: refresh,
        scope,
        expires_in: renewals ? 3600 : 2,
        id_token:
          jwt + '.' + sign('RSA-SHA256', Buffer.from(jwt), privateKey).toString('base64url'),
      })
    }
    if (req.url.endsWith('/revoke')) {
      assert.equal(new URLSearchParams(body).get('token'), refresh)
      revocations++
      return json({})
    }
    assert.equal(req.headers.authorization, 'Bearer ' + token)
    if (req.url === '/v1/models')
      return json({
        models: [
          {
            slug: 'fixture-text',
            display_name: 'Text',
            visibility: 'list',
            input_modalities: ['text'],
          },
          {
            slug: 'fixture-vision',
            display_name: 'Vision',
            visibility: 'list',
            input_modalities: ['text', 'image'],
          },
        ],
      })
    assert.equal(req.url, '/v1/responses')
    const input = JSON.parse(body)
    assert.equal(input.stream, true)
    assert.equal(input.store, false)
    calls++
    const events = limit
      ? [
          {
            type: 'response.failed',
            response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } },
          },
        ]
      : [{ type: 'response.output_text.delta', delta: 'done' }, { type: 'response.completed' }]
    res
      .writeHead(200, { 'content-type': 'text/event-stream' })
      .end(events.map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join(''))
  } catch {
    res.writeHead(500).end()
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const request = (url, options) =>
  fetch('http://127.0.0.1:' + server.address().port + new URL(url).pathname, options)
const db = openConnections(dir, undefined, { request })
let registered = false
const browser = async (url) => {
  const q = new URL(url).searchParams
  assert.equal(q.get('client_id'), registered ? issued : 'dynamic_agent_client')
  nonce = q.get('nonce')
  challenge = q.get('code_challenge')
  const back = new URL(q.get('redirect_uri'))
  back.search = new URLSearchParams({
    code: 'fixture',
    client_id: issued,
    state: q.get('state'),
  }).toString()
  assert.equal((await fetch(back)).status, 200)
  registered = true
}
try {
  const plan = await db.authorizePlan('default', null, browser)
  assert.equal(db.read('music.model').authType, 'subscription')
  assert.equal(db.read('toolkit.vision'), null)
  assert.equal(
    await db.requestPlan('music.model', { instructions: 'Test', input: 'Hello' }),
    'done',
  )
  assert.equal(renewals, 1)
  db.selectPlanModel('default', plan.id, 'fixture-vision')
  assert.equal(
    await db.requestPlan('toolkit.vision', {
      input: [
        {
          role: 'user',
          content: [{ type: 'input_image', image_url: 'data:image/png;base64,AA==' }],
        },
      ],
    }),
    'done',
  )
  limit = true
  await assert.rejects(db.requestPlan('prompts.model', { input: 'Hello' }), /额度/)
  assert.equal(calls, 3)
  await db.revokePlan('default', plan.id)
  assert.equal(revocations, 1)
  assert.equal(db.read('music.model').signedIn, false)
  await assert.rejects(db.requestPlan('music.model', { input: 'Hello' }), /断开/)
  assert.equal(calls, 3)
  await db.authorizePlan('default', plan.id, browser)
  assert.equal(db.read('default').signedIn, true)
  assert.equal(
    (await readFile(path.join(dir, 'api-connections.sqlite'))).includes(Buffer.from(token)),
    false,
  )
  console.log(
    'PASS OAuth callback, PKCE, verified ID, rotated tokens, text/image HTTP, quota, revocation and returning registration. No private account used.',
  )
} finally {
  db.close()
  server.close()
  server.closeAllConnections()
}
