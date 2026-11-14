import { Button } from '@fluentui/react-components'
import { ArrowLeft, Play } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatTime, type PlaylistTrack, type LocalTrack } from './LibraryPane'
import { NewsTracks, type News, type ReleaseActions } from './ReleaseCatalog'
const norm = (s: string) => s.normalize('NFKC').trim().toLowerCase()
export const knownAlbum = (album: string) =>
  !!album.trim() && !['—', '-', '未知专辑', 'unknown album'].includes(norm(album))
export const albumArtist = (t: PlaylistTrack) =>
  (t.origin !== 'online' && t.albumArtist) || t.artist
export type CatalogLocation = {
  kind: 'artist' | 'album'
  name: string
  artist: string
  fromSong?: string
  group?: News
}
type Props = {
  location: CatalogLocation
  local: LocalTrack[]
  songs: PlaylistTrack[]
  play: (id: string, ids: string[]) => void
  actions: ReleaseActions
  back(): void
  open(v: CatalogLocation): void
}
export function LibraryCatalogPage({ location, local, songs, play, actions, back, open }: Props) {
  const artistPage = location.kind === 'artist'
  const [artists, setArtists] = useState<Awaited<ReturnType<typeof window.music.findArtists>>>([])
  const [chosen, setChosen] = useState('')
  const [remote, setRemote] = useState<News[]>()
  const [status, setStatus] = useState('')
  const [retry, setRetry] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry reruns the selected lookup.
  useEffect(() => {
    if (!artistPage) return
    let live = true
    setStatus('')
    setRemote(undefined)
    setArtists([])
    setChosen('')
    const lookup = async () => {
      const fromTrack = location.fromSong
        ? await window.music.trackArtists(location.fromSong, location.name)
        : []
      return fromTrack.length
        ? fromTrack
        : (await window.music.findArtists(location.name)).filter(
            (a) => norm(a.name) === norm(location.name),
          )
    }
    void lookup()
      .then((found) => {
        if (!live) return
        setArtists(found)
        if (found.length === 1) setChosen(found[0].id)
        if (!found.length) setRemote([])
      })
      .catch((e) => {
        if (live) setStatus(String(e).split('Error: ').at(-1) ?? '目录暂不可用')
      })
    return () => {
      live = false
    }
  }, [artistPage, location.name, location.fromSong, retry])
  useEffect(() => {
    if (!chosen) return
    let live = true
    setStatus('')
    setRemote(undefined)
    void window.music
      .artistReleases(chosen)
      .then((rows) => {
        if (live) setRemote(rows)
      })
      .catch((e) => {
        if (live) setStatus(String(e).split('Error: ').at(-1) ?? '目录暂不可用')
      })
    return () => {
      live = false
    }
  }, [chosen])
  const localSongs = local.filter(
    (t) =>
      t.listed &&
      (artistPage
        ? norm(t.artist) === norm(location.artist)
        : [location.artist, location.group?.artist ?? location.artist].some(
            (a) => norm(albumArtist(t)) === norm(a),
          ) && norm(t.album) === norm(location.name)),
  )
  const collected: PlaylistTrack[] = [...localSongs]
  for (const song of songs) {
    if (
      song.origin !== 'online' ||
      !(artistPage
        ? norm(song.artist) === norm(location.artist)
        : norm(song.album) === norm(location.name) && norm(song.artist) === norm(location.artist))
    )
      continue
    if (!collected.some((t) => t.id === song.id || t.id === song.localCopy)) {
      const copy = song.localCopy && local.find((t) => t.available && t.id === song.localCopy)
      collected.push(copy || song)
    }
  }
  const albums = new Map<string, CatalogLocation>()
  for (const song of collected)
    if (knownAlbum(song.album)) {
      const a = albumArtist(song),
        key = JSON.stringify([norm(a), norm(song.album)])
      albums.set(key, { kind: 'album', name: song.album, artist: a })
    }
  const ids = collected.filter((r) => r.available).map((r) => r.id)
  const group = location.group ?? {
    id: '',
    title: location.name,
    artist: location.artist,
    type: '专辑',
    date: '',
  }
  return (
    <section className="library-catalog-home" aria-label={artistPage ? '歌手主页' : '专辑主页'}>
      <Button size="small" appearance="subtle" icon={<ArrowLeft size={16} />} onClick={back}>
        返回
      </Button>
      <header>
        <small>{artistPage ? '歌手' : '专辑'}</small>
        <h2>{location.name}</h2>
        {!artistPage && <p>{location.artist}</p>}
      </header>
      {!!collected.length && (
        <>
          <h3>{artistPage ? '歌曲' : '已收录曲目'}</h3>
          <ol>
            {collected.map((song) => (
              <li key={song.id}>
                <Button
                  size="small"
                  appearance="subtle"
                  icon={<Play size={15} />}
                  aria-label={'播放' + song.title}
                  disabled={!song.available}
                  onClick={() => play(song.id, ids)}
                />
                <div>
                  <strong>{song.title}</strong>
                  <small>{song.artist}</small>
                </div>
                <small>
                  {song.origin === 'online' && !song.localCopy ? '在线' : '本地'} ·{' '}
                  {formatTime(song.duration)}
                </small>
              </li>
            ))}
          </ol>
        </>
      )}
      {artistPage ? (
        <>
          <h3>专辑与发行</h3>
          {[...albums.values()].map((a) => (
            <button
              type="button"
              className="catalog-text-link"
              key={JSON.stringify(a)}
              onClick={() => open(a)}
            >
              {a.name} <small>{a.artist} · 已收录</small>
            </button>
          ))}
          {artists.length > 1 && (
            <div>
              <small>选择目录中的同名歌手</small>
              {artists.map((a) => (
                <Button
                  key={a.id}
                  size="small"
                  aria-pressed={chosen === a.id}
                  onClick={() => setChosen(a.id)}
                >
                  {a.name} · {a.detail || a.id}
                </Button>
              ))}
            </div>
          )}
          {status ? (
            <p role="alert">
              {status}{' '}
              <Button size="small" onClick={() => setRetry((n) => n + 1)}>
                重试
              </Button>
            </p>
          ) : !remote && (chosen || artists.length < 2) ? (
            <small role="status">正在读取发行目录…</small>
          ) : (
            remote?.length === 0 && !albums.size && <p>暂无发行资料。</p>
          )}
          {remote?.map((r) => (
            <button
              type="button"
              className="catalog-text-link"
              key={r.id}
              onClick={() =>
                open({ kind: 'album', name: r.title, artist: location.artist, group: r })
              }
            >
              {r.title}{' '}
              <small>
                {r.artist} · {r.date} · {r.type}
              </small>
            </button>
          ))}
        </>
      ) : (
        <>
          <h3>发行曲目</h3>
          <NewsTracks
            group={group}
            aliases={
              location.group && norm(location.group.artist) !== norm(location.artist)
                ? [location.artist]
                : []
            }
            named={!location.group}
            local={localSongs}
            playLocal={play}
            play={actions.play}
          />
        </>
      )}
    </section>
  )
}
