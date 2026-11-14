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
const versionLabels = [
  ['cover', /^(?:cover(?: version)?|翻唱(?:版)?)$/iu],
  [
    'live',
    /^(?:live(?:\s+(?:version|ver\.?|at\b.+|in\b.+|from\b.+|\d{4}.*))?|现场(?:版|录音)?|現場(?:版|錄音)?|ライブ(?:版)?|演唱会(?:版|现场)?)$/iu,
  ],
  [
    'original',
    /^(?:original(?:\s+(?:version|mix))?|studio(?:\s+version)?|原版|原唱版|录音室版|錄音室版)$/iu,
  ],
  ['acoustic', /^(?:acoustic(?:\s+version)?|unplugged|不插电(?:版)?)$/iu],
  ['instrumental', /^(?:instrumental(?:\s+version)?|off vocal|伴奏(?:版)?|纯音乐(?:版)?)$/iu],
  ['remix', /^(?:remix|[\w .'-]{1,50}\s+remix|混音版)$/iu],
  ['remaster', /^(?:(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?|重制版|重製版)$/iu],
]
function edition(title) {
  const name = fold(title)
  const suffix = name.match(/^(.*?)\s*(?:[([【]([^()[\]【】]+)[)\]】]|\s+[-–—]\s+(.+))$/u)
  if (suffix?.[1].trim()) {
    const detail = (suffix[2] || suffix[3]).trim()
    const credit =
      detail.match(/^(?:cover\.?(?:\s+of)?|原唱|翻自|翻唱自)\s*[:：]?\s+(.+)$/iu) ||
      detail.match(/^(?:原唱|翻自|翻唱自)\s*[:：]\s*(.+)$/iu)
    if (credit) return { base: suffix[1].trim(), kind: 'cover', origin: credit[1].trim(), detail }
    if (/\blive\b/iu.test(detail) && /\b(?:19|20)\d{2}\b/u.test(detail))
      return { base: suffix[1].trim(), kind: 'live', detail }
    for (const [kind, pattern] of versionLabels)
      if (pattern.test(detail)) return { base: suffix[1].trim(), kind, detail }
  }
  return { base: name, kind: '', detail: '' }
}
const originalArtists = (row) =>
  [row.originalArtist, ...(Array.isArray(row.originalArtists) ? row.originalArtists : [])]
    .map((v) => (typeof v === 'string' ? v : v?.name))
    .filter((v) => typeof v === 'string' && v.trim())
    .join(' / ')
const liveAlbum = (name) =>
  /(?:^live$|\blive (?:at|in|from|recording|version|album|(?:19|20)\d{2})\b|[(【]live[)】]|现场(?:版|录音)|現場版|演唱会现场|ライブ盤)/iu.test(
    name ?? '',
  )
export function recordingConstraints(text, prefs) {
  const description = fold(text)
    .replace(/《[^》]*》/gu, '')
    .replace(/原唱(?:的)?(?:署名|标注|信息)/gu, '')
  const live = '现场(?:版|录音)?|現場(?:版|錄音)?|ライブ版|\\blive\\b(?:\\s+(?:version|recording))?'
  const studio = '录音室(?:版)?|錄音室(?:版)?|\\bstudio\\b(?:\\s+(?:version|recording))?'
  function intent(pattern, fallback, recordingLocation = false) {
    const kind = `(?:${pattern})`
    const matches = (rule) => new RegExp(rule, 'iu').test(description)
    if (!matches(kind)) return fallback
    if (matches(`(?:不要|不听|不想听|排除|避免|别来|非)\\s*(?:听)?\\s*${kind}`)) return 'exclude'
    if (matches(`(?:只要|只听|仅要|仅听|必须是)\\s*${kind}`)) return 'require'
    if (matches(`(?:优先|首选|最好是|偏爱|偏好)\\s*(?:听)?\\s*${kind}|${kind}\\s*(?:优先|为佳)`))
      return 'prefer'
    if (matches(`(?:允许|接受|可以有|也可以听)\\s*${kind}|${kind}\\s*(?:也|都)?(?:可以|行|可接受)`))
      return 'any'
    // A bare location in a listening scenario does not specify a recording edition.
    if (
      recordingLocation &&
      !matches(
        `^\\s*${kind}\\s*$|(?:要|听|推荐|找|来点)\\s*(?:一些|几首|点)?${kind}|${kind}(?:版|录音)`,
      )
    )
      return fallback
    return 'require'
  }
  const pair = (first, second) => `(?:${first})\\s*(?:和|或|、|与)\\s*(?:${second})`
  const either = new RegExp(
    `(?:${pair(live, studio)}|${pair(studio, live)})\\s*(?:都|均)?(?:可以|行|可接受)`,
    'iu',
  ).test(description)
  const liveIntent = either ? 'any' : intent(live, undefined, true)
  const studioIntent = either ? 'any' : intent(studio, undefined, true)
  const original = intent('原版|原唱(?!\\s*[:：])(?:版)?|\\boriginal\\b')
  let version = ''
  if (original === 'require') version = 'original'
  else if (liveIntent === 'exclude') version = 'no-live'
  else if (studioIntent === 'exclude') version = 'live'
  else if (liveIntent === 'require' && studioIntent !== 'require') version = 'live'
  else if (studioIntent === 'require' && liveIntent !== 'require') version = 'no-live'
  else if (original === 'exclude') version = 'no-original'
  let editionPreference = prefs.edition
  if (liveIntent === 'prefer') editionPreference = 'live'
  else if (studioIntent === 'prefer') editionPreference = 'studio'
  else if (liveIntent === 'any' || studioIntent === 'any') editionPreference = 'any'
  return {
    version,
    editionPreference,
    cover: intent('翻唱(?:版)?|cover\\b', prefs.cover),
    instrumental: intent('伴奏(?:版)?|纯音乐(?:版)?|instrumental', prefs.instrumental),
  }
}
export function recordingRank(row, constraints) {
  const version = edition(row.name ?? row.title)
  const live = version.kind === 'live' || liveAlbum(row.albumName)
  const cover =
    version.kind === 'cover' ||
    (originalArtists(row) && !artistMatches(row.singer ?? row.artist, originalArtists(row)))
  return (
    Number(
      (constraints.editionPreference === 'live' && !live) ||
        (constraints.editionPreference === 'studio' && live),
    ) +
    Number((constraints.cover === 'prefer' && !cover) || (constraints.cover === 'avoid' && cover)) +
    Number(constraints.instrumental === 'prefer' && version.kind !== 'instrumental')
  )
}
export function titleMatch(item, row, constraints = {}) {
  const artist = row.singer ?? row.artist
  if (constraints.artist && !artistMatches(constraints.artist, artist, row.artistAliases)) return ''
  const sameArtist = artistMatches(item.artist, artist, row.artistAliases)
  const wanted = titles(item.title, item.artist).map(edition)
  const found = titles(row.name ?? row.title, artist).map(edition)
  // Catalog aliases establish spelling/translation only; the primary title determines the recording edition.
  const primary = edition(row.name ?? row.title)
  const workAliases = Array.isArray(row.titleAliases)
    ? row.titleAliases.filter((v) => typeof v === 'string' && v.trim()).map(edition)
    : []
  const albumLive = liveAlbum(row.albumName)
  const explicitOriginal = originalArtists(row)
  if (primary.origin && explicitOriginal && !artistMatches(primary.origin, explicitOriginal))
    return ''
  for (const request of wanted) {
    for (const entry of [...found, ...workAliases]) {
      if (!key(request.base) || key(request.base) !== key(entry.base)) continue
      const kind = primary.kind || (albumLive ? 'live' : '')
      const cover = primary.origin || explicitOriginal
      const isCover = kind === 'cover' || !!(cover && !artistMatches(artist, cover))
      if (
        (constraints.cover === 'require' && !isCover) ||
        (constraints.cover === 'exclude' && isCover)
      )
        continue
      if (constraints.instrumental === 'require' && kind !== 'instrumental') continue
      if (['requested', 'exclude'].includes(constraints.instrumental) && kind === 'instrumental')
        continue
      if (!sameArtist && !(cover && artistMatches(item.artist, cover))) continue
      if (
        constraints.exactChart &&
        (!sameArtist || kind !== request.kind || key(request.detail) !== key(primary.detail))
      )
        continue
      if (request.kind && request.kind !== kind && !(request.kind === 'original' && !kind)) continue
      if (
        request.origin &&
        (!cover || !artistMatches(request.origin, cover) || !artistMatches(cover, request.origin))
      )
        continue
      const qualified =
        ['live', 'remix', 'remaster'].includes(request.kind) &&
        !/^(?:live(?: version| ver\.?)?|现场(?:版|录音)?|現場版|ライブ版|remix|混音版|remaster(?:ed)?|重制版)$/iu.test(
          request.detail,
        )
      if (qualified && key(request.detail) !== key(primary.detail)) continue
      if (constraints.version === 'live' && kind !== 'live') continue
      if (constraints.version === 'no-live' && kind === 'live') continue
      if (
        constraints.version === 'original' &&
        (!sameArtist || (kind && kind !== 'original') || (cover && !artistMatches(artist, cover)))
      )
        continue
      if (constraints.version === 'no-original' && sameArtist && (!kind || kind === 'original'))
        continue
      if (!sameArtist) return 'cover'
      return kind === request.kind && (!kind || key(request.detail) === key(primary.detail))
        ? 'exact'
        : 'variant'
    }
  }
  return ''
}
function recommendationCredits(row) {
  return row.artist?.includes('×') ? { ...row, artist: row.artist.replaceAll('×', '/') } : row
}
export function inLibrary(candidate, rows) {
  const item = recommendationCredits(candidate)
  return rows.some((entry) => {
    const row = recommendationCredits(entry)
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
    { title: edition(title).base, artist },
    { title: edition(title).base, artist: '' },
  ]
  return queries.filter(
    (q, index) =>
      queries.findIndex(
        (other) => fold(q.title) === fold(other.title) && fold(q.artist) === fold(other.artist),
      ) === index,
  )
}

export async function searchRecommendation(
  item,
  platform,
  search,
  signal,
  constraints,
  phase = 'full',
  accept = () => true,
) {
  const queries = recordingQueries(item)
  const diagnostics = []
  let pending = (phase === 'shallow' ? queries.slice(0, 1) : queries).map((query) => ({
    query,
    offset: 0,
    pages: new Set(),
  }))
  for (let page = 1; pending.length && page <= (phase === 'shallow' ? 1 : 5); page++) {
    const further = []
    for (const { query, pages, offset } of pending) {
      signal.throwIfAborted()
      const data = await search(query, page, offset)
      const rows = Array.isArray(data) ? data : (data?.items ?? data?.list ?? data?.songs)
      if (!Array.isArray(rows)) throw Error('源返回了无效的版本列表')
      const signature = JSON.stringify(rows)
      if (pages.has(signature)) continue
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
          titleMatch(item, row, constraints),
      )
      if (
        matches.length &&
        !(phase === 'deep' && query === queries[0] && page === 1) &&
        (await accept(matches))
      )
        return { matches, diagnostics }
      const nextOffset = offset + rows.length
      if (
        !rows.length ||
        data.hasMore === false ||
        (Number.isFinite(data.total) && nextOffset >= data.total) ||
        (rows.length < 20 && data.hasMore !== true && !(data.total > nextOffset))
      )
        continue
      further.push({ query, pages, offset: nextOffset })
    }
    pending = further
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

export function recordingDisplayTitle(row) {
  const name = String(row.name ?? '').trim()
  return !edition(name).kind && liveAlbum(row.albumName) ? name + '（现场版）' : name
}
