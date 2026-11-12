import { parentPort, workerData } from 'node:worker_threads'
import { opendir, lstat, realpath } from 'node:fs/promises'
import path from 'node:path'
import { parseStream } from 'music-metadata'
import { audioTypes, pathKey, openAudio } from './local-files.mjs'
const text = (s) => (typeof s === 'string' ? s.trim().slice(0, 2048) : '')
let rows = [],
  failed = 0
function flush() {
  if (rows.length || failed) parentPort.postMessage({ rows, failed })
  rows = []
  failed = 0
}
async function file(entry) {
  let handle, stream
  try {
    handle = await openAudio(entry)
    const { size } = await handle.stat()
    stream = handle.createReadStream({ autoClose: false })
    const { common, format } = await parseStream(
      stream,
      { path: entry, size, mimeType: audioTypes[path.extname(entry).toLowerCase()] },
      { duration: true, skipCovers: true },
    )
    if (!Number.isFinite(format.duration) || format.duration <= 0) throw Error()
    rows.push({
      file: entry,
      title: text(common.title) || path.basename(entry, path.extname(entry)),
      artist: text(common.artist) || '未知艺人',
      album: text(common.album),
      duration: format.duration,
      size,
    })
  } catch {
    failed++
  } finally {
    stream?.destroy()
    await handle?.close()
  }
}
async function directory(root) {
  const pending = [root]
  while (pending.length) {
    const dir = pending.pop()
    try {
      if (!(await lstat(dir)).isDirectory() || pathKey(await realpath(dir)) !== pathKey(dir))
        continue
      for await (const item of await opendir(dir)) {
        const entry = path.join(dir, item.name)
        if (item.isDirectory()) pending.push(entry)
        else if (item.isFile() && Object.hasOwn(audioTypes, path.extname(entry).toLowerCase())) {
          await file(entry)
          if (rows.length + failed >= 16) flush()
        }
      }
    } catch {
      failed++
    }
  }
}
const timer = setInterval(flush, 120)
try {
  for (const entry of workerData.paths) {
    if (workerData.folder) await directory(entry)
    else await file(entry)
    if (rows.length + failed >= 16) flush()
  }
} finally {
  clearInterval(timer)
  flush()
}
