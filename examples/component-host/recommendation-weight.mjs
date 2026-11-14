export const douyinChartUrl =
  'https://aweme.snssdk.com/aweme/v1/chart/music/list/?device_platform=android&version_name=13.2.0&version_code=130200&aid=1128&chart_id=6853972723954146568&count=100'

export function wantsDouyinChart(text) {
  return /抖音.{0,12}(?:热门|熱[門歌]|热[歌榜度]|流行|爆[火款]|排行)|(?:热门|热歌|流行).{0,8}抖音/u.test(
    text,
  )
}

export async function readDouyinChart(signal) {
  try {
    const response = await fetch(douyinChartUrl, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
      headers: { 'user-agent': 'okhttp3' },
      redirect: 'error',
    })
    if (!response.ok) throw Error()
    const data = await response.json()
    const age = Date.now() - Date.parse(data.release_date + 'T00:00:00+08:00')
    if (data.status_code !== 0 || !Number.isFinite(age) || age < 0 || age > 7 * 86400000)
      throw Error()
    const songs = data.music_list.flatMap(({ music_info: music, heat }, index) => {
      if (!music?.title?.trim() || !music.author?.trim() || !Number.isFinite(heat)) return []
      return [
        {
          title: music.title.trim(),
          artist: music.author.trim(),
          rank: index + 1,
          reason: `抖音音乐榜 · ${data.release_date} 第 ${index + 1} 名 · 热度 ${heat}`,
        },
      ]
    })
    if (!songs.length) throw Error()
    return { date: data.release_date, songs }
  } catch {
    signal.throwIfAborted()
    return { date: '', songs: [] }
  }
}

export function fitScore(song, weight) {
  // Verified availability makes an otherwise equally relevant chart entry actionable.
  const requestFit = (song.requestFit ?? 50) + (song.verifiedSave ? 25 : 0)
  return weight * requestFit + (100 - weight) * (song.tasteFit ?? 50)
}
