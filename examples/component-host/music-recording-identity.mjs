import { createHash } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { parseFile } from 'music-metadata'
import { openAudio } from './music/local-files.mjs'
import { verifyAudio } from './lx-audio-check.mjs'

const stamps = new WeakMap()
const publishing = new WeakMap()
const waveformCache = new WeakMap()
const stamp = (s) => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(':')

// Compare a centered 256 ms of signed waveform across ±128 ms of encoder padding.
// Independent high correlations dispersed across the recording distinguish performances.
// Periodic tones can correlate at many unrelated offsets and cannot establish identity.
export function sameWaveform(a, b) {
  if (!a || !b || Math.abs(a.duration - b.duration) > 0.24) return false
  if (a.pcm || b.pcm) return !!a.pcm && a.pcm === b.pcm
  let active = 0
  const offsets = []
  let distinctive = 0
  for (let i = 0; i < a.windows.length; i++) {
    if (!a.windows[i] && !b.windows[i]) continue
    if (!a.windows[i] || !b.windows[i]) return false
    const x = Buffer.from(a.windows[i], 'base64')
    const y = Buffer.from(b.windows[i], 'base64')
    const scores = []
    let best = 0
    let index = 0
    for (let offset = 0; offset <= 512; offset++) {
      let xy = 0,
        xx = 0,
        yy = 0
      for (let j = 0; j < 512; j += 2) {
        const l = x[256 + j] - 128,
          r = y[offset + j] - 128
        xy += l * r
        xx += l * l
        yy += r * r
      }
      const score = xy / (Math.sqrt(xx * yy) || 1)
      scores.push(score)
      if (score > best) {
        index = offset
        best = score
      }
    }
    if (best < 0.96) return false
    const position = i / (a.windows.length - 1)
    offsets.push((b.duration - a.duration) * position + (index - 256) / 2000)
    active++
    if (scores.every((score, k) => Math.abs(k - index) < 32 || score < best - 0.07)) distinctive++
  }
  if (active < 8 || distinctive < 4) return false
  offsets.sort((x, y) => x - y)
  const shift = offsets[Math.floor(offsets.length / 2)]
  if (offsets.some((value) => Math.abs(value - shift) > 0.012)) return false
  // Check continuously sampled low-frequency phase as well as band envelopes. A
  // same-loudness replacement between the detailed windows must also agree.
  const l = Buffer.from(a.wave, 'base64'),
    r = Buffer.from(b.wave, 'base64')
  const lag = shift * 500
  const start = Math.max(0, Math.ceil(-lag) + 1),
    end = Math.min(l.length, r.length - Math.ceil(lag) - 1)
  for (let from = start; from < end; from += 128) {
    let xx = 0,
      yy = 0,
      xy = 0
    const until = Math.min(from + 256, end)
    if (until - from < 16) continue
    for (let j = from; j < until; j++) {
      const pos = j + lag,
        i = Math.floor(pos),
        fraction = pos - i
      const x = l[j] - 128,
        y = r[i] * (1 - fraction) + r[i + 1] * fraction - 128
      xx += x * x
      yy += y * y
      xy += x * y
    }
    if (Math.max(xx, yy) / (until - from) > 9 && xy / (Math.sqrt(xx * yy) || 1) < 0.91) return false
  }
  // Channel count can change when a mono recording is encoded as dual mono.
  const channels = Math.max(a.envelopes.length, b.envelopes.length)
  for (let ch = 0; ch < channels; ch++) {
    const left = Buffer.from(a.envelopes[ch % a.envelopes.length], 'base64'),
      right = Buffer.from(b.envelopes[ch % b.envelopes.length], 'base64')
    const offset = Math.round(shift / 0.032)
    const differences = []
    for (let j = Math.max(0, -offset) * 3; j < left.length && j + offset * 3 < right.length; j++)
      if (left[j] > 75 && right[j + offset * 3] > 75)
        differences.push(right[j + offset * 3] - left[j])
    if (!differences.length) return false
    differences.sort((x, y) => x - y)
    const gain = differences[Math.floor(differences.length / 2)]
    // Compare overlapping 256 ms spans, limiting codec noise around silence.
    const width = 8
    const frames = Math.min(left.length / 3, right.length / 3 - offset)
    for (let j = Math.max(0, -offset); j + width <= frames; j += 4) {
      for (let band = 0; band < 3; band++) {
        let error = 0
        for (let k = 0; k < width; k++) {
          const x = left[3 * (j + k) + band],
            y = right[3 * (j + k + offset) + band] - gain
          error += Math.abs(Math.max(48, x) - Math.max(48, y))
        }
        if (error / width > 13) return false
      }
    }
  }
  return true
}

