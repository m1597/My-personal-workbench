// A submission carries source identifiers only. Resolve membership and copy identities in
// the host, and project only public-facing song metadata into the model request.
export function referenceMetadata(track) {
  const fields = [track.title, track.artist, track.album].map((field) =>
    String(field ?? '')
      .replace(/\p{Cc}/gu, ' ')
      .trim(),
  )
  if (!fields[0] || fields.some((value) => /([a-z]:[\\/]|\\\\|[a-z]+:\/\/|^\/)/i.test(value)))
    return null
  const [title, artist, album] = fields.map((value) => value.slice(0, 160))
  return { title, artist, album }
}

function validateSelection(selection) {
  const ids = (values) =>
    Array.isArray(values) &&
    values.length <= 200000 &&
    values.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 120)
  if (
    !selection ||
    typeof selection.favorites !== 'boolean' ||
    !ids(selection.folders) ||
    !ids(selection.playlists) ||
    (selection.legacyExclusions !== undefined && typeof selection.legacyExclusions !== 'boolean')
  )
    throw Error('无效的推荐参考范围')
}

export function resolveReferences(store, input, exclusions) {
  if (input !== undefined) validateSelection(input)
  const aliases = new Map()
  const identity = (id) => {
    let root = id
    while (aliases.has(root)) root = aliases.get(root)
    if (root !== id) aliases.set(id, root)
    return root
  }
  const link = (a, b) => {
    const first = identity(a)
    const second = identity(b)
    if (first !== second) aliases.set(first, second)
  }
  // Providers can share recording IDs only within a proven catalog scope.
  const onlineIdentities = store.db
    .prepare(
      "SELECT id, platform, recording, json_extract(identifiers,'$.catalogScope') AS scope FROM online_recording_sources",
    )
    .all()
  for (const { id, platform, recording, scope } of onlineIdentities) {
    if (scope != null) link(id, JSON.stringify([scope, platform, recording]))
  }
  for (const { online, local } of store.db
    .prepare('SELECT online,local FROM recording_copy_links')
    .all())
    link(local, online)
  const legacy = exclusions.length > 0 && (input === undefined || input.legacyExclusions === true)
  const excluded = (kind) => new Set(exclusions.filter((r) => r.kind === kind).map((r) => r.id))
  const suppressed = new Set()
  const excludedFolders = excluded('folder')
  const excludedPlaylists = excluded('playlist')
  if (legacy && excludedFolders.size) {
    for (const { id, file } of store.db.prepare('SELECT id,file FROM local_tracks').all())
      if (excludedFolders.has(store.library.folderId(file))) suppressed.add(identity(id))
  }
  const folders = new Map()
  const playlists = new Map()
  const favorites = { kind: 'favorites', id: 'favorites', name: '我的收藏', tracks: new Map() }
  const metadata = new Map()
  for (const track of store.library.list()) {
    const data = referenceMetadata(track)
    if (data) metadata.set(track.id, data)
    const key = identity(track.id)
    if (track.favorite && data) favorites.tracks.set(key, data)
    if (!track.folder) continue
    const { id, name } = track.folder
    if (!folders.has(id)) folders.set(id, { kind: 'folder', id, name, tracks: new Map() })
    if (data) folders.get(id).tracks.set(key, data)
  }
  for (const track of store.db
    .prepare(
      'SELECT t.* FROM online_tracks t WHERE EXISTS(SELECT 1 FROM playlist_tracks p WHERE p.track=t.id)',
    )
    .all()) {
    const data = referenceMetadata(track)
    if (data) metadata.set(track.id, data)
  }
  // The synthetic daily playlist has no playlists row. Personal and imported lists do.
  for (const { id, name } of store.db
    .prepare('SELECT id,name FROM playlists ORDER BY rowid')
    .all()) {
    playlists.set(id, { kind: 'playlist', id, name, tracks: new Map() })
  }
  for (const { playlist, track } of store.db
    .prepare('SELECT playlist,track FROM playlist_tracks')
    .all()) {
    const data = metadata.get(track)
    const key = identity(track)
    if (legacy && excludedPlaylists.has(playlist)) suppressed.add(key)
    if (data) playlists.get(playlist)?.tracks.set(key, data)
  }
  const selected = (groups, ids, omitted) => {
    const wanted = ids && new Set(ids)
    return [...groups.keys()].filter((id) => (wanted ? wanted.has(id) : !omitted.has(id)))
  }
  const selection = {
    folders: selected(folders, input?.folders, excludedFolders),
    playlists: selected(playlists, input?.playlists, excludedPlaylists),
    favorites: input?.favorites ?? true,
    ...(legacy ? { legacyExclusions: true } : {}),
  }
  const matches = new Map()
  const add = (group, signal) => {
    for (const [key, data] of group.tracks) {
      if (group !== favorites && suppressed.has(key)) continue
      matches.set(key, { ...data, signal })
    }
  }
  for (const id of selection.folders) add(folders.get(id), '曲库新增')
  for (const id of selection.playlists) add(playlists.get(id), '主动加入自建歌单')
  if (selection.favorites) add(favorites, '主动收藏')
  const options = [...folders.values(), ...playlists.values(), favorites].map(
    ({ kind, id, name, tracks }) => ({ kind, id, name, count: tracks.size }),
  )
  return {
    summary: {
      options,
      selection,
      count: matches.size,
      consented: store.get('taste-consent') === '1',
    },
    tracks: [...matches.values()],
  }
}
