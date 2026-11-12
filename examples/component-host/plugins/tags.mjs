import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, open, realpath, rm } from 'node:fs/promises'
import { renameSync, lstatSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'

const fields = ['title', 'artist', 'album']
const maxAudio = 128 * 1024 * 1024
const maxImage = 8 * 1024 * 1024
const maxBatch = 50
const fingerprint = (s) => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(':')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const changed = () => Error('文件或索引已变化，请重新预览')
async function verifiedTrack(store, id) {
  const row = store.library.row(id)
  if (row.awaitingLocation) throw Error('请先在曲库重新定位这首歌')
  if (!(await store.library.verify(row))) throw Error('曲目不可用，请重新定位')
  const current = store.library.row(id)
  if (current.awaitingLocation || current.file !== row.file) throw changed()
  return current
}

async function regular(file, limit) {
  const entry = await lstat(file, { bigint: true })
  if (!entry.isFile() || (await realpath(file)).toLowerCase() !== path.resolve(file).toLowerCase())
    throw Error('文件不可用或路径包含链接')
  if (entry.size > limit)
    throw Error(limit === maxAudio ? '此文件超过 128 MiB，已保留原件' : '封面超过 8 MiB')
  const handle = await open(file, 'r')
  try {
    if (fingerprint(await handle.stat({ bigint: true })) !== fingerprint(entry)) throw changed()
    const bytes = Buffer.alloc(Number(entry.size))
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) throw changed()
      offset += bytesRead
    }
    if (fingerprint(await handle.stat({ bigint: true })) !== fingerprint(entry)) throw changed()
    return { bytes, stamp: fingerprint(entry), mode: Number(entry.mode) }
  } finally {
    await handle.close()
  }
}
async function coverAt(file, nativeImage) {
  const { bytes, stamp } = await regular(file, maxImage)
  const mimeType =
    bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      ? 'image/jpeg'
      : bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        ? 'image/png'
        : null
  if (!mimeType) throw Error('请选择 JPEG 或 PNG 封面')
  const complete =
    mimeType === 'image/png'
      ? bytes.length >= 45 &&
        bytes.subarray(-12).equals(Buffer.from('0000000049454e44ae426082', 'hex'))
      : bytes.at(-2) === 255 && bytes.at(-1) === 217
  if (!complete || !nativeImage || nativeImage.createFromBuffer(bytes).isEmpty())
    throw Error('封面图片不完整或无法解码，请重新选择')
  return { file, stamp, picture: { mimeType, data: bytes, type: 'FrontCover', description: '' } }
}
async function adjacentCover(file, nativeImage) {
  for (const name of [
    'cover.jpg',
    'cover.jpeg',
    'cover.png',
    'folder.jpg',
    'folder.png',
    'front.jpg',
    'front.png',
  ]) {
    try {
      return await coverAt(path.join(path.dirname(file), name), nativeImage)
    } catch (e) {
      if (e.code !== 'ENOENT') continue
    }
  }
  return null
}
// Chromium cannot load arbitrary image URLs here. Send only a bounded preview bitmap.
function thumbnail(picture, nativeImage) {
  if (!picture || picture.data.length > maxImage) return null
  const original = nativeImage?.createFromBuffer(Buffer.from(picture.data))
  if (!original || original.isEmpty()) return null
  const { width, height } = original.getSize()
  const ratio = Math.min(1, 72 / Math.max(width, height))
  const image = original.resize({
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  })
  const data = image.toBitmap()
  for (let i = 0; i < data.length; i += 4) [data[i], data[i + 2]] = [data[i + 2], data[i]]
  return { ...image.getSize(), data: new Uint8Array(data) }
}
const front = (pictures) => pictures.find((p) => p.type === 'FrontCover') ?? pictures[0]
const snapshots = (pictures) =>
  pictures.map((p) => [p.type, p.description ?? '', p.mimeType, hash(p.data)])
