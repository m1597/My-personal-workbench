import path from 'node:path'
import { flacPrefix } from './flac-stream.mjs'
import { Readable } from 'node:stream'
import { audioTypes, openAudio } from './music/local-files.mjs'
// Each music session serves only its current opaque playback grant.
export async function localStream(request, grant, library) {
  if (!grant || request.url !== grant.url || !['GET', 'HEAD'].includes(request.method))
    return new Response(null, { status: 403 })
  let file
  try {
    const row = grant.audition ? grant : library.row(grant.libraryId ?? grant.id)
    if (row.file !== grant.file || (!grant.audition && !(await library.verify(row))))
      return new Response(null, { status: 404 })
    file = await openAudio(row.file, grant.audition ? undefined : library.row(row.id).fileIdentity)
    if (library && !(await library.acceptsVolume(row.file))) throw Error('录音已变化')
    const original = (await file.stat()).size
    const prefix =
      path.extname(row.file).toLowerCase() === '.flac' ? await flacPrefix(file, original) : null
    const extra = prefix ? prefix.length - 42 : 0
    const size = original + extra
    const range = request.headers.get('range')
    let start = 0,
      end = size - 1
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (m && (m[1] || m[2])) {
        start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]))
        end = m[1] && m[2] ? Math.min(end, Number(m[2])) : end
      } else start = size
      if (!Number.isSafeInteger(start) || start > end || start >= size) {
        await file.close()
        return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } })
      }
    }
    const headers = {
      'Content-Type': audioTypes[path.extname(row.file).toLowerCase()],
      'Accept-Ranges': 'bytes',
      'Content-Length': String(end - start + 1),
      'Cache-Control': 'no-store',
    }
    if (range) headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + size
    const init = { status: range ? 206 : 200, headers }
    if (request.method === 'HEAD' || size === 0) {
      await file.close()
      return new Response(null, init)
    }
    if (prefix && start < prefix.length) {
      const head = prefix.subarray(start, Math.min(end + 1, prefix.length))
      if (end < prefix.length) {
        await file.close()
        return new Response(head, init)
      }
      const tail = file.createReadStream({ start: 42, end: end - extra, signal: request.signal })
      const body = Readable.from(
        (async function* () {
          try {
            yield head
            yield* tail
          } finally {
            tail.destroy()
          }
        })(),
        { objectMode: false },
      )
      return new Response(Readable.toWeb(body), init)
    }
    const stream = file.createReadStream({
      start: start - extra,
      end: end - extra,
      signal: request.signal,
    })
    return new Response(Readable.toWeb(stream), init)
  } catch {
    await file?.close().catch(() => {})
    return new Response(null, { status: 404 })
  }
}
