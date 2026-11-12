import { writeFile } from 'node:fs/promises'

// Deterministic PCM music with independent melodies, timbres and percussion for transfer fixtures.
export async function writeFixtureRecording(file, seed, duration = 4) {
  const rate = 8000
  const frames = Math.round(duration * rate)
  const bytes = Buffer.alloc(44 + frames * 2)
  bytes.write('RIFF')
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(rate, 24)
  bytes.writeUInt32LE(rate * 2, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(frames * 2, 40)
  let noise = seed + 100
  for (let n = 0; n < frames; n++) {
    const t = n / rate
    const beat = Math.floor(t * 4)
    const pitch = 130 + ((seed * 59 + beat * (31 + seed)) % 500)
    noise = (Math.imul(noise, 1664525) + 1013904223) >>> 0
    const sample =
      Math.exp(-6 * (t % 0.25)) *
      (0.5 * Math.sin(2 * Math.PI * pitch * t) + 0.3 * (noise / 2147483648 - 1))
    bytes.writeInt16LE(Math.round(sample * 30000), 44 + 2 * n)
  }
  await writeFile(file, bytes)
}
