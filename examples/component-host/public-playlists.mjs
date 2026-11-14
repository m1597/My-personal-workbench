import { openPublic } from './lx-net.mjs'
import { qqSong, kgSong } from './lx-platform-search.mjs'

const kgBase = 'http://www2.kugou.kugou.com/yueku/v9/special/'
const encode = encodeURIComponent
async function read(url, json = true) {
  const response = await openPublic(url, {
    signal: AbortSignal.timeout(18000),
    headers: { referer: new URL(url).origin + '/' },
  })
  try {
    if (response.statusCode !== 200) throw Error('平台歌单目录返回 HTTP ' + response.statusCode)
    const parts = []
    let size = 0
    for await (const part of response) {
      size += part.length
      if (size > 24 * 1024 * 1024) throw Error('平台返回的歌单过大')
      parts.push(part)
    }
    const body = Buffer.concat(parts).toString('utf8')
    return json ? JSON.parse(body) : body
  } finally {
    response.destroy()
  }
}
async function qq(module, method, param) {
  const data = { comm: { cv: 1602, ct: 20 }, p: { module, method, param } }
  const result = await read(
    'https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data=' + encode(JSON.stringify(data)),
  )
  if (result.p?.code !== 0) throw Error('QQ 音乐歌单暂时不可用')
  return result.p.data
}
export async function genres(platform) {
  let tags
  if (platform === 'wy') {
    const data = await read('https://music.163.com/api/playlist/catalogue')
    tags = data.sub?.map((t) => ({ id: t.name, name: t.name }))
  } else if (platform === 'tx') {
    const data = await qq('playlist.PlaylistAllCategoriesServer', 'get_all_categories', { qq: '' })
    tags = data.v_group?.flatMap((g) => g.v_item.map((t) => ({ id: String(t.id), name: t.name })))
  } else if (platform === 'kg') {
    const data = await read(kgBase + 'getSpecial?is_smarty=1')
    tags = Object.values(data.data.tagids).flatMap((g) =>
      g.data.map((t) => ({ id: String(t.id), name: t.name })),
    )
  }
  if (!Array.isArray(tags)) throw Error('无法读取平台分类')
  return [...new Map(tags.map((t) => [t.id, t])).values()]
}
function card(id, name, author, count, pic) {
  return {
    id: String(id),
    name,
    author,
    count: count == null ? '' : String(count),
    pic: pic?.replace(/^http:/, 'https:'),
  }
}
export async function popular(platform, tag, page, keyword = '') {
  if (
    typeof tag !== 'string' ||
    tag.length > 64 ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > 100
  )
    throw Error('无效的歌单分类或页码')
  if (typeof keyword !== 'string' || keyword.length > 160) throw Error('歌单搜索词过长')
  if (keyword) {
    const word = encode(keyword)
    if (platform === 'wy') {
      const data = await read(
        'https://music.163.com/api/search/get?type=1000&limit=24&offset=' +
          (page - 1) * 24 +
          '&s=' +
          word,
      )
      return (data.result?.playlists ?? []).map((t) =>
        card(t.id, t.name, t.creator?.nickname, t.playCount, t.coverImgUrl),
      )
    }
    if (platform === 'tx') {
      const data = await read(
        'https://c.y.qq.com/soso/fcgi-bin/client_music_search_songlist?format=json&remoteplace=txt.yqq.playlist&inCharset=utf8&outCharset=utf-8&num_per_page=24&page_no=' +
          (page - 1) +
          '&query=' +
          word,
      )
      return (data.data?.list ?? []).map((t) =>
        card(t.dissid, t.dissname.replace(/<[^>]+>/g, ''), t.creator?.name, t.listennum, t.imgurl),
      )
    }
    if (platform === 'kg') {
      const data = await read(
        'http://msearchretry.kugou.com/api/v3/search/special?showtype=10&filter=0&version=7910&sver=2&pagesize=24&page=' +
          page +
          '&keyword=' +
          word,
      )
      return (data.data?.info ?? []).map((t) =>
        card(
          t.specialid,
          t.specialname,
          t.nickname,
          t.playcount,
          t.imgurl?.replace('{size}', '240'),
        ),
      )
    }
  }
  if (platform === 'wy') {
    const data = await read(
      'https://music.163.com/api/playlist/list?order=hot&limit=24&offset=' +
        (page - 1) * 24 +
        '&cat=' +
        encode(tag || '全部'),
    )
    return data.playlists.map((t) =>
      card(t.id, t.name, t.creator?.nickname, t.playCount, t.coverImgUrl),
    )
  }
  if (tag && !/^\d+$/.test(tag)) throw Error('歌单分类无效')
  if (platform === 'tx') {
    const id = Number(tag || 3)
    const data = await qq('playlist.PlayListCategoryServer', 'get_category_content', {
      titleid: id,
      category_id: id,
      caller: '0',
      size: 24,
      page: page - 1,
      use_page: 1,
    })
    return data.content.v_item.map(({ basic: t }) =>
      card(
        t.tid,
        t.title,
        t.creator?.nick,
        t.play_cnt,
        t.cover?.medium_url || t.cover?.default_url,
      ),
    )
  }
  if (platform === 'kg') {
    const data = await read(kgBase + 'getSpecial?is_ajax=1&cdn=cdn&t=6&c=' + tag + '&p=' + page)
    return data.special_db.map((t) =>
      card(t.specialid, t.specialname, t.nickname, t.total_play_count, t.img),
    )
  }
  throw Error('未知歌单平台')
}
export async function publicSongs(platform, id) {
  if (typeof id !== 'string' || !/^\d{1,18}$/.test(id)) throw Error('歌单编号无效')
  if (platform === 'wy') {
    const { playlist } = await read('https://music.163.com/api/v6/playlist/detail?n=1000&id=' + id)
    const songs = new Map(playlist.tracks.map((t) => [t.id, t]))
    const missing = playlist.trackIds.filter((t) => !songs.has(t.id))
    for (let i = 0; i < missing.length; i += 150) {
      const ids = missing.slice(i, i + 150).map(({ id }) => ({ id }))
      const more = await read(
        'https://music.163.com/api/v3/song/detail?c=' + encode(JSON.stringify(ids)),
      )
      for (const t of more.songs) songs.set(t.id, t)
    }
    return playlist.trackIds.flatMap(({ id }) => {
      const t = songs.get(id)
      return t
        ? [
            {
              source: 'wy',
              name: t.name,
              singer: t.ar.map((a) => a.name).join('/'),
              albumName: t.al.name,
              picUrl: t.al.picUrl,
              id: String(t.id),
              songmid: String(t.id),
              catalogCoverId: String(t.id),
              durationSeconds: t.dt / 1000,
            },
          ]
        : []
    })
  }
  if (platform === 'tx') {
    const request = (start) =>
      qq('music.srfDissInfo.aiDissInfo', 'uniform_get_Dissinfo', {
        disstid: Number(id),
        song_begin: start,
        song_num: 250,
        orderlist: 1,
        userinfo: 1,
        onlysonglist: 0,
        tag: 1,
      })
    const first = await request(0)
    const songs = [...first.songlist]
    for (let i = songs.length; i < first.total_song_num && i > 0; ) {
      const { songlist } = await request(i)
      if (!songlist.length) break
      songs.push(...songlist)
      i += songlist.length
    }
    return songs.map(qqSong).filter(Boolean)
  }
  if (platform === 'kg') {
    const html = await read(kgBase + 'single/' + id + '-5-9999.html', false)
    const data = html.match(/global\.data\s*=\s*(\[[\s\S]*?\]);/)
    if (!data) throw Error('酷狗未返回公开曲目')
    return JSON.parse(data[1])
      .map((t) =>
        kgSong({
          FileHash: t.hash,
          SongName: t.songname,
          SingerName: t.singername,
          AlbumName: t.album_name,
          AlbumID: t.album_id,
          Audioid: t.audio_id,
          MixSongID: t.album_audio_id,
          Duration: t.duration / 1000,
          FileSize: t.filesize,
          HQFileSize: t.filesize_320,
          HQFileHash: t.hash_320,
          SQFileSize: t.filesize_flac,
          SQFileHash: t.hash_flac,
          Image: t.trans_param?.union_cover?.replace(/^http:/, 'https:'),
        }),
      )
      .filter(Boolean)
  }
  throw Error('未知歌单平台')
}
