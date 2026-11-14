const id = { type: 'string', minLength: 1, maxLength: 120 }
const offset = { type: 'integer', minimum: 0, maximum: 10000000 }
const tracks = { type: 'array', items: id, minItems: 1, maxItems: 100 }
const schema = (name, description, properties) => ({
  name,
  description,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  },
})
export const libraryTools = [
  schema(
    'recent_tracks',
    '最近播放的本地录音，按最后播放时间倒序，跳过已隐藏条目。每页最多 50 首。',
    { offset },
  ),
  schema(
    'search_library',
    '按歌名、艺人或专辑搜索已入库且可用的本地录音。空关键词浏览全部，每页最多 50 首。',
    { query: { type: 'string', maxLength: 200 }, offset },
  ),
  schema('list_playlists', '列出歌单、ID 和曲目数量，每页最多 50 个。', { offset }),
  schema('add_to_playlist', '按指定顺序将录音 ID 加入已有歌单，重复项保留原位置。', {
    playlist: id,
    tracks,
  }),
  schema('create_listening_playlist', '新建试听歌单。使用曲库候选录音 ID 按脚本段落排序。', {
    name: { type: 'string', minLength: 1, maxLength: 80 },
    tracks,
  }),
  schema(
    'compare_playlists',
    '按相同录音 ID 比较两个歌单的共有曲目，包含在线引用，保留左侧顺序，每页最多 50 首。',
    { left: id, right: id, offset },
  ),
]
export function validLibraryArgs(tool, args) {
  return Object.entries(tool.inputSchema.properties).every(([key, rule]) => {
    const v = args[key]
    if (rule.type === 'integer')
      return Number.isSafeInteger(v) && v >= rule.minimum && v <= rule.maximum
    if (rule.type === 'array')
      return (
        Array.isArray(v) &&
        v.length > 0 &&
        v.length <= 100 &&
        v.every((i) => typeof i === 'string' && i.length > 0 && i.length <= 120)
      )
    return typeof v === 'string' && v.length >= (rule.minLength || 0) && v.length <= rule.maxLength
  })
}
export function callLibraryTool(store, name, args) {
  const fields = 'id,title,artist,album,duration'
  if (name === 'recent_tracks')
    return store.db
      .prepare(
        'SELECT ' +
          fields +
          ',lastHeardAt FROM local_tracks WHERE lastHeardAt IS NOT NULL AND hiddenFromRecent=0 ORDER BY lastHeardAt DESC,id LIMIT 50 OFFSET ?',
      )
      .all(args.offset)
  if (name === 'search_library')
    return store.db
      .prepare(
        'SELECT ' +
          fields +
          ' FROM local_tracks WHERE listed=1 AND available=1 AND unplayable=0 AND instr(lower(title||char(10)||artist||char(10)||album),lower(?))>0 ORDER BY title,id LIMIT 50 OFFSET ?',
      )
      .all(args.query, args.offset)
  const lists = store.library.playlists()
  if (name === 'list_playlists')
    return lists
      .slice(args.offset, args.offset + 50)
      .map((p) => ({ id: p.id, name: p.name, count: p.tracks.length }))
  if (name === 'add_to_playlist') {
    store.library.setMembership(args.playlist, args.tracks, true)
    return { playlist: args.playlist }
  }
  if (name === 'create_listening_playlist')
    return { playlist: store.library.createPlaylist(args.name, args.tracks, true) }
  const left = lists.find((p) => p.id === args.left),
    right = lists.find((p) => p.id === args.right)
  if (!left || !right) throw Error('未找到要比较的歌单')
  const shared = new Set(right.tracks)
  const local = store.db.prepare('SELECT ' + fields + ' FROM local_tracks WHERE id=?')
  const online = store.db.prepare('SELECT ' + fields + ' FROM online_tracks WHERE id=?')
  return left.tracks
    .filter((id) => shared.has(id))
    .slice(args.offset, args.offset + 50)
    .map((id) => {
      const recording = online.get(id)
      return recording ? { ...recording, origin: 'online' } : { ...local.get(id), origin: 'local' }
    })
}
