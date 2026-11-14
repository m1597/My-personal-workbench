import { loadArtistPortrait } from './artist-portrait.mjs'
import { registerSongDetails } from './song-details.mjs'
import { setTimeout as delay } from 'node:timers/promises'

// MusicBrainz reserves this artist for compilations credited to 'Various Artists'.
const variousArtists = '89ad4ac3-39f7-470e-963a-56509c546377'
const mbid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const name = (value) => (typeof value === 'string' ? value.slice(0, 256).trim() : '')
const quote = (value) => '"' + value.replace(/["\\]/g, '\\$&') + '"'
const credit = (entries) =>
  (entries ?? []).map((x) => (x.name || x.artist?.name || '') + (x.joinphrase || '')).join('')
let queue = Promise.resolve()
let nextRequest = 0
async function fetchMetadata(entity, params) {
  const url = new URL('https://musicbrainz.org/ws/2/' + entity)
  url.search = new URLSearchParams({ ...params, fmt: 'json' })
  const ready = queue.then(async () => {
    await delay(Math.max(0, nextRequest - Date.now()))
    nextRequest = Date.now() + 1050
  })
  queue = ready.catch(() => {})
  await ready
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'FitBay/0.1 (https://github.com/m1597/My-personal-workbench)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(12000),
      redirect: 'error',
    })
    if (!response.ok) throw Error()
    return await response.json()
  } catch {
    throw Error('MusicBrainz 暂时无法访问，请稍后重试')
  }
}
export function registerReleaseCatalog(bind, getStore, nativeImage) {
  const responses = new Map()
  async function metadata(entity, params, refresh = false) {
    const key = JSON.stringify([entity, params])
    const cached = responses.get(key)
    if (cached && (!cached.done || (!refresh && cached.expires > Date.now()))) return cached.result
    const entry = { done: false, expires: 0 }
    entry.result = fetchMetadata(entity, params)
      .then((data) => {
        entry.done = true
        entry.expires = Date.now() + 3600000
        for (const [oldKey, old] of responses) {
          if (responses.size <= 128) break
          if (old.done) responses.delete(oldKey)
        }
        return data
      })
      .catch((e) => {
        if (responses.get(key) === entry) responses.delete(key)
        throw e
      })
    responses.set(key, entry)
    return entry.result
  }
  registerSongDetails(bind, getStore, metadata)
  const artists = new Map()
  const releases = new Set()
  const newsGroups = new Set()
  const followed = () => JSON.parse(getStore().get('followed-musicbrainz-artists') || '[]')
  let cachedNews
  bind('findArtists', async (term) => {
    if (!name(term) || term.length > 160) throw Error('请输入艺人名称')
    const data = await metadata('artist', { query: 'artist:' + quote(term.trim()), limit: '12' })
    const found = (data.artists ?? [])
      .filter((x) => mbid.test(x.id))
      .map((x) => ({
        id: x.id,
        name: name(x.name),
        detail: [name(x.disambiguation), name(x.country), name(x.type)].filter(Boolean).join(' · '),
      }))
    for (const artist of found) artists.set(artist.id, artist)
    return found
  })
  bind('trackArtists', async (title, artist) => {
    if (!name(title) || !name(artist) || title.length > 256 || artist.length > 256)
      throw Error('无效歌曲署名')
    const normalized = (s) => name(s).normalize('NFKC').toLowerCase()
    const data = await metadata('recording', { query: 'recording:' + quote(title), limit: '100' })
    if (data.count > 100) return []
    const matched = new Map()
    for (const r of data.recordings ?? []) {
      if (normalized(r.title) !== normalized(title)) continue
      for (const credit of r['artist-credit'] ?? []) {
        const a = credit.artist
        if (
          !a ||
          !mbid.test(a.id) ||
          ![credit.name, a.name, a['sort-name']].some((v) => normalized(v) === normalized(artist))
        )
          continue
        const result = { id: a.id, name: name(a.name), detail: name(a.disambiguation) }
        matched.set(a.id, result)
        artists.set(a.id, result)
      }
    }
    return [...matched.values()]
  })
  const related = new Map()
  bind('similarArtists', async (id) => {
    if (!mbid.test(id) || !followed().some((a) => a.id === id)) throw Error('请先选择已关注歌手')
    const data = await metadata('artist/' + id, { inc: 'genres+artist-rels' })
    const excluded = new Set([
      id,
      variousArtists,
      ...(data.relations ?? []).filter((r) => r.type === 'is person').map((r) => r.artist?.id),
    ])
    const genres = (data.genres ?? [])
      .filter((g) => name(g.name) && g.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
    if (!genres.length) return []
    const tags = genres.map((g) => name(g.name).toLowerCase())
    const field = (tag) => 'tag:' + quote(tag)
    const candidates = new Map()
    // Search the intersection first, then broaden the pool if too few verified matches remain.
    async function collect(query) {
      const data = await metadata('artist/', { query, limit: '50' })
      for (const a of data.artists ?? []) {
        if (!mbid.test(a.id) || excluded.has(a.id) || !name(a.name) || candidates.has(a.id))
          continue
        const votes = new Map(
          (a.tags ?? [])
            .filter((t) => name(t.name) && t.count > 0)
            .map((t) => [name(t.name).toLowerCase(), t.count]),
        )
        const shared = tags.filter((t) => votes.has(t))
        if (!shared.length) continue
        const support = shared.reduce(
          (sum, t) => sum + Math.min(votes.get(t), genres[tags.indexOf(t)].count),
          0,
        )
        candidates.set(a.id, {
          id: a.id,
          name: name(a.name),
          detail: '共同风格 · ' + shared.join('、'),
          count: shared.length,
          support,
        })
      }
    }
    await collect(tags.map(field).join(' AND '))
    if (candidates.size < 8 && tags.length > 1) await collect(tags.map(field).join(' OR '))
    const result = [...candidates.values()]
      .sort((a, b) => b.count - a.count || b.support - a.support || a.name.localeCompare(b.name))
      .slice(0, 8)
      .map(({ id, name, detail }) => ({ id, name, detail }))
    for (const a of result) related.set(a.id, a)
    return result
  })
  const knownArtist = (id) =>
    mbid.test(id) && (artists.has(id) || related.has(id) || followed().some((a) => a.id === id))
  bind('artistHighlights', async (id) => {
    if (!knownArtist(id)) throw Error('请先选择艺人')
    const data = await metadata('recording', {
      query: 'arid:' + id + ' AND status:official',
      limit: '25',
    })
    const titles = new Set()
    const recordings = data.recordings ?? []
    const singles = (r) =>
      (r.releases ?? []).filter((x) => x['release-group']?.['primary-type'] === 'Single').length
    const alternate = (r) =>
      Number(/(?:instrumental|karaoke|伴奏|off vocal|tv size)/iu.test(name(r.title)))
    recordings.sort(
      (a, b) =>
        alternate(a) - alternate(b) ||
        singles(b) - singles(a) ||
        (b.releases?.length ?? 0) - (a.releases?.length ?? 0),
    )
    return recordings
      .filter((r) => {
        const title = name(r.title)
        if (!title || titles.has(title) || !r['artist-credit']?.some((c) => c.artist?.id === id))
          return false
        titles.add(title)
        return true
      })
      .slice(0, 5)
      .map((r) => ({ title: name(r.title), artist: credit(r['artist-credit']) }))
  })
  bind('followedArtists', followed)
  const portraits = new Map()
  let portraitQueue = Promise.resolve()
  bind('artistPortrait', async (id) => {
    if (!knownArtist(id)) throw Error('请先选择艺人')
    const store = getStore()
    store.db.exec(
      'CREATE TABLE IF NOT EXISTS artist_portraits(id TEXT PRIMARY KEY,image TEXT,expires INTEGER NOT NULL)',
    )
    const cached = store.db
      .prepare('SELECT image FROM artist_portraits WHERE id=? AND expires>?')
      .get(id, Date.now())
    if (cached) return cached.image
    if (portraits.has(id)) return portraits.get(id)
    const artist = artists.get(id) ?? related.get(id) ?? followed().find((a) => a.id === id)
    const request = (async () => {
      const local = await store.library.albums.artistPortrait(artist.name, nativeImage)
      let image = local
      if (!image) {
        // Let interactive release lookups enter the rate-limited metadata queue between portraits.
        const result = portraitQueue.then(() => loadArtistPortrait(id, metadata, nativeImage))
        portraitQueue = result.then(
          () => {},
          () => {},
        )
        image = await result
      }
      store.db
        .prepare('INSERT OR REPLACE INTO artist_portraits VALUES(?,?,?)')
        .run(id, image, Date.now() + (image ? 30 : 1) * 86400000)
      store.db
        .prepare(
          'DELETE FROM artist_portraits WHERE id IN (SELECT id FROM artist_portraits ORDER BY expires DESC LIMIT -1 OFFSET 500)',
        )
        .run()
      return image
    })().finally(() => portraits.delete(id))
    portraits.set(id, request)
    return request
  })
  bind('followArtist', (id, on) => {
    if (!mbid.test(id) || typeof on !== 'boolean') throw Error('无效艺人')
    const list = followed()
    if (on && !list.some((a) => a.id === id)) {
      const artist = artists.get(id) ?? related.get(id)
      if (!artist) throw Error('请重新搜索并选择艺人')
      list.push(artist)
    }
    const next = on ? list : list.filter((a) => a.id !== id)
    getStore().set('followed-musicbrainz-artists', JSON.stringify(next))
    cachedNews = undefined
    return next
  })
  async function readGroups(ids, query, refresh = false, from = '', until = '') {
    const rows = new Map()
    for (let offset = 0; ; offset += 100) {
      const data = await metadata(
        'release-group',
        { query, limit: '100', offset: String(offset) },
        refresh,
      )
      const groups = data['release-groups'] ?? []
      for (const g of groups) {
        const date = g['first-release-date'] ?? ''
        if (
          !mbid.test(g.id) ||
          !(g['artist-credit'] ?? []).some((c) => ids.includes(c.artist?.id)) ||
          (from && date < from) ||
          (until && date > until)
        )
          continue
        const type = (g['secondary-types'] ?? []).includes('Soundtrack')
          ? '原声带'
          : { Album: '专辑', Single: '单曲', EP: 'EP' }[g['primary-type']]
        if (!type) continue
        newsGroups.add(g.id)
        rows.set(g.id, {
          id: g.id,
          type,
          title: name(g.title),
          artist: credit(g['artist-credit']),
          date,
        })
      }
      if (groups.length < 100 || offset + 100 >= data.count) break
    }
    return [...rows.values()]
  }
  const newest = (a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title)
  bind('artistReleases', async (id) => {
    if (!knownArtist(id)) throw Error('请先选择艺人')
    return (await readGroups([id], 'arid:' + id + ' AND status:official')).sort(newest)
  })
  bind('releaseNews', async (refresh = false) => {
    if (typeof refresh !== 'boolean') throw Error('无效请求')
    const list = followed()
    const key = JSON.stringify(list.map((a) => a.id))
    if (!refresh && cachedNews?.key === key && cachedNews.expires > Date.now())
      return cachedNews.rows
    const today = new Date().toISOString().slice(0, 10)
    const from = new Date(Date.now() - 89 * 86400000).toISOString().slice(0, 10)
    const rows = new Map()
    for (let i = 0; i < list.length; i += 20) {
      const ids = list.slice(i, i + 20).map((a) => a.id)
      const query =
        'arid:(' +
        ids.join(' OR ') +
        ') AND status:official AND firstreleasedate:[' +
        from +
        ' TO ' +
        today +
        ']'
      for (const row of await readGroups(ids, query, refresh, from, today)) rows.set(row.id, row)
    }
    const result = [...rows.values()].sort(newest)
    cachedNews = { key, rows: result, expires: Date.now() + 3600000 }
    return result
  })
  bind('newsEditions', async (id) => {
    if (!mbid.test(id) || !newsGroups.has(id)) throw Error('请先选择动态中的发行')
    return findEditions('rgid:' + id + ' AND status:official')
  })
  bind('albumEditions', async (albumId) => {
    if (typeof albumId !== 'string' || !/^[a-f0-9]{64}$/.test(albumId)) throw Error('无效专辑')
    const album = (await getStore().library.albums.list()).find((a) => a.id === albumId)
    if (!album) throw Error('本地专辑已变更')
    return findEditions('release:' + quote(album.title) + ' AND artist:' + quote(album.artist))
  })
  bind('namedEditions', async (title, artist) => {
    if (
      typeof title !== 'string' ||
      typeof artist !== 'string' ||
      !name(title) ||
      !name(artist) ||
      title.length > 256 ||
      artist.length > 256
    )
      throw Error('无效专辑')
    return findEditions('release:' + quote(title) + ' AND artist:' + quote(artist))
  })
  async function findEditions(query) {
    const choices = []
    for (let offset = 0; ; offset += 100) {
      const data = await metadata('release', { query, limit: '100', offset: String(offset) })
      const items = data.releases ?? []
      for (const r of items) {
        if (!mbid.test(r.id)) continue
        releases.add(r.id)
        choices.push({
          id: r.id,
          title: name(r.title),
          artist: credit(r['artist-credit']),
          detail: [
            r.date,
            r.country,
            ...(r.media ?? []).map((m) => m.format).filter(Boolean),
            r['track-count'] && r['track-count'] + ' 曲',
            r.disambiguation,
            r.barcode,
          ]
            .filter(Boolean)
            .join(' · '),
        })
      }
      if (items.length < 100 || offset + 100 >= data.count) break
    }
    return choices
  }
  bind('editionTracks', async (id) => {
    if (!mbid.test(id) || !releases.has(id)) throw Error('请先选择发行版本')
    const data = await metadata('release/' + id, { inc: 'recordings+artist-credits' })
    return (data.media ?? []).flatMap((m) =>
      (m.tracks ?? []).map((t) => ({
        disc: m.position,
        number: t.number,
        position: t.position ?? (/^\d+$/.test(t.number) ? Number(t.number) : null),
        title: name(t.title ?? t.recording?.title),
        artist: credit(
          t['artist-credit'] ?? t.recording?.['artist-credit'] ?? data['artist-credit'],
        ),
      })),
    )
  })
}
