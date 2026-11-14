import { regularFile } from './music/local-files.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { lstat, open, realpath } from 'node:fs/promises'

const maximumBytes = 8 * 1024 * 1024
const fold = (s) => s.toLowerCase()

async function readPlaylist(file) {
  if (
    typeof file !== 'string' ||
    !/^[a-z]:[\\/]/i.test(file) ||
    file.slice(2).includes(':') ||
    [...file].some((c) => c.charCodeAt(0) < 32) ||
    !/\.m3u8?$/i.test(file)
  )
    throw Error('请选择本机的 M3U 或 M3U8 文件')
  const original = await lstat(file, { bigint: true })
  if (!original.isFile() || fold(await realpath(file)) !== fold(path.resolve(file)))
    throw Error('请选择普通歌单文件')
  const handle = await open(file, 'r')
  try {
    const stat = await handle.stat({ bigint: true })
    if (
      !stat.isFile() ||
      stat.ino !== original.ino ||
      stat.dev !== original.dev ||
      fold(await realpath(file)) !== fold(path.resolve(file))
    )
      throw Error('歌单文件已变化')
    if (stat.size > maximumBytes) throw Error('歌单超过 8 MB')
    const buffer = Buffer.alloc(Number(stat.size) + 1)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    if (offset !== Number(stat.size)) throw Error('歌单文件已变化')
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, offset))
    } catch {
      throw Error('请将歌单另存为 UTF-8 编码')
    }
  } finally {
    await handle.close()
  }
}

export async function previewPlaylist(library, file) {
  const source = await readPlaylist(file)
  if (source.includes('\0')) throw Error('歌单包含无效文本')
  const paths = new Map(),
    filenames = new Map(),
    tracks = new Map()
  for (const t of library.db
    .prepare(
      'SELECT id,file,title,artist FROM local_tracks WHERE listed=1 AND available=1 AND unplayable=0 AND awaitingLocation=0',
    )
    .all()) {
    paths.set(fold(path.normalize(t.file)), t.id)
    const basename = fold(path.basename(t.file))
    if (!filenames.has(basename)) filenames.set(basename, [])
    filenames.get(basename).push(t.id)
    tracks.set(t.id, t)
  }
  const entries = [],
    candidates = {},
    choices = {}
  const verified = new Map()
  for (const line of source.split(/[\r\n]+/)) {
    const entry = line.trim()
    if (!entry || entry.startsWith('#')) continue
    if (entries.length >= 100000) throw Error('歌单超过 10 万条')
    let location = entry
    if (/^file:/i.test(location)) {
      try {
        location = fileURLToPath(location)
      } catch {
        location = ''
      }
    }
    const isPath = location && !/^[a-z][a-z0-9+.-]*:/i.test(location.replace(/^[a-z]:[\\/]/i, ''))
    const target = isPath ? fold(path.resolve(path.dirname(file), location)) : ''
    const basename = target && path.basename(target)
    if (!verified.has(basename)) {
      const available = []
      for (const id of filenames.get(basename) ?? []) {
        if (await regularFile(tracks.get(id).file)) available.push(id)
      }
      verified.set(basename, new Set(available))
    }
    const matches = verified.get(basename)
    const exact = paths.get(target)
    const id = matches.has(exact)
      ? exact
      : matches.size === 1
        ? matches.values().next().value
        : null
    // Repeated ambiguous entries share one candidate list and one copy of each display path.
    const group = !id && matches.size ? 'file:' + basename : null
    if (group && !candidates[group]) {
      candidates[group] = [...matches]
      for (const id of matches) choices[id] = tracks.get(id)
    }
    entries.push({ entry, id, group })
  }
  if (!entries.length) throw Error('歌单中没有歌曲')
  return { name: path.parse(file).name.slice(0, 80), entries, candidates, choices }
}
