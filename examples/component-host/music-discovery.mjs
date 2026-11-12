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

export function recordingQueries(item) {
  const normalized = (value) =>
    String(value)
      .normalize('NFKC')
      .replace(/[‘’]/gu, "'")
      .replace(/[‐‑–—]/gu, '-')
      .replace(/\s+/gu, ' ')
      .trim()
  const title = normalized(titles(item.title, item.artist).at(-1))
  const artist = normalized(item.artist)
  const queries = [
    { title: item.title, artist: item.artist },
    { title, artist },
    { title, artist: '' },
  ]
  return queries.filter(
    (q, index) =>
      queries.findIndex((other) => q.title === other.title && q.artist === other.artist) === index,
  )
}

export async function searchRecommendation(item, platform, search, signal) {
  const queries = recordingQueries(item)
  const diagnostics = []
  for (const query of queries) {
    let offset = 0
    const pages = new Set()
    for (let page = 1; page <= 5; page++) {
      signal.throwIfAborted()
      const data = await search(query, page, offset)
      const rows = Array.isArray(data) ? data : (data?.items ?? data?.list ?? data?.songs)
      if (!Array.isArray(rows)) throw Error('源返回了无效的版本列表')
      const signature = JSON.stringify(rows)
      if (pages.has(signature)) break
      pages.add(signature)
      diagnostics.push(
        [query.title, query.artist].filter(Boolean).join(' ') +
          ' 第' +
          page +
          '页（' +
          rows.length +
          ' 条）',
      )
      const matches = rows.filter(
        (row) =>
          row &&
          typeof row.name === 'string' &&
          typeof row.singer === 'string' &&
          (!row.source || row.source === platform) &&
          JSON.stringify(row).length <= 16384 &&
          titleMatch(item, row),
      )
      if (matches.length) return { matches, diagnostics }
      offset += rows.length
      if (
        !rows.length ||
        data.hasMore === false ||
        (Number.isFinite(data.total) && offset >= data.total) ||
        (rows.length < 20 && data.hasMore !== true && !(data.total > offset))
      )
        break
    }
  }
  return { matches: [], diagnostics }
}

export function namesRequestedArtist(preference, artist, declared = false) {
  const request = fold(preference)
  if (
    !request ||
    /比如|例如|这类|类似|像.+一样|相似|不同(?:的)?(?:音乐人|艺人|歌手)|每(?:位|个)(?:音乐人|艺人|歌手)|similar to|such as|for example|different artists/i.test(
      request,
    )
  )
    return false
  const names = [fold(artist), ...splitArtists(artist)].flatMap((credit) => {
    const alias = credit.match(/^(.+?)\s*\(([^()]+)\)$/u)
    return alias ? [credit, alias[1], alias[2]] : [credit]
  })
  return names.some((name) => {
    const needle = name.trim()
    if (!needle) return false
    if (request === needle) return true
    let index = request.indexOf(needle)
    while (index >= 0) {
      const before = request.slice(0, index)
      const after = request.slice(index + needle.length)
      const whole =
        !(/[a-z0-9]$/iu.test(before) && /^[a-z0-9]/iu.test(needle)) &&
        !(/[a-z0-9]$/iu.test(needle) && /^[a-z0-9]/iu.test(after))
      if (
        whole &&
        (declared ||
          /(?:只(?:想)?听|仅听|只要|only(?: songs by)?)\s*$/iu.test(before) ||
          /^\s*(?:本人|自己的歌|的(?:歌曲|作品|歌)(?:[，。！!\s]|$))/u.test(after))
      )
        return true
      index = request.indexOf(needle, index + 1)
    }
    return false
  })
}
