import { requestMusicModel } from './music-model.mjs'

export async function searchCollection(store, vault, scope, query, signal) {
  if (
    typeof scope !== 'string' ||
    scope.length > 128 ||
    typeof query !== 'string' ||
    !query.trim() ||
    query.length > 500
  )
    throw Error('搜索条件无效')
  const local = store.library.list()
  let candidates
  if (scope === 'all') candidates = local.filter((row) => row.listed && row.available)
  else if (scope === 'favorites') candidates = local.filter((row) => row.favorite && row.available)
  else if (local.some((row) => row.folder?.id === scope))
    candidates = local.filter((row) => row.folder?.id === scope && row.available)
  else {
    const list = store.library.playlists().find((row) => row.id === scope)
    if (!list) throw Error('未找到当前歌单或文件夹')
    const members = new Set(list.tracks)
    const online = store.db.prepare('SELECT id,title,artist,album FROM online_tracks').all()
    candidates = [...local.filter((row) => row.available), ...online].filter((row) =>
      members.has(row.id),
    )
  }
  const result = []
  for (let offset = 0; offset < candidates.length; offset += 100) {
    signal.throwIfAborted()
    const page = candidates.slice(offset, offset + 100)
    const tracks = page.map(({ title, artist, album }, index) => ({
      index,
      title: title.slice(0, 160),
      artist: artist.slice(0, 160),
      album: album.slice(0, 160),
    }))
    const matches = await requestMusicModel(
      store,
      vault,
      'search',
      { query: query.trim(), tracks },
      signal,
    )
    for (const index of new Set(matches)) if (page[index]) result.push(page[index].id)
  }
  return result
}
