import { createServer } from 'node:http'
import { createHash, randomBytes, createPublicKey, verify } from 'node:crypto'

const issuer = 'https://auth.openai.com'
const resource = 'https://api.openai.com/v1'
const planScope = 'chatgpt.tokens.use.direct'
const tokenUrl = issuer + '/api/accounts/oauth/token'
const random = () => randomBytes(32).toString('base64url')

async function checked(url, options = {}, request = fetch) {
  const response = await request(url, {
    signal: AbortSignal.timeout(30000),
    ...options,
    redirect: 'error',
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const code = typeof body?.error === 'string' ? body.error : body?.error?.code
    if (
      ['invalid_grant', 'token_revoked', 'refresh_token_expired', 'refresh_token_reused'].includes(
        code,
      )
    )
      throw Object.assign(Error('订阅授权已失效，请重新授权'), { code: 'reauthorize' })
    if (code === 'user_not_eligible') throw Error('该账号当前不具备套餐使用资格')
    if (code === 'unsupported_capability') throw Error('套餐未提供该能力')
    if (response.status === 429) throw Error('订阅额度已用尽，请稍后再试')
    if ([400, 401, 403].includes(response.status))
      throw Error('订阅授权无效或套餐不可用，请重新授权')
    throw Error('订阅服务暂不可用')
  }
  return response
}
function exchange(fields, request) {
  return checked(
    tokenUrl,
    { method: 'POST', body: new URLSearchParams({ ...fields, resource }) },
    request,
  ).then((r) => r.json())
}
function tokenRecord(token, previous = {}) {
  if (
    !token.access_token ||
    !token.refresh_token ||
    !Number.isFinite(token.expires_in) ||
    token.expires_in <= 0
  )
    throw Error('授权响应不完整')
  return {
    ...previous,
    access: token.access_token,
    refresh: token.refresh_token,
    expires: Date.now() + token.expires_in * 1000,
    scope: token.scope ?? previous.scope ?? '',
  }
}
export async function signInChatGPT(hostId, openBrowser, previous, request = fetch) {
  const state = random(),
    nonce = random(),
    verifier = random()
  let redirectUri
  let receive
  const callback = new Promise((resolve, reject) => {
    receive = { resolve, reject }
  })
  const server = createServer((req, res) => {
    const url = URL.parse(req.url, 'http://127.0.0.1')
    if (
      req.method !== 'GET' ||
      url?.pathname !== '/auth/callback' ||
      url.searchParams.get('state') !== state
    ) {
      res.writeHead(400).end()
      return
    }
    res
      .writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      })
      .end('请返回 FitBay 查看授权结果。')
    if (url.searchParams.has('error')) receive.reject(Error('用户取消或套餐未授权'))
    else receive.resolve(url.searchParams)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const timer = setTimeout(() => receive.reject(Error('登录超时，请重试')), 180000)
  try {
    redirectUri = 'http://127.0.0.1:' + server.address().port + '/auth/callback'
    const url = new URL(issuer + '/api/accounts/authorize')
    url.search = new URLSearchParams({
      client_id: previous?.clientId || 'dynamic_agent_client',
      ...(previous ? {} : { agent_name_hint: 'FitBay' }),
      ext_agent_host_id: hostId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: 'openid profile email offline_access resource.invoke ' + planScope,
      resource,
      state,
      nonce,
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    }).toString()
    const [, params] = await Promise.all([openBrowser(url.href), callback])
    const clientId = params.get('client_id') || previous?.clientId
    if (
      !clientId ||
      clientId === 'dynamic_agent_client' ||
      (previous && previous.clientId !== clientId) ||
      !params.get('code')
    )
      throw Error('客户端登记未完成')
    const token = await exchange(
      {
        client_id: clientId,
        grant_type: 'authorization_code',
        code: params.get('code'),
        code_verifier: verifier,
        redirect_uri: redirectUri,
      },
      request,
    )
    const parts = String(token.id_token).split('.')
    if (parts.length !== 3) throw Error('账号身份验证失败')
    const [head, body, sig] = parts
    const header = JSON.parse(Buffer.from(head, 'base64url').toString())
    const jwks = await (await checked(issuer + '/.well-known/jwks.json', {}, request)).json()
    const jwk = jwks.keys.find(
      (k) => k.kid === header.kid && k.kty === 'RSA' && (!k.use || k.use === 'sig'),
    )
    if (
      header.alg !== 'RS256' ||
      !jwk ||
      !verify(
        'RSA-SHA256',
        Buffer.from(head + '.' + body),
        createPublicKey({ key: jwk, format: 'jwk' }),
        Buffer.from(sig, 'base64url'),
      )
    )
      throw Error('账号签名验证失败')
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (
      claims.iss !== issuer ||
      ![claims.aud].flat().includes(clientId) ||
      (claims.azp && claims.azp !== clientId) ||
      !Number.isFinite(claims.exp) ||
      claims.exp <= Date.now() / 1000 ||
      claims.nonce !== nonce ||
      !claims.sub ||
      (previous && previous.subject !== claims.sub)
    )
      throw Error('账号身份验证失败')
    return tokenRecord(token, { clientId, subject: claims.sub })
  } finally {
    clearTimeout(timer)
    server.close()
    server.closeAllConnections()
  }
}
export async function renewChatGPT(record, request = fetch) {
  return tokenRecord(
    await exchange(
      { grant_type: 'refresh_token', client_id: record.clientId, refresh_token: record.refresh },
      request,
    ),
    record,
  )
}
export async function revokeChatGPT(record, request = fetch) {
  await checked(
    issuer + '/api/accounts/oauth/revoke',
    {
      method: 'POST',
      body: new URLSearchParams({
        client_id: record.clientId,
        token: record.refresh,
        token_type_hint: 'refresh_token',
      }),
    },
    request,
  )
}
export async function planModels(record, request = fetch) {
  if (!record.scope.split(' ').includes(planScope)) return []
  const body = await (
    await checked(
      resource + '/models',
      { headers: { Authorization: 'Bearer ' + record.access } },
      request,
    )
  ).json()
  return (body.models ?? [])
    .filter((m) => m.visibility === 'list' && typeof m.slug === 'string')
    .map((m) => ({
      id: m.slug,
      label: m.display_name || m.slug,
      vision: m.input_modalities?.includes('image') === true,
    }))
}
export async function inferPlan(record, model, { instructions, input, signal }, request = fetch) {
  if (!record.scope.split(' ').includes(planScope)) throw Error('已登录，尚未授权使用 ChatGPT 套餐')
  const response = await checked(
    resource + '/responses',
    {
      method: 'POST',
      signal: signal ?? AbortSignal.timeout(90000),
      headers: { Authorization: 'Bearer ' + record.access, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, instructions, input, store: false, stream: true }),
    },
    request,
  )
  const decoder = new TextDecoder()
  let received = 0
  let pending = '',
    output = ''
  for await (const bytes of response.body) {
    received += bytes.length
    if (received > 8 * 1024 * 1024) throw Error('订阅响应过大')
    pending += decoder.decode(bytes, { stream: true })
    for (;;) {
      const match = /\r?\n\r?\n/.exec(pending)
      if (!match) break
      const block = pending.slice(0, match.index)
      pending = pending.slice(match.index + match[0].length)
      const data = block
        .split(/\r?\n/)
        .filter((s) => s.startsWith('data:'))
        .map((s) => s.slice(5).trimStart())
        .join('\n')
      if (!data || data === '[DONE]') continue
      const event = JSON.parse(data)
      if (event.type === 'response.output_text.delta') output += event.delta
      if (event.type === 'response.completed')
        return (
          output ||
          (event.response?.output ?? [])
            .flatMap((m) => m.content ?? [])
            .map((c) => c.text ?? '')
            .join('')
        )
      if (['error', 'response.failed', 'response.incomplete'].includes(event.type)) {
        const code = event.response?.error?.code ?? event.code
        if (code === 'subscription_sharing_usage_limit_exceeded') throw Error('订阅额度已用尽')
        throw Error('订阅请求未完成，请检查账号套餐状态')
      }
    }
  }
  throw Error('订阅响应意外中断')
}
