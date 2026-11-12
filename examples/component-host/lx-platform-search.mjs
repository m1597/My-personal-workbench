import { setTimeout as delay } from 'node:timers/promises'
import { sourceRequest } from './lx-net.mjs'

const names = { tx: 'QQ 音乐', kg: '酷狗音乐' }
export class CatalogUnavailable extends Error {}
const labels = ['128k', '320k', 'flac', 'flac24bit']
function types(sizes, hashes) {
  const list = []
  for (const [i, type] of labels.entries()) {
    if (!(sizes[i] > 0) || (hashes && !hashes[i])) continue
    const detail = { size: (sizes[i] / 1048576).toFixed(2) + ' MB' }
    if (hashes) detail.hash = hashes[i]
    list.push({ type, ...detail })
  }
  return { types: list, _types: Object.fromEntries(list.map(({ type, ...info }) => [type, info])) }
}
function interval(seconds) {
  return Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0')
}
function qqSong(s) {
  if (!s.mid || !s.file?.media_mid) return null
  const f = s.file
  return {
    source: 'tx',
    name: s.title || s.name,
    singer: s.singer?.map((a) => a.name).join('、'),
    songmid: s.mid,
    songId: s.id,
    strMediaMid: f.media_mid,
    albumId: s.album?.mid,
    albumMid: s.album?.mid,
    albumName: s.album?.name,
    interval: interval(s.interval),
    durationSeconds: Number(s.interval),
    typeUrl: {},
    ...types([f.size_128mp3, f.size_320mp3, f.size_flac, f.size_hires]),
  }
}
function kgSong(s) {
  if (!s.FileHash) return null
  return {
    source: 'kg',
    name: [s.OriSongName || s.SongName, s.Suffix].filter(Boolean).join(' '),
    singer: s.Singers?.map((a) => a.name).join('、') || s.SingerName,
    albumName: s.AlbumName,
    songmid: s.Audioid,
    albumAudioId: s.MixSongID,
    albumId: s.AlbumID,
    hash: s.FileHash,
    interval: interval(s.Duration),
    durationSeconds: Number(s.Duration),
    _interval: s.Duration,
    typeUrl: {},
    ...types(
      [s.FileSize, s.HQFileSize, s.SQFileSize, s.ResFileSize],
      [s.FileHash, s.HQFileHash, s.SQFileHash, s.ResFileHash],
    ),
  }
}
export async function platformSearch(
  platform,
  keyword,
  page,
  limit,
  signal,
  request = sourceRequest,
) {
  const pageSize = platform === 'tx' ? Math.min(limit, 20) : limit
  let url
  if (platform === 'tx') {
    url = new URL('https://u.y.qq.com/cgi-bin/musicu.fcg')
    url.searchParams.set(
      'data',
      JSON.stringify({
        comm: { ct: 19, cv: 2151 },
        req: {
          module: 'music.search.SearchCgiService',
          method: 'DoSearchForQQMusicDesktop',
          param: { query: keyword, page_num: page, num_per_page: pageSize, search_type: 0, grp: 1 },
        },
      }),
    )
  } else {
    url = new URL('https://songsearch.kugou.com/song_search_v2')
    url.search = new URLSearchParams({
      platform: 'AndroidFilter',
      iscorrection: '1',
      hifiquality: '0',
      keyword,
      page: String(page),
      pagesize: String(limit),
    }).toString()
  }
  const name = names[platform]
  let response
  try {
    response = await request(url.href, { signal })
    if (platform === 'tx' && response.statusCode === 200 && response.body?.req?.code === 2001) {
      await delay(1200, undefined, { signal })
      response = await request(url.href, { signal })
    }
  } catch {
    signal.throwIfAborted()
    throw new CatalogUnavailable(name + '目录连接失败，请稍后重试')
  }
  const b = response.body
  if (response.statusCode !== 200)
    throw new CatalogUnavailable(name + '目录请求失败（HTTP ' + response.statusCode + '）')
  if (platform === 'tx' && Number.isInteger(b?.req?.code) && b.req.code !== 0)
    throw new CatalogUnavailable(name + '目录暂时无法返回搜索结果（业务码 ' + b.req.code + '）')
  const data = platform === 'tx' ? b?.req?.data : b?.data
  const songs = platform === 'tx' ? data?.body?.song?.list : data?.lists
  if (
    !Array.isArray(songs) ||
    (platform === 'tx' ? b.code !== 0 || b.req.code !== 0 : b.error_code !== 0)
  )
    throw new CatalogUnavailable(name + '目录暂时无法返回搜索结果')
  const items =
    platform === 'tx'
      ? songs.map(qqSong)
      : songs.flatMap((s) => [s, ...(Array.isArray(s.Grp) ? s.Grp : [])]).map(kgSong)
  const total = platform === 'tx' ? data.meta?.sum : data.total
  return {
    items: items.filter(Boolean),
    hasMore: songs.length >= pageSize && (!Number.isFinite(total) || page * pageSize < total),
  }
}
