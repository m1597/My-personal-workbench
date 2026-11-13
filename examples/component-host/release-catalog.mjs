import { setTimeout as delay } from 'node:timers/promises'

const mbid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const name = (value) => (typeof value === 'string' ? value.slice(0, 256).trim() : '')
const quote = (value) => '"' + value.replace(/["\\]/g, '\\$&') + '"'
const credit = (entries) =>
  (entries ?? []).map((x) => (x.name || x.artist?.name || '') + (x.joinphrase || '')).join('')
let queue = Promise.resolve()
let nextRequest = 0
async function metadata(entity, params) {
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
export function registerReleaseCatalog(bind, getStore) {
  const artists = new Map()
  const releases = new Set()
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
  bind('followedArtists', followed)
  bind('followArtist', (id, on) => {
    if (!mbid.test(id) || typeof on !== 'boolean') throw Error('无效艺人')
    const list = followed()
    if (on && !list.some((a) => a.id === id)) {
      const artist = artists.get(id)
      if (!artist) throw Error('请重新搜索并选择艺人')
      list.push(artist)
    }
    const next = on ? list : list.filter((a) => a.id !== id)
    getStore().set('followed-musicbrainz-artists', JSON.stringify(next))
    cachedNews = undefined
    return next
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
      for (let offset = 0; ; offset += 100) {
        const data = await metadata('release-group', {
          query,
          limit: '100',
          offset: String(offset),
        })
        const groups = data['release-groups'] ?? []
        for (const g of groups) {
          const date = g['first-release-date']
          if (
            !mbid.test(g.id) ||
            !(g['artist-credit'] ?? []).some((c) => ids.includes(c.artist?.id)) ||
            !date ||
            date < from ||
            date > today
          )
            continue
          rows.set(g.id, {
            id: g.id,
            title: name(g.title),
            artist: credit(g['artist-credit']),
            date,
          })
        }
        if (groups.length < 100 || offset + 100 >= data.count) break
      }
    }
    const result = [...rows.values()].sort(
      (a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title),
    )
    cachedNews = { key, rows: result, expires: Date.now() + 3600000 }
    return result
  })
  bind('albumEditions', async (albumId) => {
    if (typeof albumId !== 'string' || !/^[a-f0-9]{64}$/.test(albumId)) throw Error('无效专辑')
    const album = (await getStore().library.albums.list()).find((a) => a.id === albumId)
    if (!album) throw Error('本地专辑已变更')
    const query = 'release:' + quote(album.title) + ' AND artist:' + quote(album.artist)
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
  })
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
