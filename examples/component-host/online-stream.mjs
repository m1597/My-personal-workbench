import { Readable } from 'node:stream'
import { openPublic } from './lx-net.mjs'

const maxBytes = 512 * 1024 * 1024
const rangeSyntax = /^bytes=(?:\d+-\d*|-\d+)$/

export async function onlineStream(request, grant) {
  if (request.url !== grant.url || !['GET', 'HEAD'].includes(request.method))
    return new Response(null, { status: 403 })
  const range = request.headers.get('range')
  if (range !== null && (range.length > 50 || !rangeSyntax.test(range)))
    return new Response(null, { status: 416 })
  const connection = new AbortController()
  const timer = setTimeout(() => connection.abort(), 15000)
  const signal = AbortSignal.any([grant.controller.signal, request.signal, connection.signal])
  let upstream
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const url = await grant.address(signal)
      upstream = await openPublic(url, { method: request.method, mediaRange: range, signal })
      if (!attempt && [401, 403, 404, 410].includes(upstream.statusCode)) {
        upstream.destroy()
        continue
      }
      break
    }
    const status = upstream.statusCode
    const contentRange = upstream.headers['content-range']
    if (status === 416) {
      upstream.destroy()
      const headers = /^bytes \*\/\d+$/.test(contentRange) ? { 'Content-Range': contentRange } : {}
      return new Response(null, { status, headers })
    }
    if (![200, 206].includes(status)) throw Error()
    const length = upstream.headers['content-length']
    if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw Error()
    const headers = new Headers({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    const mime = upstream.headers['content-type']?.split(';')[0].trim().toLowerCase()
    if (mime && !/^(audio\/[\w.+-]+|application\/(octet-stream|ogg)|video\/mp4)$/.test(mime))
      throw Error()
    headers.set('Content-Type', mime || 'application/octet-stream')
    if (length !== undefined) headers.set('Content-Length', length)
    if (status === 206) {
      const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(contentRange)
      if (
        !match ||
        Number(match[1]) > Number(match[2]) ||
        Number(match[2]) >= maxBytes ||
        (match[3] !== '*' &&
          (Number(match[3]) <= Number(match[2]) || Number(match[3]) > maxBytes)) ||
        (length !== undefined && Number(length) !== Number(match[2]) - Number(match[1]) + 1)
      )
        throw Error()
      headers.set('Content-Range', contentRange)
    }
    if (status === 206 || upstream.headers['accept-ranges'] === 'bytes')
      headers.set('Accept-Ranges', 'bytes')
    if (request.method === 'HEAD') {
      upstream.destroy()
      return new Response(null, { status, headers })
    }
    upstream.setTimeout(30000, () => upstream.destroy(Error('音频传输超时')))
    async function* chunks() {
      let received = 0
      try {
        for await (const chunk of upstream) {
          received += chunk.length
          if (received > maxBytes) throw Error('音频超过单曲大小限制')
          yield chunk
        }
      } finally {
        upstream.destroy()
      }
    }
    const body = Readable.toWeb(Readable.from(chunks(), { objectMode: false }), {
      strategy: { highWaterMark: 64 * 1024, size: (chunk) => chunk.byteLength },
    })
    return new Response(body, {
      status,
      headers,
    })
  } catch {
    upstream?.destroy()
    return new Response(null, { status: 502 })
  } finally {
    clearTimeout(timer)
  }
}
