const mbid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const norm = (value) =>
  String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
const quote = (value) => '"' + value.replace(/["\\]/g, '\\$&') + '"'
const roles = {
  composer: '作曲',
  arranger: '编曲',
  lyricist: '作词',
  instrument: '演奏',
  vocal: '演唱',
  conductor: '指挥',
  producer: '制作',
}
const labelRole = (r) => [roles[r.type], ...(r.attributes ?? [])].filter(Boolean).join(' · ')
const titleArtist = (r) => ({
  title: r.title,
  artist: (r['artist-credit'] ?? [])
    .map((c) => (c.name || c.artist?.name || '') + (c.joinphrase || ''))
    .join(''),
})
const workLinks = (r) =>
  (r.relations ?? []).filter((x) => x.type === 'performance' && mbid.test(x.work?.id))
export function registerSongDetails(bind, getStore, metadata) {
  const knownWorks = new Set()
  const knownPeople = new Set()
  function authorizeWork(w) {
    knownWorks.add(w.id)
    return { id: w.id, title: w.title }
  }
  function credits(relations) {
    return (relations ?? [])
      .filter((r) => Object.hasOwn(roles, r.type) && mbid.test(r.artist?.id))
      .map((r) => {
        knownPeople.add(r.artist.id)
        return { id: r.artist.id, name: r.artist.name, role: labelRole(r) }
      })
  }
  async function track(id) {
    if (typeof id !== 'string' || !id || id.length > 256) throw Error('无效录音')
    const store = getStore()
    const local = store.db.prepare('SELECT * FROM local_tracks WHERE id=?').get(id)
    if (local) return { row: local, tags: await store.library.albums.songTags(local) }
    const row =
      store.db
        .prepare('SELECT title,artist,album,duration FROM online_tracks WHERE id=?')
        .get(id) ?? store.item(id)
    const localCopy = await store.library.onlineCopy(id)
    if (localCopy) return { row: localCopy, tags: await store.library.albums.songTags(localCopy) }
    return { row, tags: {} }
  }
  bind('songDetails', async (id) => {
    const { row, tags } = await track(id)
    const localCredits = tags.people ?? []
    let originalArtist = ''
    let catalogCredits = [],
      works = [],
      recording = null,
      error = ''
    try {
      let rid = tags.recording
      if (mbid.test(tags.work)) works = [authorizeWork({ id: tags.work, title: row.title })]
      if (!mbid.test(rid) && !works.length) {
        const cover = row.title.normalize('NFKC').match(/^(.+?)\s*\(翻自\s*([^()]+)\)\s*$/u)
        const title = (cover?.[1] ?? row.title).trim(),
          artist = (cover?.[2] ?? row.artist).trim()
        if (!artist || !title) return { works, people: localCredits, recording, error }
        const search = await metadata('recording', {
          query: 'recording:' + quote(title) + ' AND artist:' + quote(artist),
          limit: '100',
        })
        const exact = (search.recordings ?? []).filter(
          (r) =>
            norm(r.title) === norm(title) &&
            norm(titleArtist(r).artist) === norm(artist) &&
            mbid.test(r.id),
        )
        if (cover && !works.length && search.count <= 100) {
          // The explicit original artist identifies the composition, never the cover's personnel.
          const candidates = exact.filter((r) => !r.video && !r.disambiguation)
          if (candidates.length && candidates.length <= 5) {
            const records = await Promise.all(
              candidates.map((r) =>
                metadata('recording/' + r.id, { inc: 'work-rels+artist-rels+artist-credits' }),
              ),
            )
            const links = records.flatMap(workLinks)
            if (
              records.every((r) => workLinks(r).length === 1) &&
              new Set(links.map((l) => l.work.id)).size === 1
            ) {
              works = [authorizeWork(links[0].work)]
              originalArtist = artist
            }
          }
        } else if (!cover && search.count <= 100) {
          const candidates = exact.filter(
            (r) =>
              !r.video &&
              !r.disambiguation &&
              row.album &&
              r.releases?.some((x) => norm(x.title) === norm(row.album)) &&
              row.duration > 0 &&
              r.length > 0 &&
              Math.abs(r.length / 1000 - row.duration) < 2,
          )
          if (candidates.length === 1) rid = candidates[0].id
        }
      }
      if (mbid.test(rid)) {
        const data = await metadata('recording/' + rid, {
          inc: 'work-rels+artist-rels+artist-credits',
        })
        recording = rid
        const linked = workLinks(data).map((r) => authorizeWork(r.work))
        if (linked.length) works = [...new Map(linked.map((w) => [w.id, w])).values()]
        catalogCredits = credits(data.relations)
      }
    } catch (e) {
      error = e.message
    }
    if (
      row.artist &&
      !catalogCredits.some((p) => p.role.startsWith('演唱') && norm(p.name) === norm(row.artist))
    )
      localCredits.push({ id: null, name: row.artist, role: '署名艺人' })
    return {
      recording,
      originalArtist,
      works,
      people: [
        ...catalogCredits,
        ...localCredits.filter(
          (p) => !catalogCredits.some((c) => c.role === p.role && norm(c.name) === norm(p.name)),
        ),
      ],
      error,
    }
  })
  bind('workDetails', async (id) => {
    if (!knownWorks.has(id)) throw Error('请先选择作品')
    const data = await metadata('work/' + id, { inc: 'recording-rels+artist-rels+artist-credits' })
    const recordings = (data.relations ?? [])
      .filter((r) => r.type === 'performance' && mbid.test(r.recording?.id))
      .map((r) => {
        const rec = r.recording,
          attrs = r.attributes ?? []
        const type = attrs.includes('cover')
          ? '翻唱'
          : attrs.includes('instrumental')
            ? '器乐版'
            : rec.video
              ? '音乐视频'
              : '录音'
        return {
          id: rec.id,
          ...titleArtist(rec),
          duration: rec.length / 1000 || 0,
          detail: rec.disambiguation || '',
          type: attrs.includes('live') ? (type === '翻唱' ? '现场翻唱' : '现场') : type,
        }
      })
    return { title: data.title, people: credits(data.relations), recordings }
  })
  bind('personWorks', async (id, trackId, localName) => {
    if (id === null) {
      const { tags, row: current } = await track(trackId)
      if (current.artist !== localName && !tags.people?.some((p) => p.name === localName))
        throw Error('请先选择参与人员')
      const store = getStore()
      const results = []
      const rows = store.db
        .prepare(
          'SELECT * FROM local_tracks WHERE listed=1 AND available=1 AND awaitingLocation=0 AND id<>?',
        )
        .all(trackId)
      for (const row of rows) {
        const data = await store.library.albums.songTags(row)
        const same = data.people?.filter((p) => p.name === localName) ?? []
        if (row.artist === localName) same.push({ role: '署名艺人' })
        if (same.length)
          results.push({ id: row.id, title: row.title, role: same.map((p) => p.role).join(' · ') })
      }
      return results
    }
    if (!knownPeople.has(id)) throw Error('请先选择参与人员')
    const data = await metadata('artist/' + id, { inc: 'recording-rels+work-rels' })
    const found = new Map()
    for (const rel of data.relations ?? []) {
      const target = rel.work ?? rel.recording
      if (!target || !Object.hasOwn(roles, rel.type)) continue
      const previous = found.get(target.id) ?? {
        id: target.id,
        title: target.title,
        roles: new Set(),
      }
      previous.roles.add(labelRole(rel))
      found.set(target.id, previous)
    }
    return [...found.values()]
      .map((r) => ({ id: r.id, title: r.title, role: [...r.roles].join(' · ') }))
      .sort((a, b) => a.title.localeCompare(b.title))
  })
}