async function inspectLibrary(store, file, size, duration, digest, signal) {
  if (!stamps.has(store)) stamps.set(store, new Map())
  const cache = stamps.get(store)
  if (!waveformCache.has(store)) waveformCache.set(store, new Map())
  const recent = waveformCache.get(store)
  const inspected = new Set()
  let incoming
  // A manual download or import can finish while an existing file is being read.
  while (true) {
    const rows = store.db
      .prepare('SELECT id,file FROM local_tracks WHERE awaitingLocation=0')
      .all()
      .filter((row) => !inspected.has(row.id + row.file))
    if (!rows.length) return
    for (const row of rows) {
      inspected.add(row.id + row.file)
      signal.throwIfAborted()
      let handle
      try {
        handle = await openAudio(row.file)
        const stat = await handle.stat({ bigint: true })
        const identity = stamp(stat)
        let entry = cache.get(row.id)
        if (entry?.stamp !== identity) {
          entry = { stamp: identity }
          cache.set(row.id, entry)
        }
        let match
        if (Number(stat.size) === size) {
          if (!entry.digest) {
            const hash = createHash('sha256')
            for await (const chunk of handle.createReadStream({ autoClose: false, signal }))
              hash.update(chunk)
            entry.digest = hash.digest('hex')
          }
          if (entry.digest === digest) match = 'SHA-256'
        }
        if (!match) {
          if (entry.duration === undefined)
            entry.duration =
              (await parseFile(row.file, { duration: true, skipCovers: true })).format.duration ?? 0
          if (Math.abs(duration - entry.duration) > 0.5) continue
          // Bound the renderer's full-file decode; SHA-256 still covers any supported file size.
          if (duration > 1200 || Math.max(size, Number(stat.size)) > 128 * 1024 * 1024) continue
          incoming ??= verifyAudio(file, signal, duration)
          const candidate = await incoming
          if (!candidate) continue
          if (!recent.has(identity)) {
            if (recent.size >= 32) recent.delete(recent.keys().next().value)
            recent.set(identity, await verifyAudio(row.file, signal, entry.duration))
          }
          if (sameWaveform(candidate, recent.get(identity))) match = '音频指纹'
        }
        if (
          match &&
          stamp(await lstat(row.file, { bigint: true })) === identity &&
          store.db.prepare('SELECT 1 FROM local_tracks WHERE id=? AND file=?').get(row.id, row.file)
        )
          return { kind: match, local: row.id }
      } catch {
        signal.throwIfAborted()
      } finally {
        await handle?.close()
      }
    }
  }
}

export async function publishDaily(store, file, size, duration, digest, signal, publish) {
  const previous = publishing.get(store) ?? Promise.resolve()
  const operation = previous
    .catch(() => {})
    .then(async () => {
      signal.throwIfAborted()
      const match = await inspectLibrary(store, file, size, duration, digest, signal)
      signal.throwIfAborted()
      if (!match) publish()
      return match
    })
  publishing.set(store, operation)
  try {
    return await operation
  } finally {
    if (publishing.get(store) === operation) publishing.delete(store)
  }
}