// TagLib exposes WAV text through RIFF, but its artwork API operates on ID3 tags.
// Edit that existing subchunk with the same parser and retain every other RIFF chunk.
async function waveArtwork(lib, input, replacement) {
  const wave = Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  if (
    wave.toString('ascii', 0, 4) !== 'RIFF' ||
    wave.toString('ascii', 8, 12) !== 'WAVE' ||
    wave.readUInt32LE(4) + 8 !== wave.length
  )
    throw Error('此 WAV 容器不支持标签写入')
  let start = wave.length,
    end = start,
    payload
  for (let pos = 12; pos < wave.length; ) {
    if (pos + 8 > wave.length) throw Error('WAV 数据块不完整')
    const size = wave.readUInt32LE(pos + 4)
    const next = pos + 8 + size + (size % 2)
    if (next > wave.length) throw Error('WAV 数据块不完整')
    if (wave.toString('ascii', pos, pos + 4).toLowerCase() === 'id3 ') {
      if (payload) throw Error('存在多份 ID3 标签，请单独整理')
      start = pos
      end = next
      payload = wave.subarray(pos + 8, pos + 8 + size)
    }
    pos = next
  }
  if (!payload && !replacement) return []
  const tag = await lib.open({
    name: 'tag.mp3',
    data: payload || Buffer.from([73, 68, 51, 4, 0, 0, 0, 0, 0, 0]),
  })
  try {
    if (!replacement) return tag.getPictures()
    tag.setPictures(replacement)
    if (!tag.save()) throw Error('WAV 封面写入失败')
    const out = Buffer.from(tag.getFileBuffer())
    if (out.toString('ascii', 0, 3) !== 'ID3') throw Error('无效 ID3 封面')
    const size = 10 + out.subarray(6, 10).reduce((n, b) => n * 128 + b, 0)
    if (size > out.length) throw Error('无效 ID3 封面')
    const chunk = Buffer.alloc(8 + size + (size % 2))
    chunk.write('ID3 ')
    chunk.writeUInt32LE(size, 4)
    out.copy(chunk, 8, 0, size)
    const output = Buffer.concat([wave.subarray(0, start), chunk, wave.subarray(end)])
    output.writeUInt32LE(output.length - 8, 4)
    return output
  } finally {
    tag.dispose()
  }
}
const artwork = (lib, audio, input) =>
  audio.getFormat() === 'WAV' ? waveArtwork(lib, input) : audio.getPictures()
