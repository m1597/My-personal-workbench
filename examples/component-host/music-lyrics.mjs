import path from 'node:path'
import { artistMatches, titleMatch } from './music-discovery.mjs'
import { createHash } from 'node:crypto'
import { lstat, open } from 'node:fs/promises'

const maximum = 512 * 1024
export const lyricPath = (file) => path.join(path.dirname(file), path.parse(file).name + '.lrc')
const digest = (data) => createHash('sha256').update(data).digest('hex')
export function lyricLines(raw, translations = false) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > maximum) return []
  const offset = Number(raw.match(/^\s*\[offset:([+-]?\d+)\]/im)?.[1] ?? 0)
  const result = new Map()
  for (const line of raw.split(/\r?\n/)) {
    const tags = /^\s*((?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]\s*)+)(.*)$/.exec(line)
    if (!tags) continue
    for (const match of tags[1].matchAll(/\[(\d+):(\d+)(?:[.:](\d+))?\]/g)) {
      if (Number(match[2]) >= 60) continue
      const millis =
        (Number(match[1]) * 60 + Number(match[2])) * 1000 +
        Number((match[3] || '').padEnd(3, '0')) -
        offset
      const at = millis / 1000
      // Bilingual LRC sidecars place the original before its translation at the same timestamp.
      const word = tags[2].trim()
      const words = result.get(at) ?? []
      if (word && !words.includes(word) && words.length < (translations ? 2 : 1)) words.push(word)
      result.set(at, words)
    }
  }
  if (result.size)
    return [...result]
      .sort((a, b) => a[0] - b[0])
      .map(([at, words]) => [at, ...(words.length ? words : [''])])
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^\[(?:[a-z]+:|\d+:)/i.test(line))
    .map((line) => [null, line])
}
export function downloadLrc(original, translation, bilingual) {
  const rows = lyricLines(original, true)
  if (!rows.length) return ''
  if (rows[0][0] === null) return original
  // Preserve original LRC formatting when there is no second language to add or remove.
  if (!rows.some((row) => row.length > 2) && (!bilingual || !translation)) return original
  const translated = new Map(lyricLines(translation))
  const meta = original.split(/\r?\n/).filter((line) => /^\s*\[(?:ar|al|ti|by|re|ve):/i.test(line))
  for (const [at, word, inline] of rows) {
    const millis = Math.max(0, Math.round(at * 1000))
    const stamp =
      '[' +
      String(Math.floor(millis / 60000)).padStart(2, '0') +
      ':' +
      String(Math.floor(millis / 1000) % 60).padStart(2, '0') +
      '.' +
      String(millis % 1000).padStart(3, '0') +
      ']'
    meta.push(stamp + word)
    const extra = inline || translated.get(at)
    if (bilingual && extra && extra !== word) meta.push(stamp + extra)
  }
  return meta.join('\r\n') + '\r\n'
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
export async function localLines(audio, track, translations = false) {
  try {
    const raw = (await content(lyricPath(audio))).toString('utf8')
    return matchesTags(raw, track) ? lyricLines(raw, translations) : []
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
