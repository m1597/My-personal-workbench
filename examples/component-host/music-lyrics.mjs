import path from 'node:path'
import { artistMatches, titleMatch } from './music-discovery.mjs'
import { createHash } from 'node:crypto'
import { lstat, open } from 'node:fs/promises'

const maximum = 512 * 1024
export const lyricPath = (file) => path.join(path.dirname(file), path.parse(file).name + '.lrc')
const digest = (data) => createHash('sha256').update(data).digest('hex')
export function lyricLines(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > maximum) return []
  const offset = Number(raw.match(/^\s*\[offset:([+-]?\d+)\]/im)?.[1] ?? 0)
  const result = new Map()
  for (const line of raw.split(/\r?\n/)) {
    const tags = /^\s*((?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]\s*)+)(.*)$/.exec(line)
    if (!tags) continue
    for (const match of tags[1].matchAll(/\[(\d+):(\d+)(?:[.:](\d+))?\]/g)) {
      if (Number(match[2]) >= 60) continue
      const at =
        Number(match[1]) * 60 + Number(match[2]) + Number('0.' + (match[3] || 0)) - offset / 1000
      // Bilingual LRC sidecars place the original before its translation at the same timestamp.
      if (!result.get(at)) result.set(at, tags[2].trim())
    }
  }
  return [...result].sort((a, b) => a[0] - b[0])
}
async function content(file) {
  const stat = await lstat(file)
  if (!stat.isFile() || stat.size > maximum) throw Error('歌词文件不可用')
  const handle = await open(file, 'r')
  try {
    const current = await handle.stat()
    if (current.ino !== stat.ino || current.dev !== stat.dev) throw Error('歌词文件已变化')
    const buffer = Buffer.alloc(stat.size + 1)
    const { bytesRead } = await handle.read(buffer)
    if (bytesRead !== stat.size) throw Error('歌词文件已变化')
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}
function matchesTags(raw, track) {
  if (!track) return true
  const artist = raw.match(/^\s*\[ar:([^\]\r\n]+)\]/im)?.[1].trim()
  const title = raw.match(/^\s*\[ti:([^\]\r\n]+)\]/im)?.[1].trim()
  const credits = (name) =>
    name
      .split(/[、,;/&]/u)
      .map((part) => part.trim())
      .filter(Boolean)
  if (artist && track.artist && !['未知艺人', 'Various Artists'].includes(track.artist)) {
    const overlap = credits(track.artist).some((name) =>
      credits(artist).some((tag) => artistMatches(tag, name) || artistMatches(name, tag)),
    )
    if (!overlap) return false
  }
  if (!title || !track.title) return true
  const singer = artist || track.artist || '未知艺人'
  const a = { title: track.title, artist: singer }
  const b = { title, artist: singer }
  if (titleMatch(a, b) === 'exact' || titleMatch(b, a) === 'exact') return true
  // Ignore descriptive subtitles (often nested soundtrack/translation credits), but keep
  // distinguishing edition labels such as "(Live)" and "(Matte Remix)".
  const plain = (name) =>
    name
      .normalize('NFKC')
      .split(
        /\s*\((?![^()]*(?:live|remix|remaster|acoustic|instrumental|version|现场|混音|重制|伴奏|版))/iu,
      )[0]
  a.title = plain(a.title)
  b.title = plain(b.title)
  return titleMatch(a, b) === 'exact' || titleMatch(b, a) === 'exact'
}
export async function localLines(audio, track) {
  try {
    const raw = (await content(lyricPath(audio))).toString('utf8')
    return matchesTags(raw, track) ? lyricLines(raw) : []
  } catch {
    return []
  }
}
function records(db) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS lyric_files(audio TEXT PRIMARY KEY, file TEXT NOT NULL, digest TEXT NOT NULL, identity TEXT NOT NULL)',
  )
  return db
}
export async function saveLyrics(db, audio, fetchLyric) {
  const file = lyricPath(audio)
  try {
    await lstat(file)
    return
  } catch (error) {
    if (error.code !== 'ENOENT') return
  }
  const raw = await fetchLyric()
  if (!lyricLines(raw).some(([, line]) => line)) return
  const handle = await open(file, 'wx')
  let identity
  try {
    await handle.writeFile(raw)
    const stat = await handle.stat({ bigint: true })
    identity = [stat.dev, stat.ino, stat.birthtimeNs, stat.mtimeNs].join(':')
  } finally {
    await handle.close()
  }
  records(db)
    .prepare('INSERT OR REPLACE INTO lyric_files VALUES (?,?,?,?)')
    .run(audio, file, digest(raw), identity)
  return true
}
export async function ownedLyrics(db, audio) {
  const file = lyricPath(audio)
  const row = records(db)
    .prepare('SELECT digest,identity FROM lyric_files WHERE audio=? AND file=?')
    .get(audio, file)
  try {
    if (!row) return null
    const stat = await lstat(file, { bigint: true })
    if (row.identity !== [stat.dev, stat.ino, stat.birthtimeNs, stat.mtimeNs].join(':')) return null
    return row.digest === digest(await content(file)) ? file : null
  } catch {
    return null
  }
}