function message(e) {
  return e.code ? '读写失败，请检查文件是否在线、可写及剩余空间' : e.message
}
export function register(bind, getStore, env) {
  let runtime
  const engine = async () =>
    (runtime ??= import(new URL('./tags-engine.mjs', env.moduleURL).href).then((m) => m.engine()))
  let selectedCover
  let preview
  let busy = false
  bind('chooseCover', async () => {
    const result = await env.dialog.showOpenDialog({
      title: '选择建议封面',
      properties: ['openFile'],
      filters: [{ name: '封面图片', extensions: ['png', 'jpg', 'jpeg'] }],
    })
    if (result.canceled) return null
    const cover = await coverAt(result.filePaths[0], env.nativeImage)
    selectedCover = { token: randomUUID(), file: cover.file, stamp: cover.stamp }
    return { token: selectedCover.token, name: path.basename(cover.file) }
  })
  bind('preview', async (ids, coverToken, adjacent = false) => {
    if (busy) throw Error('正在处理，请稍候')
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > maxBatch ||
      ids.some((id) => typeof id !== 'string') ||
      typeof adjacent !== 'boolean'
    )
      throw Error('每次请选择 1 至 50 首曲目')
    busy = true
    try {
      const result = { token: randomUUID(), rows: new Map() }
      const rows = []
      const lib = await engine()
      let chosen
      if (coverToken) {
        if (coverToken !== selectedCover?.token) throw Error('封面选择已过期')
        chosen = await coverAt(selectedCover.file, env.nativeImage)
        if (chosen.stamp !== selectedCover.stamp) throw changed()
      }
      for (const id of new Set(ids)) {
        let audio
        try {
          const row = await verifiedTrack(getStore(), id)
          const file = row.file
          const ext = path.extname(file)
          const { bytes, stamp } = await regular(file, maxAudio)
          audio = await lib.open({ name: path.basename(file), data: bytes })
          if (!audio.isValid() || !['MP3', 'FLAC', 'WAV', 'MP4'].includes(audio.getFormat()))
            throw Error('此格式不支持写入')
          const tag = audio.tag()
          const current = Object.fromEntries(fields.map((k) => [k, tag[k] || '']))
          const stem = path.basename(file, ext).replace(/^\d{1,3}[ ._-]+(?=\S)/, '')
          const names = /^(.+?)\s+-\s+(.+)$/.exec(stem)
          const suggested = {
            title: names?.[2] || current.title || stem,
            artist: names?.[1] || current.artist,
            album: current.album || path.basename(path.dirname(file)),
          }
          const candidate = chosen ?? (adjacent ? await adjacentCover(file, env.nativeImage) : null)
          const oldCover = front(await artwork(lib, audio, bytes))
          const newCover =
            candidate && (!oldCover || hash(candidate.picture.data) !== hash(oldCover.data))
              ? candidate
              : null
          result.rows.set(id, {
            file,
            stamp,
            cover: newCover && { file: newCover.file, stamp: newCover.stamp },
          })
          rows.push({
            id,
            label: path.basename(file),
            current,
            suggested,
            hasCover: !!oldCover,
            currentCover: thumbnail(oldCover, env.nativeImage),
            suggestedCover: thumbnail(newCover?.picture, env.nativeImage),
            coverName: newCover ? path.basename(newCover.file) : null,
          })
        } catch (e) {
          rows.push({ id, error: message(e) })
        } finally {
          audio?.dispose()
        }
      }
      preview = result
      return { token: result.token, rows }
    } finally {
      busy = false
    }
  })
  bind('apply', async (token, changes) => {
    if (
      busy ||
      token !== preview?.token ||
      !Array.isArray(changes) ||
      !changes.length ||
      changes.length > maxBatch
    )
      throw Error('请重新预览并勾选需要写入的字段')
    const ids = new Set()
    for (const entry of changes) {
      if (
        !entry ||
        !preview.rows.has(entry.id) ||
        ids.has(entry.id) ||
        !entry.values ||
        typeof entry.values !== 'object'
      )
        throw Error('曲目选择无效')
      ids.add(entry.id)
      const keys = Object.keys(entry.values)
      if (
        !keys.length ||
        keys.some((k) =>
          k === 'cover'
            ? entry.values[k] !== true || !preview.rows.get(entry.id).cover
            : !fields.includes(k) ||
              typeof entry.values[k] !== 'string' ||
              !entry.values[k].trim() ||
              entry.values[k].length > 2048,
        )
      )
        throw Error('所选字段或内容无效')
    }
    busy = true
    try {
      const result = []
      const lib = await engine()
      for (const { id, values } of changes) {
        const plan = preview.rows.get(id)
        try {
          await writeChanges(getStore(), lib, id, plan, values, env.nativeImage)
          result.push({ id, ok: true })
        } catch (e) {
          result.push({ id, error: message(e) })
        }
      }
      preview = undefined
      return result
    } finally {
      busy = false
    }
  })
}
async function writeChanges(store, lib, id, plan, values, nativeImage) {
  const row = await verifiedTrack(store, id)
  if (row.file !== plan.file) throw changed()
  const { bytes, stamp, mode } = await regular(row.file, maxAudio)
  if (stamp !== plan.stamp) throw changed()
  const name = path.basename(row.file)
  const audio = await lib.open({ name, data: bytes })
  let verified, temp
  try {
    const before = audio.properties()
    const pictures = await artwork(lib, audio, bytes)
    for (const key of fields)
      if (Object.hasOwn(values, key)) audio.setProperty(key.toUpperCase(), values[key].trim())
    let expectedPictures = pictures
    if (values.cover) {
      const cover = await coverAt(plan.cover.file, nativeImage)
      if (cover.stamp !== plan.cover.stamp) throw changed()
      expectedPictures = [cover.picture, ...pictures.filter((p) => p.type !== 'FrontCover')]
      if (audio.getFormat() !== 'WAV') audio.setPictures(expectedPictures)
    }
    if (!audio.save()) throw Error('该文件无法保存所选字段')
    let modified = audio.getFileBuffer()
    if (values.cover && audio.getFormat() === 'WAV')
      modified = await waveArtwork(lib, modified, expectedPictures)
    verified = await lib.open({ name, data: modified })
    const after = verified.properties()
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!Object.hasOwn(values, key.toLowerCase()) && !isDeepStrictEqual(before[key], after[key]))
        throw Error('转换会改变未勾选的标签，已保留原件')
    }
    for (const key of fields)
      if (Object.hasOwn(values, key) && verified.tag()[key] !== values[key].trim())
        throw Error('该格式无法保留所选字段')
    if (
      !isDeepStrictEqual(
        snapshots(expectedPictures),
        snapshots(await artwork(lib, verified, modified)),
      )
    )
      throw Error('该格式无法保留所选封面或原有图片')
    temp = path.join(path.dirname(row.file), '.fitbay-tags-' + randomUUID() + '.tmp')
    const out = await open(temp, 'wx', mode)
    try {
      await out.writeFile(modified)
      await out.sync()
    } finally {
      await out.close()
    }
    if (
      (await verifiedTrack(store, id)).file !== row.file ||
      fingerprint(lstatSync(row.file, { bigint: true })) !== stamp
    )
      throw changed()
    const tag = verified.tag()
    const oldHash = hash(bytes),
      newHash = hash(modified)
    store.db.exec('BEGIN IMMEDIATE')
    try {
      const current = store.library.row(id)
      if (current.awaitingLocation || current.file !== row.file) throw changed()
      store.db
        .prepare('UPDATE local_tracks SET title=?,artist=?,album=?,size=? WHERE id=?')
        .run(
          tag.title || path.parse(name).name,
          tag.artist || '未知艺人',
          tag.album || '',
          modified.length,
          id,
        )
      store.db
        .prepare('UPDATE recording_copies SET digest=? WHERE local=? AND digest=?')
        .run(newHash, id, oldHash)
      const legacyRoot = store.get('root')
      if (
        legacyRoot &&
        path.resolve(legacyRoot).toLowerCase() ===
          path.dirname(path.resolve(row.file)).toLowerCase()
      ) {
        store.db
          .prepare('UPDATE library SET digest=? WHERE file=? COLLATE NOCASE AND digest=?')
          .run(newHash, name, oldHash)
      }
      renameSync(temp, row.file)
      temp = null
      store.db.exec('COMMIT')
    } catch (e) {
      if (store.db.isTransaction) store.db.exec('ROLLBACK')
      throw e
    }
    store.library.changed?.()
  } finally {
    verified?.dispose()
    audio.dispose()
    if (temp) await rm(temp, { force: true })
  }
}
