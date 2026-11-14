import { ArtistLinks, hasArtist } from './SongCredits'
import { CollectedSongRow } from './CollectedSongRow'
import { BackButton } from './BackButton'
import { ArtistSongs } from './ArtistSongs'
import { ArtistPortrait } from './ArtistPortrait'
import { Button } from '@fluentui/react-components'
import { Cover } from './AlbumBrowser'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PlaylistTrack, LocalTrack } from './LibraryPane'
import {
  FollowButton,
  SimilarArtists,
  Highlights,
  NewsTracks,
  type News,
  type ReleaseActions,
} from './ReleaseCatalog'
const norm = (s: string) => s.normalize('NFKC').trim().toLowerCase()
export const knownAlbum = (album: string) =>
  !!album.trim() && !['—', '-', '未知专辑', 'unknown album'].includes(norm(album))
export const albumArtist = (t: PlaylistTrack) =>
  (t.origin !== 'online' && t.albumArtist) || t.artist
export type CatalogLocation = {
  kind: 'artist' | 'album'
  name: string
  artist: string
  artistId?: string
  fromSong?: string
  group?: News
}
export function useCatalogNavigation(scope?: string) {
  const [priorScope, setPriorScope] = useState(scope)
  const [locations, setLocations] = useState<CatalogLocation[]>([])
  const layout = useRef<HTMLElement>(null)
  const scrollPositions = useRef<number[]>([])
  const restoreTop = useRef<number | null>(null)
  if (scope !== priorScope) {
    setPriorScope(scope)
    setLocations([])
    scrollPositions.current = []
    restoreTop.current = null
  }
  function openCatalog(location: CatalogLocation) {
    scrollPositions.current.push(layout.current?.closest('.music-scroll')?.scrollTop ?? 0)
    restoreTop.current = 0
    setLocations((stack) => [...stack, location])
  }
  function closeCatalog() {
    scrollPositions.current = []
    restoreTop.current = 0
    setLocations([])
  }
  function catalogBack() {
    restoreTop.current = scrollPositions.current.pop() ?? 0
    setLocations((stack) => stack.slice(0, -1))
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: restore the visible route before paint.
  useLayoutEffect(() => {
    if (restoreTop.current !== null)
      layout.current?.closest('.music-scroll')?.scrollTo(0, restoreTop.current)
    restoreTop.current = null
  }, [locations])
  return { locations, layout, openCatalog, catalogBack, closeCatalog }
}
type Props = {
  location: CatalogLocation
  local: LocalTrack[]
  songs: PlaylistTrack[]
  play: (id: string, ids: string[]) => void
  actions: Pick<ReleaseActions, 'play'>
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
  const [followed, setFollowed] = useState<
    Awaited<ReturnType<typeof window.music.followedArtists>>
  >([])
  const [pending, setPending] = useState(false)
  const [followError, setFollowError] = useState('')
  const [similar, setSimilar] = useState('')
  useEffect(() => {
    let live = true,
      changed = false
    const update = (e: Event) => {
      changed = true
      setFollowed((e as CustomEvent<typeof followed>).detail)
    }
    window.addEventListener('music-followed-artists', update)
    void window.music
      .followedArtists()
      .then((list) => {
        if (live && !changed) setFollowed(list)
      })
      .catch(() => {})
    return () => {
      live = false
      window.removeEventListener('music-followed-artists', update)
    }
  }, [])
  async function follow(id: string, on: boolean) {
    setFollowError('')
    setPending(true)
    try {
      const list = await window.music.followArtist(id, on)
      window.dispatchEvent(new CustomEvent('music-followed-artists', { detail: list }))
    } catch (e) {
      setFollowError(String(e).split('Error: ').at(-1) || '未能更新关注')
    } finally {
      setPending(false)
    }
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry reruns the selected lookup.
  useEffect(() => {
    if (!artistPage) return
    let live = true
    setStatus('')
    setRemote(undefined)
    setArtists([])
    setChosen(location.artistId ?? '')
    if (location.artistId) return
    const lookup = async () => {
      const fromTrack = location.fromSong
        ? await window.music.trackArtists(location.fromSong, location.name)
        : []
      return fromTrack.length
        ? fromTrack
        : (await window.music.findArtists(location.name)).filter((a) =>
            [a.name, ...(a.aliases ?? [])].some((value) => norm(value) === norm(location.name)),
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
  }, [artistPage, location.name, location.fromSong, location.artistId, retry])
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry reloads the known artist.
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
  }, [chosen, retry])
  const localSongs = local.filter(
    (t) =>
      t.listed &&
      (artistPage
        ? hasArtist(t, location.artist, location.artistId || chosen)
        : [location.artist, location.group?.artist ?? location.artist].some(
            (a) => norm(albumArtist(t)) === norm(a),
          ) && norm(t.album) === norm(location.name)),
  )
  const collected: PlaylistTrack[] = [...localSongs]
  for (const song of songs) {
    if (
      song.origin !== 'online' ||
      !(artistPage
        ? hasArtist(song, location.artist, location.artistId || chosen)
        : norm(song.album) === norm(location.name) && norm(song.artist) === norm(location.artist))
    )
      continue
    if (!collected.some((t) => t.id === song.id || t.id === song.localCopy)) {
      const copy = song.localCopy && local.find((t) => t.available && t.id === song.localCopy)
      collected.push(copy || song)
    }
  }
  const covers = new Map<string, string>()
  const albums = new Map<string, CatalogLocation>()
  for (const song of collected)
    if (knownAlbum(song.album)) {
      const a = albumArtist(song),
        key = JSON.stringify([norm(a), norm(song.album)])
      if (song.origin !== 'online' && song.available && !covers.has(key)) covers.set(key, song.id)
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
    <section
      className="library-catalog-home"
      data-artist={artistPage}
      aria-label={artistPage ? '歌手主页' : '专辑主页'}
    >
      <BackButton onClick={back} />
      <header>
        {artistPage && <ArtistPortrait id={chosen} />}
        <small>{artistPage ? '歌手' : '专辑'}</small>
        <h2>{location.name}</h2>
        {!artistPage && (
          <>
            <Cover id={localSongs.find((s) => s.available)?.id} group={location.group?.id} track />
            <p>
              <ArtistLinks
                song={{
                  title: location.name,
                  artist: location.artist,
                  artistCredits: location.group?.artistCredits,
                }}
                open={open}
              />
            </p>
          </>
        )}
        {artistPage && (
          <div className="artist-home-actions">
            <FollowButton
              artist={{ id: chosen, name: location.name, detail: '' }}
              following={followed.some((a) => a.id === chosen)}
              disabled={!chosen || pending}
              toggle={follow}
            />
            <Button
              size="small"
              disabled={!chosen}
              aria-expanded={!!chosen && similar === chosen}
              onClick={() => setSimilar(similar === chosen ? '' : chosen)}
            >
              查找相似歌手
            </Button>
          </div>
        )}
        {followError && <small role="alert">{followError}</small>}
      </header>
      {artistPage && chosen && similar === chosen && (
        <SimilarArtists
          seed={{ id: chosen, name: location.name, detail: '' }}
          followed={followed}
          busy={pending}
          follow={follow}
          play={actions.play}
          openArtist={(artist) =>
            open({ kind: 'artist', name: artist.name, artist: artist.name, artistId: artist.id })
          }
        />
      )}
      <div className="catalog-columns">
        <div className="catalog-songs">
          {artistPage && !!collected.length && <h3>曲库已收录</h3>}
          {!!collected.length && (
            <>
              {!artistPage && <h3>已收录曲目</h3>}
              <ol>
                {collected.map((song) => (
                  <CollectedSongRow
                    key={song.id}
                    song={song}
                    play={() => play(song.id, ids)}
                    open={open}
                  />
                ))}
              </ol>
            </>
          )}
          {artistPage && (
            <>
              {chosen && (
                <div key={chosen}>
                  <h3>代表作</h3>
                  <Highlights id={chosen} play={actions.play} collected={collected} />
                  <ArtistSongs id={chosen} play={actions.play} />
                </div>
              )}
              {!chosen && !collected.length && remote?.length === 0 && (
                <small>暂无歌曲资料。</small>
              )}
            </>
          )}
        </div>
        <div className="catalog-releases">
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
                  className="catalog-text-link catalog-release-link"
                  key={r.id}
                  onClick={() =>
                    open({ kind: 'album', name: r.title, artist: location.artist, group: r })
                  }
                >
                  <Cover id={covers.get(JSON.stringify([norm(r.artist), norm(r.title)]))} track />
                  <span>
                    {r.title}
                    <small>
                      {r.artist} · {r.date} · {r.type}
                    </small>
                  </span>
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
        </div>
      </div>
    </section>
  )
}
