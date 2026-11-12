// 第一方合成目录。ID 对应确定的录音和发行版本。
const names = ['潮汐', '夜航', '山径', '晨光']
export const catalogue = [...names, '夜航'].map((title, index) => ({
  id: 'fitbay-tone-' + (index + 1),
  title,
  artist: 'FitBay 合成乐组',
  album: index === 4 ? '夜航变奏' : '声景习作',
  version: index === 4 ? '变奏版' : '原版',
  genre: index % 2 ? '氛围' : '电子',
  frequency: [220, 262, 330, 392, 294][index],
}))
export function validateSuggestions(rows, { songPunctuation = false, partial = false } = {}) {
  if (
    !Array.isArray(rows) ||
    (partial ? rows.length < 1 || rows.length > 5 : rows.length !== 5) ||
    !rows.every(
      (row) =>
        row &&
        typeof row === 'object' &&
        Object.keys(row).length === 3 &&
        ['title', 'artist', 'reason'].every(
          (key) =>
            Object.hasOwn(row, key) &&
            typeof row[key] === 'string' &&
            row[key].trim().length > 0 &&
            row[key].length <= 300 &&
            !(songPunctuation ? /(?:[a-z]+:\/\/|^\/|\\|^[a-z]:\/)/iu : /[\\/]/u).test(row[key]) &&
            Array.from(row[key]).every((ch) => ch.charCodeAt(0) >= 32),
        ),
    )
  )
    throw new Error('推荐格式无效')
  return rows
}
export function offlineSuggestions(preference, summary = []) {
  const score = (t) =>
    2 * Number(preference.includes(t.genre)) +
    Number(summary.some((line) => line.includes(t.genre)))
  const tracks = [...catalogue.slice(0, 4)].sort((a, b) => score(b) - score(a))
  return validateSuggestions([
    ...tracks.map(({ title, artist, genre }) => ({
      title,
      artist,
      reason: preference.includes(genre)
        ? '与输入的' + genre + '偏好一致'
        : '试听' + genre + '风格的合成录音',
    })),
    { title: '远山回声', artist: 'FitBay 合成乐组', reason: '用于验证目录缺失时的处理' },
  ])
}
export function recording(id) {
  const item = catalogue.find((t) => t.id === id)
  if (!item) throw new Error('曲目不存在')
  const rate = 16000,
    samples = rate * 20,
    data = Buffer.alloc(44 + samples * 2)
  data.write('RIFF')
  data.writeUInt32LE(data.length - 8, 4)
  data.write('WAVEfmt ', 8)
  data.writeUInt32LE(16, 16)
  data.writeUInt16LE(1, 20)
  data.writeUInt16LE(1, 22)
  data.writeUInt32LE(rate, 24)
  data.writeUInt32LE(rate * 2, 28)
  data.writeUInt16LE(2, 32)
  data.writeUInt16LE(16, 34)
  data.write('data', 36)
  data.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++) {
    const t = i / rate,
      note = [1, 1.25, 1.5, 1.125][Math.floor(t * 2) % 4]
    const envelope = Math.min(1, (t % 0.5) * 30, (0.5 - (t % 0.5)) * 12)
    data.writeInt16LE(
      Math.round(3200 * envelope * Math.sin(2 * Math.PI * item.frequency * note * t)),
      44 + i * 2,
    )
  }
  return data
}
