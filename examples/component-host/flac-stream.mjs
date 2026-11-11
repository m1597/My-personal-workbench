// Chromium's FFmpeg demuxer can reject seeks in native FLAC without a SEEKTABLE.
// Supply a frame-zero seek point in the playback response only. Audio bytes and
// the source file are untouched; existing seek tables are preferred.
async function readAt(file, length, position) {
  const bytes = Buffer.alloc(length)
  const result = await file.read(bytes, 0, length, position)
  return result.bytesRead === length ? bytes : null
}
function frameSamples(header) {
  if (header?.[0] !== 255 || (header[1] & 254) !== 248) return 0
  const code = header[2] >> 4
  if (code === 1) return 192
  if (code >= 2 && code <= 5) return 576 << (code - 2)
  if (code >= 8) return 256 << (code - 8)
  if (code !== 6 && code !== 7) return 0
  // A UTF-8 coded frame/sample number precedes the explicit block size.
  let offset = 4
  do {
    offset++
  } while ((header[offset] & 192) === 128 && offset < 11)
  return code === 6 ? header[offset] + 1 : header.readUInt16BE(offset) + 1
}
export async function flacPrefix(file, size) {
  const first = await readAt(file, 42, 0)
  if (
    first?.toString('ascii', 0, 4) !== 'fLaC' ||
    (first[4] & 127) !== 0 ||
    first.readUIntBE(5, 3) !== 34
  )
    return
  let last = Boolean(first[4] & 128),
    offset = 42
  for (let blocks = 0; !last; blocks++) {
    if (blocks >= 256 || offset + 4 > size) return
    const header = await readAt(file, 4, offset)
    if (!header || (header[0] & 127) === 3) return
    last = Boolean(header[0] & 128)
    offset += 4 + header.readUIntBE(1, 3)
  }
  const samples = frameSamples(await readAt(file, 16, offset))
  if (!samples || samples > 65535) return
  const point = Buffer.alloc(22)
  point[0] = 3 | (first[4] & 128)
  first[4] &= 127
  point[3] = 18
  point.writeUInt16BE(samples, 20)
  return Buffer.concat([first, point])
}
