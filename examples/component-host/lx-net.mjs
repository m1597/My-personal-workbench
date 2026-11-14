import https from 'node:https'
import http from 'node:http'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import ipaddr from 'ipaddr.js'

// A reusable media socket must connect to the exact public address validated for
// this request. Keep pools separate by protocol and bind each pool to that peer.
const mediaPools = new Map()
function mediaAgent(protocol, peer) {
  const key = protocol + ' ' + peer.family + ' ' + peer.address
  let agent = mediaPools.get(key)
  if (!agent) {
    if (mediaPools.size >= 16) return false
    const Agent = protocol === 'https:' ? https.Agent : http.Agent
    agent = new Agent({ keepAlive: true, maxFreeSockets: 1, maxSockets: 4, timeout: 10000 })
    mediaPools.set(key, agent)
    const observed = new WeakSet()
    agent.on('free', (socket) => {
      if (observed.has(socket)) return
      observed.add(socket)
      socket.once('close', () => {
        if (
          mediaPools.get(key) === agent &&
          !Object.keys(agent.sockets).length &&
          !Object.keys(agent.freeSockets).length
        )
          mediaPools.delete(key)
      })
    })
  }
  return agent
}

async function lookupPublicHost(hostname, signal) {
  signal?.throwIfAborted()
  if (!signal) return lookup(hostname, { all: true })
  let abort
  const cancelled = new Promise((_, reject) => {
    abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
  })
  try {
    return await Promise.race([lookup(hostname, { all: true }), cancelled])
  } finally {
    signal.removeEventListener('abort', abort)
  }
}

async function resolvePublicPeer(hostname, signal) {
  let addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookupPublicHost(hostname, signal)
  // Fake-IP proxies can return benchmarking addresses. Resolve the hostname independently.
  if (
    !isIP(hostname) &&
    addresses.length &&
    addresses.every(
      (a) => ipaddr.process(a.address).range() === 'reserved' && /^198\.(18|19)\./.test(a.address),
    )
  ) {
    const dns = await sourceRequest(
      'https://1.1.1.1/dns-query?type=A&name=' + encodeURIComponent(hostname),
      { headers: { accept: 'application/dns-json' }, signal: signal },
    )
    addresses = (dns.body?.Answer ?? [])
      .filter((a) => a.type === 1 && isIP(a.data) === 4)
      .map((a) => ({ family: 4, address: a.data }))
  }
  if (
    !addresses.length ||
    addresses.some(({ address }) => ipaddr.process(address).range() !== 'unicast')
  )
    throw Error('音源仅支持公网地址')
  return addresses.find((a) => a.family === 4) ?? addresses[0]
}

export function openPublic(input, options = {}) {
  return openRedirect(input, options, 0, new Map())
}

async function openRedirect(input, options, redirects, peers) {
  options.signal?.throwIfAborted()
  const url = new URL(input)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    redirects > 4
  )
    throw Error('音源地址无效')
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  // Pin the verified address for this redirect chain only.
  let peer = peers.get(hostname)
  if (!peer) {
    peer = await resolvePublicPeer(hostname, options.signal)
    peers.set(hostname, peer)
  }
  const headers = {}
  if (options.mediaRange) headers.Range = options.mediaRange
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    if (
      /^(accept|content-type|user-agent|referer|origin)$/i.test(name) &&
      typeof value === 'string' &&
      value.length < 2048
    )
      headers[name] = value
  }
  const request = url.protocol === 'https:' ? https.request : http.request
  const method = options.method ?? 'GET'
  if (!['GET', 'POST', 'HEAD'].includes(method)) throw Error('不支持该请求方法')
  const response = await new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method,
        headers,
        agent: options.playback ? mediaAgent(url.protocol, peer) : false,
        autoSelectFamily: false,
        family: peer.family,
        lookup: (_name, _opts, cb) => cb(null, peer.address, peer.family),
        signal: options.signal ?? AbortSignal.timeout(20000),
      },
      resolve,
    )
    req.on('error', reject)
    req.end(method === 'POST' ? options.body : undefined)
  })
  if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
    response.destroy()
    return openRedirect(
      new URL(response.headers.location, url),
      { ...options, method: method === 'HEAD' ? 'HEAD' : 'GET', body: undefined },
      redirects + 1,
      peers,
    )
  }
  return response
}

export async function sourceRequest(url, options) {
  const timeout = Math.min(20000, Math.max(1000, Number(options.timeout) || 15000))
  const res = await openPublic(url, {
    method: options.method,
    headers: options.headers,
    body: options.body,
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(timeout)])
      : AbortSignal.timeout(timeout),
  })
  const chunks = []
  let size = 0
  for await (const chunk of res) {
    size += chunk.length
    if (size > 2 * 1024 * 1024) throw Error('音源响应过大')
    chunks.push(chunk)
  }
  let body = Buffer.concat(chunks).toString('utf8')
  try {
    body = JSON.parse(body)
  } catch {}
  return { statusCode: res.statusCode, body }
}
