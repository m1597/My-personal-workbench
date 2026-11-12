import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { openAudio } from '../music/local-files.mjs'

const bins = 1024
// decodeAudioData requires the complete compressed input and a decoded PCM buffer.
const maxEncoded = 128 * 1024 * 1024
const maxDecodedSeconds = 2 * 3600

async function wavePcm(file, size, signal) {
  const header = Buffer.alloc(40)
  const read = async (length, position) =>
    (await file.read(header, 0, length, position)).bytesRead === length
  if (
    !(await read(12, 0)) ||
    header.toString('ascii', 0, 4) !== 'RIFF' ||
    header.toString('ascii', 8, 12) !== 'WAVE'
  )
    return null
  let position = 12
  let encoding, channels, align, bits, rate
  while (position + 8 <= size) {
    signal.throwIfAborted()
    if (!(await read(8, position))) return null
    const tag = header.toString('ascii', 0, 4)
    const length = header.readUInt32LE(4)
    position += 8
    if (length > size - position) return null
    if (tag === 'fmt ' && length >= 16) {
      if (!(await read(Math.min(length, 40), position))) return null
      encoding = header.readUInt16LE(0)
      if (encoding === 65534 && length >= 40) encoding = header.readUInt16LE(24)
      channels = header.readUInt16LE(2)
      rate = header.readUInt32LE(4)
      align = header.readUInt16LE(12)
      bits = header.readUInt16LE(14)
    }
    if (tag === 'data') {
      if (
        !rate ||
        !channels ||
        ![8, 16, 24, 32].includes(bits) ||
        align !== (channels * bits) / 8 ||
        ![1, 3].includes(encoding) ||
        (encoding === 3 && bits !== 32)
      )
        return null
      const frames = Math.floor(length / align)
      if (!frames) return null
      const peaks = Array(Math.min(bins, frames)).fill(0)
      const buffer = Buffer.alloc(Math.max(align, Math.floor(65536 / align) * align))
      for (let frame = 0; frame < frames; ) {
        signal.throwIfAborted()
        const bytes = Math.min(buffer.length, (frames - frame) * align)
        if ((await file.read(buffer, 0, bytes, position + frame * align)).bytesRead !== bytes)
          throw Error('音频在读取中发生变化')
        for (let offset = 0; offset < bytes; offset += align, frame++) {
          const index = Math.floor((frame * peaks.length) / frames)
          for (let c = 0; c < channels; c++) {
            const at = offset + (c * bits) / 8
            let sample
            if (encoding === 3) sample = buffer.readFloatLE(at)
            else if (bits === 8) sample = (buffer[at] - 128) / 128
            else sample = buffer.readIntLE(at, bits / 8) / 2 ** (bits - 1)
            if (Number.isFinite(sample))
              peaks[index] = Math.max(peaks[index], Math.min(1, Math.abs(sample)))
          }
        }
      }
      return { peaks, duration: frames / rate }
    }
    position += length + (length % 2)
  }
  return null
}

export function register(bind, getStore) {
  let last
  const libraryRow = (id) => {
    if (typeof id !== 'string' || !id.startsWith('local-')) throw Error('请选择本地曲库中的歌曲')
    return getStore().library.row(id)
  }
  const marks = () => {
    const { db } = getStore()
    db.exec(
      'CREATE TABLE IF NOT EXISTS wave_marks(id TEXT PRIMARY KEY, track TEXT NOT NULL REFERENCES local_tracks(id) ON DELETE CASCADE, seconds REAL NOT NULL, label TEXT NOT NULL)',
    )
    return db
  }
  bind('audio', async (id) => {
    const row = libraryRow(id)
    if (!(await getStore().library.verify(row))) throw Error('文件不可用，请重新定位')
    last?.abort()
    const task = new AbortController()
    last = task
    const file = await openAudio(row.file)
    try {
      const { size } = await file.stat()
      if (path.extname(row.file).toLowerCase() === '.wav') {
        const wave = await wavePcm(file, size, task.signal)
        if (wave) return wave
      }
      if (size > maxEncoded || row.duration > maxDecodedSeconds)
        throw Error('此录音超过完整解码上限（128 MiB 或 2 小时）。PCM WAV 可流式分析。')
      const bytes = Buffer.alloc(size)
      let position = 0
      while (position < size) {
        task.signal.throwIfAborted()
        const { bytesRead } = await file.read(
          bytes,
          position,
          Math.min(1024 * 1024, size - position),
          position,
        )
        if (!bytesRead) throw Error('音频在读取中发生变化')
        position += bytesRead
      }
      return { bytes }
    } finally {
      await file.close()
      if (last === task) last = null
    }
  })
  bind('marks', (track) => {
    libraryRow(track)
    return marks()
      .prepare('SELECT id,seconds,label FROM wave_marks WHERE track=? ORDER BY seconds,id')
      .all(track)
  })
  bind('addMark', (track, seconds, label) => {
    const row = libraryRow(track)
    if (
      !Number.isFinite(seconds) ||
      seconds < 0 ||
      seconds > row.duration + 0.1 ||
      typeof label !== 'string' ||
      label.length > 80
    )
      throw Error('标记时间或名称无效')
    marks()
      .prepare('INSERT INTO wave_marks VALUES(?,?,?,?)')
      .run(randomUUID(), track, seconds, label.trim())
  })
  bind('removeMark', (track, id) => {
    libraryRow(track)
    if (typeof id !== 'string') throw Error('标记无效')
    marks().prepare('DELETE FROM wave_marks WHERE track=? AND id=?').run(track, id)
  })
}
