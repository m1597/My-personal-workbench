import { channel } from 'node:diagnostics_channel'
import { Readable } from 'node:stream'
import { openPublic } from './lx-net.mjs'

const maxBytes = 512 * 1024 * 1024
const rangeSyntax = /^bytes=(?:\d+-\d*|-\d+)$/

function mediaHeaders(upstream) {
  const status = upstream.statusCode
  const contentRange = upstream.headers['content-range']
  if (status === 416) {
    const headers = /^bytes \*\/\d+$/.test(contentRange) ? { 'Content-Range': contentRange } : {}
    return { status, headers }
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
      (match[3] !== '*' && (Number(match[3]) <= Number(match[2]) || Number(match[3]) > maxBytes)) ||
      (length !== undefined && Number(length) !== Number(match[2]) - Number(match[1]) + 1)
    )
      throw Error()
    headers.set('Content-Range', contentRange)
  }
  if (status === 206 || upstream.headers['accept-ranges'] === 'bytes')
    headers.set('Accept-Ranges', 'bytes')
  return { status, headers }
}

export async function onlineStream(request, grant) {
  if (request.url !== grant.url || !['GET', 'HEAD'].includes(request.method))
    return new Response(null, { status: 403 })
  const range = request.headers.get('range')
  if (range !== null && (range.length > 50 || !rangeSyntax.test(range)))
    return new Response(null, { status: 416 })
  const connection = new AbortController()
  const timer = setTimeout(() => connection.abort(), grant.connect ? 90000 : 15000)
  const signal = AbortSignal.any([grant.controller.signal, request.signal, connection.signal])
  let upstream
  try {
    if (grant.connect) {
      upstream = await grant.connect(signal, async (url, work) => {
        const deadline = new AbortController()
        const timeout = setTimeout(() => deadline.abort(Error('音频地址响应超时')), 6000)
        let input
        try {
          input = await openPublic(url, {
            playback: true,
            method: request.method,
            mediaRange: range,
            signal: AbortSignal.any([work, deadline.signal]),
          })
          mediaHeaders(input)
          return input
        } catch (error) {
          input?.destroy()
          throw Error(
            input ? '音频地址无法播放（HTTP ' + input.statusCode + '）' : '无法连接音频地址',
            { cause: error },
          )
        } finally {
          clearTimeout(timeout)
        }
      })
    } else
      for (let attempt = 0; attempt < 2; attempt++) {
        const url = await grant.address(signal)
        upstream = await openPublic(url, { method: request.method, mediaRange: range, signal })
        if (!attempt && [401, 403, 404, 410].includes(upstream.statusCode)) {
          upstream.destroy()
          continue
        }
        break
      }
    const { status, headers } = mediaHeaders(upstream)
    if (request.method === 'HEAD' || status === 416) {
      upstream.destroy()
      return new Response(null, { status, headers })
    }
    upstream.setTimeout(30000, () => upstream.destroy(Error('音频传输超时')))
    async function* chunks() {
      let received = 0
      try {
        for await (const chunk of upstream) {
          if (!received)
            channel('fitbay.music.playback').publish({ stage: 'first-bytes', id: grant.id })
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
  } catch (error) {
    if (!request.signal.aborted && !grant.controller.signal.aborted)
      grant.failure = error.message || '音频响应无效'
    upstream?.destroy()
    return new Response(null, { status: 502 })
  } finally {
    clearTimeout(timer)
  }
}
