import { registerSongDetails } from './song-details.mjs'
import { setTimeout as delay } from 'node:timers/promises'

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
    artists.clear()
    for (const artist of found) artists.set(artist.id, artist)
    return found
  })
  const related = new Map()
  bind('similarArtists', async (id) => {
    if (!mbid.test(id) || !followed().some((a) => a.id === id)) throw Error('请先选择已关注歌手')
    const data = await metadata('artist/' + id, { inc: 'artist-rels+genres' })
    const candidates = new Map()
    const excluded = new Set(followed().map((a) => a.id))
    excluded.add(id)
    for (const rel of data.relations ?? []) {
      if (rel.type === 'is person') excluded.add(rel.artist?.id)
    }
    function include(a, detail) {
      if (mbid.test(a?.id) && name(a.name) && !excluded.has(a.id) && !candidates.has(a.id)) {
        candidates.set(a.id, { id: a.id, name: name(a.name), detail })
      }
    }
    for (const rel of data.relations ?? []) {
      const reason = {
        'member of band': '乐队成员',
        collaboration: '合作歌手',
        'supporting musician': '演出合作',
        'artist subgroup': '关联组合',
        founder: '创办组合',
      }[rel.type]
      if (reason) include(rel.artist, reason)
    }
    const genre = [...(data.genres ?? [])].sort((a, b) => b.count - a.count)[0]
    if (!candidates.size && name(genre?.name)) {
      const matches = await metadata('artist', {
        query: 'tag:' + quote(name(genre.name)),
        limit: '24',
      })
      for (const a of matches.artists ?? []) include(a, '共同风格 · ' + name(genre.name))
    }
    const result = [...candidates.values()].slice(0, 8)
    for (const a of result) related.set(a.id, a)
    return result
  })
  bind('artistHighlights', async (id) => {
    if (!mbid.test(id) || !related.has(id)) throw Error('请先选择相似歌手')
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
  bind('artistPortrait', async (id) => {
    const artist = mbid.test(id) && followed().find((a) => a.id === id)
    if (!artist) throw Error('请先关注艺人')
    return getStore().library.albums.artistPortrait(artist.name, nativeImage)
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
    if (!mbid.test(id) || !followed().some((artist) => artist.id === id))
      throw Error('请先关注艺人')
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
