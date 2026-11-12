const fold = (value) =>
  String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .trim()
const key = (value) => fold(value).replace(/[\s\p{P}]/gu, '')
const splitArtists = (value) =>
  fold(value)
    .replace(/\bac\/dc\b/giu, 'acdc')
    .split(/\s+(?:feat\.?|ft\.?|featuring|x)\s+|[、,;＆&/]/iu)
    .filter(Boolean)
const aliases = (value) => {
  const name = fold(value)
  const alias = name.match(/^(.+?)\s*\(([^()]+)\)$/u)
  return (alias ? [name, alias[1], alias[2]] : [name]).map(key).filter(Boolean)
}
function credits(artist, metadata) {
  if (Array.isArray(metadata) && metadata.every(Array.isArray))
    return metadata.map((names) => names.flatMap(aliases))
  return splitArtists(artist).map(aliases)
}
export function artistMatches(request, artist, metadata) {
  if (key(request) && key(request) === key(artist)) return true
  const wanted = credits(request)
  const found = credits(artist, metadata)
  return (
    wanted.length > 0 &&
    wanted.every((names) => found.some((other) => names.some((n) => other.includes(n))))
  )
}
function titles(title, artist) {
  const original = fold(title)
  const values = [original, original.replace(/^\d{1,2}[.]\s*(?=\D)/u, '')]
  const parts = values[1].split(/\s+[-–—]\s+/u)
  if (parts.length === 2) {
    if (artistMatches(parts[0], artist)) values.push(parts[1])
    if (artistMatches(parts[1], artist)) values.push(parts[0])
  }
  for (const value of [...values]) {
    const feat = value.match(/^(.*?)\s*[<([]\s*(?:feat\.?|ft\.?)\s+(.+?)[>\])]*$/iu)
    if (feat && artistMatches(feat[2], artist)) values.push(feat[1].trim())
  }
  return values
}
export function titleMatch(item, row) {
  const artist = row.singer ?? row.artist
  if (!artistMatches(item.artist, artist, row.artistAliases)) return ''
  const wanted = titles(item.title, item.artist)
  const found = titles(row.name ?? row.title, artist)
  if (wanted.some((a) => found.some((b) => key(a) === key(b)))) return 'exact'
  if (
    wanted.some((a) => found.some((b) => b.startsWith(a) && /^[\s(\[【-]/u.test(b.slice(a.length))))
  )
    return 'variant'
  return ''
}
export function inLibrary(item, rows) {
  return rows.some((row) => {
    if (titleMatch(item, row) === 'exact' || titleMatch(row, item) === 'exact') return true
    if (row.artist && row.artist !== '未知艺人') return false
    const parts = fold(row.title).split(/\s+[-–—]\s+/u)
    if (parts.length !== 2) return key(row.title) === key(item.title)
    return [
      [0, 1],
      [1, 0],
    ].some(([t, a]) => key(parts[t]) === key(item.title) && artistMatches(item.artist, parts[a]))
  })
}
