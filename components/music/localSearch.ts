import { pinyin } from 'pinyin-pro'

const spellings = new Map<string, string[]>()

function romanizations(label: string) {
  const existing = spellings.get(label)
  if (existing) return existing
  const syllables = pinyin(label.toLowerCase(), {
    toneType: 'none',
    type: 'all',
    nonZh: 'consecutive',
  })
  const forms = [
    syllables.map((s) => (s.isZh ? s.pinyin : s.origin)).join(''),
    syllables.map((s) => s.first).join(''),
  ].map((s) => s.replace(/[^a-z0-9ü]/g, '').replaceAll('ü', 'v'))
  if (spellings.size >= 16000) spellings.delete(spellings.keys().next().value as string)
  spellings.set(label, forms)
  return forms
}

export function filterLocalSongs<T extends { title: string; artist: string; album: string }>(
  rows: T[],
  query: string,
) {
  const literal = query.trim().toLowerCase()
  if (!literal) return [...rows]
  const phonetic = /^[a-z0-9ü\s]+$/i.test(literal)
    ? literal.replace(/\s/g, '').replaceAll('ü', 'v')
    : ''
  const direct: T[] = []
  const phoneticMatches: T[] = []
  for (const row of rows) {
    if ([row.title, row.artist, row.album].some((value) => value.toLowerCase().includes(literal)))
      direct.push(row)
    else if (
      phonetic &&
      [row.title, row.artist].some(
        (value) =>
          /\p{Script=Han}/u.test(value) && romanizations(value).some((s) => s.includes(phonetic)),
      )
    )
      phoneticMatches.push(row)
  }
  return direct.concat(phoneticMatches)
}
