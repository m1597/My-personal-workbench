import { useMusicFeedback } from './musicFeedback'
import { artistsOf, SongCredits, type ArtistCredit } from './SongCredits'
import { OnlineSongRow, RowPlay } from './OnlineSongRow'
import { ArtistPortrait } from './ArtistPortrait'
import { guardSearchEnter } from './searchSubmit'
import { Sparkles } from 'lucide-react'
import { Button, Dropdown, Option, Input } from '@fluentui/react-components'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { LibraryCatalogPage, useCatalogNavigation } from './LibraryCatalogPage'
import type { LocalTrack, PlaylistTrack } from './LibraryPane'
import { Cover, type Album } from './AlbumBrowser'
import type { SongAPI } from './SongDetails'
import './release-catalog.css'

type Artist = { id: string; name: string; detail: string; aliases?: string[] }
type Edition = { id: string; title: string; artist: string; detail: string }
const labelEdition = (c: Edition) => [c.title, c.artist, c.detail].filter(Boolean).join(' · ')
type ReleaseTrack = {
  artistCredits?: ArtistCredit[]
  position: number | null
  disc: number
  number: string
  title: string
  artist: string
}
export type News = {
  editionId?: string
  artistCredits?: ArtistCredit[]
  type: string
  id: string
  title: string
  artist: string
  date: string
}
export interface ReleaseAPI extends SongAPI {
  aiCatalogQuery(kind: 'artists' | 'publicLists', description: string): Promise<string>
  findArtists(term: string): Promise<Artist[]>
  similarArtists(id: string): Promise<Artist[]>
  artistHighlights(id: string): Promise<Pick<ReleaseTrack, 'artist' | 'title' | 'artistCredits'>[]>
  artistSongs(
    id: string,
    offset: number,
  ): Promise<{
    total: number
    next: number | null
    notice?: string
    songs: {
      id: string
      title: string
      artist: string
      artistCredits?: ArtistCredit[]
      version: string
    }[]
  }>
  followedArtists(): Promise<Artist[]>
  followArtist(id: string, on: boolean): Promise<Artist[]>
  releaseNews(refresh?: boolean): Promise<News[]>
  releaseCover(id: string, edition?: boolean): Promise<string | null>
  artistPortrait(id: string): Promise<string | null>
  artistReleases(id: string): Promise<News[]>
  newsEditions(id: string): Promise<Edition[]>
  trackArtists(title: string, artist: string): Promise<Artist[]>
  namedEditions(title: string, artist: string): Promise<Edition[]>
  albumEditions(id: string): Promise<Edition[]>
  editionTracks(id: string): Promise<ReleaseTrack[]>
}
const message = (error: unknown) => String(error).split('Error: ').at(-1) || '读取发行资料失败'
type PlayRecording = (key: string) => Promise<void>
export interface ReleaseActions {
  play: PlayRecording
  add: (playlist: string, key: string) => Promise<boolean>
  playlists: { id: string; name: string }[]
}
export async function matchTrack(
  track: Pick<ReleaseTrack, 'title' | 'artist'>,
  album = '',
  requireAlbum = false,
) {
  const artists = artistsOf(track).map((a) => normalize(a.name))
  const result = await window.music.lxSearch({ title: track.title, artist: artists[0] ?? '' })
  const matches = result.items.filter(
    (item) =>
      normalize(item.title) === normalize(track.title) &&
      (!artists.length || artistsOf(item).some((a) => artists.includes(normalize(a.name)))) &&
      (item.quality === undefined || item.quality.length > 0),
  )
  const recording =
    matches.find((item) => normalize(item.album) === normalize(album)) ??
    (requireAlbum ? undefined : matches[0])
  if (!recording) throw Error('未找到这首歌的可播放版本')
  return recording
}
function MissingTrack({
  track,
  album,
  onSearch,
  onBusyChange,
  disabled,
  active,
}: {
  active: boolean
  onSearch: () => void
  onBusyChange: (busy: boolean) => void
  disabled: boolean
  track: ReleaseTrack
  album: string
}) {
  const feedback = useMusicFeedback()
  const [recording, setRecording] = useState<Awaited<ReturnType<typeof matchTrack>>>()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  async function run(action: () => Promise<void>) {
    setBusy(true)
    onBusyChange(true)
    setStatus('')
    try {
      await action()
    } catch (e) {
      setStatus(feedback.error(e))
    } finally {
      setBusy(false)
      onBusyChange(false)
    }
  }
  return (
    <div className="missing-track-actions">
      {recording && active ? (
        <>
          <small>
            {[recording.title, recording.artist, recording.album].filter(Boolean).join(' · ')}
          </small>
        </>
      ) : (
        <Button
          size="small"
          disabled={busy || disabled}
          onClick={() => {
            onSearch()
            void run(async () => setRecording(await matchTrack(track, album)))
          }}
        >
          {busy ? '正在查找…' : '搜索缺曲'}
        </Button>
      )}
      {active && status && <small role="status">{status}</small>}
    </div>
  )
}
async function downloadRecording(recording: Awaited<ReturnType<typeof matchTrack>>) {
  const prefs = (await window.music.state()).prefs
  const quality =
    recording.quality === undefined || recording.quality.includes(prefs.quality)
      ? prefs.quality
      : recording.quality[0]
  if (!quality) throw Error('该录音没有可下载音质')
  return window.music.lxDownload(recording.key, quality, true)
}
export function NewsTracks({
  group,
  play,
  local = [],
  playLocal,
  named = false,
  aliases = [],
  onEdition,
}: {
  group: News
  play: PlayRecording
  local?: LocalTrack[]
  playLocal?: (id: string, ids: string[]) => void
  named?: boolean
  aliases?: string[]
  onEdition?: (id: string) => void
}) {
  const [pending, setPending] = useState('')
  const [playError, setPlayError] = useState('')
  const [matched, setMatched] = useState(new Map<ReleaseTrack, string>())
  const attempt = useRef(0)
  const [editions, setEditions] = useState<Edition[]>([])
  const [selected, setSelected] = useState('')
  const [tracks, setTracks] = useState<ReleaseTrack[]>()
  const [error, setError] = useState('')
  const [editionRetry, setEditionRetry] = useState(0)
  const [trackRetry, setTrackRetry] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry starts a fresh request after a failed lookup.
  useEffect(() => {
    let active = true
    setError('')
    const normalized = (s: string) => s.normalize('NFKC').trim().toLowerCase()
    const list = named
      ? window.music
          .namedEditions(group.title, group.artist)
          .then((rows) =>
            rows.filter(
              (r) =>
                normalized(r.title) === normalized(group.title) &&
                normalized(r.artist) === normalized(group.artist),
            ),
          )
      : window.music.newsEditions(group.id)
    void list
      .then((list) => {
        if (!active) return
        setEditions(list)
        setSelected(
          list.find((r) => r.id === group.editionId)?.id ??
            (named && list.length > 1 ? '' : (list[0]?.id ?? '')),
        )
        if (!list.length) setError('此发行暂无正式版本资料。')
      })
      .catch((e) => {
        if (active) setError(message(e))
      })
    return () => {
      active = false
    }
  }, [group.id, group.title, group.artist, group.editionId, named, editionRetry])
  useEffect(() => {
    if (selected) onEdition?.(selected)
  }, [selected, onEdition])
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry also reloads the currently selected edition.
  useEffect(() => {
    let active = true
    if (selected) {
      setTracks(undefined)
      setError('')
      void window.music
        .editionTracks(selected)
        .then((list) => {
          if (active) setTracks(list)
        })
        .catch((e) => {
          if (active) setError(message(e))
        })
    }
    return () => {
      active = false
    }
  }, [selected, trackRetry])
  // biome-ignore lint/correctness/useExhaustiveDependencies: changing edition invalidates pending playback lookup.
  useEffect(() => {
    setPending('')
    setPlayError('')
    return () => {
      attempt.current++
    }
  }, [selected])
  async function listen(
    track: ReleaseTrack,
    action: 'play' | 'download' | 'add' = 'play',
    list?: string,
  ) {
    const localId = collectedTracks(tracks ?? [], local, group.artist, aliases).get(track)
    if (localId && playLocal) {
      if (action === 'add' && list) {
        try {
          await window.music.setMembership(list, localId, true)
        } catch (e) {
          setPlayError(message(e))
        }
        return
      }
      if (action !== 'play') return
      playLocal(
        localId,
        local.filter((t) => t.available).map((t) => t.id),
      )
      return
    }
    const request = ++attempt.current
    setPending(track.disc + ':' + track.number)
    setPlayError('')
    try {
      let recording: Awaited<ReturnType<typeof matchTrack>>
      try {
        recording = await matchTrack(track, group.title, !!playLocal)
      } catch (e) {
        if (!aliases.length || normalize(track.artist) !== normalize(group.artist)) throw e
        recording = await matchTrack({ ...track, artist: aliases[0] }, group.title, !!playLocal)
      }
      if (attempt.current !== request) return
      if (action === 'play') {
        setMatched((m) => new Map(m).set(track, recording.onlineId))
        await play(recording.key)
      } else if (action === 'add' && list)
        await window.music.setMembership(
          list,
          await window.music.rememberOnline(recording.key),
          true,
        )
      else await downloadRecording(recording)
    } catch (e) {
      if (attempt.current === request) setPlayError(track.title + ' · ' + message(e))
    } finally {
      if (attempt.current === request) setPending('')
    }
  }
  const localMatches = collectedTracks(tracks ?? [], local, group.artist, aliases)
  return (
    <div className="release-track-picker">
      {editions.length > 1 && (
        <Dropdown
          inlinePopup
          aria-label={playLocal ? '发行版本' : '动态发行版本'}
          listbox={{ className: 'component-popup' }}
          value={editions.filter((e) => e.id === selected).map(labelEdition)[0] ?? ''}
          placeholder="选择发行版本"
          selectedOptions={selected ? [selected] : []}
          onOptionSelect={(_, d) => {
            if (d.optionValue) setSelected(d.optionValue)
          }}
        >
          {editions.map((e) => (
            <Option key={e.id} value={e.id} text={labelEdition(e)}>
              {labelEdition(e)}
            </Option>
          ))}
        </Dropdown>
      )}
      {error ? (
        <p role="alert">
          {error}{' '}
          <Button
            size="small"
            onClick={() => (selected ? setTrackRetry((n) => n + 1) : setEditionRetry((n) => n + 1))}
          >
            重试
          </Button>
        </p>
      ) : !tracks ? (
        <small role="status">
          {!selected && editions.length > 1 ? '请选择发行版本以查看曲目。' : '正在读取曲目…'}
        </small>
      ) : !tracks.length ? (
        <small>此版本暂无曲目资料。</small>
      ) : (
        <ol>
          {tracks.map((t) => (
            <OnlineSongRow
              key={[t.disc, t.number, t.title].join(':')}
              className="release-recording"
              busy={!!pending}
              localId={localMatches.get(t) || undefined}
              play={() => void listen(t)}
              download={() => void listen(t, 'download')}
              add={(list) => void listen(t, 'add', list)}
            >
              <RowPlay
                id={localMatches.get(t) || matched.get(t)}
                title={t.title}
                disabled={!!pending}
                play={() => void listen(t)}
              />
              <div className="catalog-song-text">
                <strong>
                  {t.disc}.{t.number} {t.title}
                </strong>
                <small>
                  <SongCredits song={t} />
                </small>
              </div>
            </OnlineSongRow>
          ))}
        </ol>
      )}
      {playError && <small role="alert">{playError}</small>}
    </div>
  )
}
export function CatalogSongRow({
  song,
  play,
  localId,
  playLocal,
  album,
  children,
  displayTitle,
  searching = false,
}: {
  displayTitle?: string
  searching?: boolean
  song: Pick<ReleaseTrack, 'artist' | 'title' | 'artistCredits'> & { version?: string }
  play: PlayRecording
  localId?: string
  playLocal?(): void
  album?: string
  children?: React.ReactNode
}) {
  const [error, setError] = useState('')
  const feedback = useMusicFeedback()
  const [pending, setPending] = useState(false)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  const [status, setStatus] = useState('')
  const [resolvedId, setResolvedId] = useState('')
  const [downloadedId, setDownloadedId] = useState('')
  async function perform(action: 'play' | 'download' | 'add', list?: string, name?: string) {
    setPending(true)
    setError('')
    setStatus('')
    try {
      if (localId) {
        if (action === 'play') playLocal?.()
        else if (action === 'add' && list) {
          const receipt = await window.music.setMembership(list, localId, true)
          setStatus(
            feedback.membership(
              name ?? '',
              Boolean(receipt && 'added' in receipt && receipt.added),
            ),
          )
        }
        return
      }
      const recording = await matchTrack(song, album)
      if (!live.current) return
      if (action === 'play') {
        setResolvedId(recording.onlineId)
        await play(recording.key)
      } else if (action === 'add' && list) {
        const reference = await window.music.rememberOnline(recording.key)
        const receipt = await window.music.setMembership(list, reference, true)
        setStatus(
          feedback.membership(name ?? '', Boolean(receipt && 'added' in receipt && receipt.added)),
        )
      } else {
        const saved = await downloadRecording(recording)
        if (saved) {
          setDownloadedId(saved.localId || '')
          setStatus(feedback.text('已下载并入库', 'Downloaded to library'))
        }
      }
    } catch (e) {
      if (live.current) setError(feedback.error(e))
    } finally {
      if (live.current) setPending(false)
    }
  }
  return (
    <OnlineSongRow
      localId={localId || downloadedId}
      className="highlight-recording"
      busy={pending || searching}
      play={() => void perform('play')}
      download={() => void perform('download')}
      add={(list, name) => void perform('add', list, name)}
    >
      <RowPlay
        id={localId || resolvedId}
        title={song.title}
        disabled={pending || searching}
        play={() => void perform('play')}
      />
      <div className="catalog-song-text">
        <strong className="catalog-song-title">{displayTitle || song.title}</strong>
        <small>
          <SongCredits song={song} />
        </small>
        {song.version && <small>{song.version}</small>}
        {children}
        <small>
          {status && <small role="status">{status}</small>}
          {error && <small role="alert">{error}</small>}
        </small>
      </div>
    </OnlineSongRow>
  )
}
export function Highlights({
  id,
  play,
  collected,
}: {
  id: string
  play: PlayRecording
  collected?: PlaylistTrack[]
}) {
  const [songs, setSongs] = useState<Pick<ReleaseTrack, 'artist' | 'title' | 'artistCredits'>[]>()
  const [error, setError] = useState('')
  const live = useRef(false)
  useEffect(() => {
    live.current = true
    void window.music
      .artistHighlights(id)
      .then((rows) => {
        if (live.current) setSongs(rows)
      })
      .catch((e) => {
        if (live.current) setError(message(e))
      })
    return () => {
      live.current = false
    }
  }, [id])
  const visible = songs?.filter(
    (s) =>
      !collected?.some(
        (r) =>
          r.available &&
          normalize(r.title) === normalize(s.title) &&
          normalize(r.artist) === normalize(s.artist),
      ),
  )
  return (
    <div>
      {error && <small role="alert">{error}</small>}
      {visible ? (
        visible.length ? (
          <ul>
            {visible.map((song) => (
              <CatalogSongRow key={song.title} song={song} play={play} />
            ))}
          </ul>
        ) : (
          !collected?.length && <small>暂无正式发行录音。</small>
        )
      ) : (
        !error && <small role="status">正在读取代表作…</small>
      )}
    </div>
  )
}
export function FollowButton({
  artist,
  following,
  disabled,
  toggle,
}: {
  artist: Artist
  following: boolean
  disabled: boolean
  toggle: (id: string, on: boolean) => void
}) {
  const feedback = useMusicFeedback()
  return (
    <Button
      size="small"
      className="artist-follow-button"
      disabled={disabled}
      aria-label={
        (following ? feedback.text('取消关注', 'Unfollow ') : feedback.text('关注', 'Follow ')) +
        artist.name
      }
      onClick={() => toggle(artist.id, !following)}
    >
      {following ? (
        <>
          <span className="follow-status">{feedback.text('已关注', 'Following')}</span>
          <span className="follow-cancel">{feedback.text('取消关注', 'Unfollow')}</span>
        </>
      ) : (
        feedback.text('关注', 'Follow')
      )}
    </Button>
  )
}
export function SimilarArtists({
  openArtist,
  seed,
  followed,
  busy,
  follow,
  play,
}: {
  openArtist: (artist: Artist) => void
  seed: Artist
  followed: Artist[]
  busy: boolean
  follow: (id: string, on: boolean) => void
  play: PlayRecording
}) {
  const [rows, setRows] = useState<Artist[]>()
  const [error, setError] = useState('')
  const [open, setOpen] = useState('')
  const [retry, setRetry] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry repeats the selected lookup.
  useEffect(() => {
    let live = true
    setError('')
    void window.music
      .similarArtists(seed.id)
      .then((list) => {
        if (live) setRows(list)
      })
      .catch((e) => {
        if (live) setError(message(e))
      })
    return () => {
      live = false
    }
  }, [seed.id, retry])
  return (
    <section className="similar-artists" aria-label="相似歌手">
      <h3>与{seed.name}相似的歌手</h3>
      {error ? (
        <small role="alert">
          {error}{' '}
          <Button size="small" onClick={() => setRetry((n) => n + 1)}>
            重试
          </Button>
        </small>
      ) : !rows ? (
        <small role="status">正在查找相似歌手…</small>
      ) : !rows.length ? (
        <small>风格标签资料不足，暂无可核实的相似歌手。</small>
      ) : (
        <ul>
          {rows.map((a) => (
            <li key={a.id} className="release-event">
              <div className="release-event-head">
                <ArtistPortrait id={a.id} />
                <div>
                  <button type="button" className="catalog-text-link" onClick={() => openArtist(a)}>
                    {a.name}
                  </button>
                  <small>{a.detail}</small>
                </div>
                <Button
                  size="small"
                  aria-expanded={open === a.id}
                  onClick={() => setOpen(open === a.id ? '' : a.id)}
                >
                  {open === a.id ? '收起代表作' : '代表作'}
                </Button>
                <FollowButton
                  artist={a}
                  following={followed.some((f) => f.id === a.id)}
                  disabled={busy}
                  toggle={follow}
                />
              </div>
              {open === a.id && <Highlights id={a.id} play={play} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
function ReleaseList({
  rows,
  play,
  albums,
  openAlbum,
}: {
  rows: News[]
  play: PlayRecording
  albums: Album[]
  openAlbum: (r: News) => void
}) {
  const [openGroup, setOpenGroup] = useState('')
  const [versions, setVersions] = useState<Record<string, string>>({})
  if (!rows.length) return null
  return (
    <ul>
      {rows.map((r) => (
        <li key={r.id} className="release-event">
          <div className="release-event-head">
            <Cover
              group={r.id}
              edition={versions[r.id] || r.editionId}
              id={
                albums.find(
                  (album) =>
                    normalize(album.title) === normalize(r.title) &&
                    normalize(album.artist) === normalize(r.artist),
                )?.id
              }
            />
            <div>
              <button
                className="catalog-text-link"
                type="button"
                onClick={() => openAlbum({ ...r, editionId: versions[r.id] || r.editionId })}
              >
                <strong>{r.title}</strong>
              </button>
              <small>
                {r.artist} · {r.date} · {r.type}
              </small>
            </div>
            <Button
              size="small"
              aria-expanded={openGroup === r.id}
              onClick={() => setOpenGroup(openGroup === r.id ? '' : r.id)}
            >
              {openGroup === r.id ? '收起曲目' : '查看曲目'}
            </Button>
          </div>
          {openGroup === r.id && (
            <NewsTracks
              group={r}
              play={play}
              onEdition={(id) => setVersions((v) => (v[r.id] === id ? v : { ...v, [r.id]: id }))}
            />
          )}
        </li>
      ))}
    </ul>
  )
}
export function ArtistReleases({
  play,
  local,
  songs,
  playCollected,
}: {
  play: PlayRecording
  local: LocalTrack[]
  songs: PlaylistTrack[]
  playCollected: (id: string, ids: string[]) => void
}) {
  const { locations, layout, openCatalog, catalogBack } = useCatalogNavigation()
  const [selected, setSelected] = useState<Artist>()
  function openArtist(artist: Artist) {
    openCatalog({ kind: 'artist', artist: artist.name, name: artist.name, artistId: artist.id })
  }
  const [albums, setAlbums] = useState<Album[]>([])
  useEffect(() => {
    let live = true
    void window.music
      .albums()
      .then((rows) => {
        if (live) setAlbums(rows)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  const [followed, setFollowed] = useState<Artist[]>([])
  const [query, setQuery] = useState('')
  const feedback = useMusicFeedback()
  const [aiSearch, setAiSearch] = useState(false)
  const [matches, setMatches] = useState<Artist[]>()
  const [news, setNews] = useState<News[]>()
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const newsVersion = useRef(0)
  const searchVersion = useRef(0)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const alive = useRef(true)
  async function act(fn: () => Promise<void>) {
    setBusy(true)
    setStatus('')
    try {
      await fn()
    } catch (error) {
      if (alive.current) setStatus(message(error))
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  async function load(list: Artist[], force = false) {
    if (!alive.current) return
    setFollowed(list)
    const version = ++newsVersion.current
    try {
      const data = list.length ? await window.music.releaseNews(force) : []
      if (alive.current && version === newsVersion.current) setNews(data)
    } catch (error) {
      if (alive.current && version === newsVersion.current) setStatus(message(error))
    }
  }
  const initialLoad = useEffectEvent(
    () => void act(async () => load(await window.music.followedArtists())),
  )
  useEffect(() => {
    alive.current = true
    initialLoad()
    return () => {
      alive.current = false
    }
  }, [])
  async function search() {
    const term = query.trim()
    if (!term || searching) return
    const request = ++searchVersion.current
    setSearching(true)
    setSearchError('')
    try {
      const keyword = aiSearch ? await window.music.aiCatalogQuery('artists', term) : term
      if (!alive.current || searchVersion.current !== request) return
      const found = await window.music.findArtists(keyword)
      if (alive.current && searchVersion.current === request) setMatches(found)
    } catch (error) {
      if (alive.current && searchVersion.current === request) setSearchError(message(error))
    } finally {
      if (alive.current && searchVersion.current === request) setSearching(false)
    }
  }
  const syncFollowed = useEffectEvent((event: Event) => {
    const list = (event as CustomEvent<Artist[]>).detail
    setNews(undefined)
    void load(list)
  })
  useEffect(() => {
    const update = (event: Event) => syncFollowed(event)
    window.addEventListener('music-followed-artists', update)
    return () => window.removeEventListener('music-followed-artists', update)
  }, [])
  function toggle(id: string, on: boolean) {
    void act(async () => {
      const list = await window.music.followArtist(id, on)
      window.dispatchEvent(new CustomEvent('music-followed-artists', { detail: list }))
      if (!on && selected?.id === id) setSelected(undefined)
    })
  }
  return (
    <>
      <section
        ref={layout}
        className="music-release-news"
        style={locations.length ? { display: 'none' } : undefined}
        aria-label="关注歌手的新发行"
      >
        <div className="release-news-column" data-empty={!busy && !status && !news?.length}>
          <header>
            <h2>关注歌手的新发行</h2>
            {!!followed.length && (
              <Button
                size="small"
                disabled={busy}
                onClick={() => void act(() => load(followed, true))}
              >
                刷新发行
              </Button>
            )}
          </header>
          {busy && <small role="status">正在读取发行资料…</small>}
          {status && <p role="alert">{feedback.error(status)}</p>}
          {!busy &&
            !status &&
            (!followed.length ? (
              <p>关注歌手后可在这里查看新发行。</p>
            ) : (
              news?.length === 0 && <p>近 90 天暂无新发行。</p>
            ))}
          <ReleaseList
            rows={news ?? []}
            albums={albums}
            play={play}
            openAlbum={(group) =>
              openCatalog({ kind: 'album', name: group.title, artist: group.artist, group })
            }
          />
        </div>
        <section className="followed-artists" aria-label="我关注的歌手">
          <header>
            <h2>我关注的歌手</h2>
          </header>
          <div className="artist-management">
            <form
              onKeyDownCapture={guardSearchEnter}
              onSubmit={(e) => {
                e.preventDefault()
                void search()
              }}
            >
              <Input
                aria-label="要关注的歌手"
                data-guide-anchor="artist"
                maxLength={160}
                value={query}
                placeholder={aiSearch ? '描述要查找的歌手' : '输入歌手名'}
                contentAfter={
                  <Button
                    type="button"
                    size="small"
                    appearance={aiSearch ? 'primary' : 'subtle'}
                    aria-label="AI 搜索歌手"
                    title="AI 搜索歌手"
                    aria-pressed={aiSearch}
                    icon={<Sparkles size={16} />}
                    onClick={() => {
                      searchVersion.current++
                      setAiSearch((v) => !v)
                      setSearchError('')
                      setMatches(undefined)
                      setSearching(false)
                    }}
                  />
                }
                onChange={(_, d) => {
                  searchVersion.current++
                  setQuery(d.value)
                  setSearchError('')
                  setSearching(false)
                  setMatches(undefined)
                }}
              />
              <Button size="small" type="submit" disabled={!query.trim() || searching}>
                查找歌手
              </Button>
            </form>
            {searchError && <small role="alert">{feedback.error(searchError)}</small>}
            {searching && <small role="status">正在查找歌手…</small>}
            {matches?.length === 0 && <small role="status">没有找到匹配的歌手</small>}
            {matches
              ?.filter((a) => !followed.some((f) => f.id === a.id))
              .map((a) => (
                <div className="artist-search-result" key={a.id}>
                  <span>
                    {a.name} <small>{a.detail}</small>
                  </span>
                  <FollowButton artist={a} following={false} disabled={busy} toggle={toggle} />
                </div>
              ))}
          </div>
          <div className="followed-artist-grid">
            {followed.map((artist) => (
              <div className="followed-artist-card" key={artist.id}>
                <button
                  className="artist-home-link"
                  type="button"
                  onClick={() => {
                    setSelected(artist)
                    openArtist(artist)
                  }}
                >
                  <ArtistPortrait id={artist.id} />
                  <span>{artist.name}</span>
                </button>
                <FollowButton artist={artist} following disabled={busy} toggle={toggle} />
                <Button
                  size="small"
                  appearance="subtle"
                  aria-label={'查找与' + artist.name + '相似的歌手'}
                  onClick={() => {
                    setSelected(artist)
                    requestAnimationFrame(() =>
                      layout.current
                        ?.querySelector('.similar-artists')
                        ?.scrollIntoView({ block: 'nearest' }),
                    )
                  }}
                >
                  相似歌手
                </Button>
              </div>
            ))}
          </div>
          {selected || followed.length === 1 ? (
            <SimilarArtists
              openArtist={openArtist}
              key={(selected ?? followed[0]).id}
              seed={selected ?? followed[0]}
              followed={followed}
              busy={busy}
              follow={(id, on) => {
                if (!selected && followed.length === 1) setSelected(followed[0])
                toggle(id, on)
              }}
              play={play}
            />
          ) : (
            followed.length > 1 && <small>选择上方歌手，查看歌曲与发行。</small>
          )}
        </section>
      </section>
      {locations.map((location, i) => (
        <div key={JSON.stringify(location)} hidden={i < locations.length - 1}>
          <LibraryCatalogPage
            location={location}
            local={local}
            songs={songs}
            play={playCollected}
            actions={{ play }}
            open={openCatalog}
            back={catalogBack}
          />
        </div>
      ))}
    </>
  )
}
const normalize = (v: string) => v.trim().normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ')
function collectedTracks(
  tracks: ReleaseTrack[],
  local: LocalTrack[],
  artist = '',
  aliases: string[] = [],
) {
  const matched = new Map<ReleaseTrack, string | null>()
  for (const row of local) {
    if (!row.available) continue
    const options = tracks.filter(
      (t) =>
        normalize(row.title) === normalize(t.title) &&
        (normalize(row.artist) === normalize(t.artist) ||
          (normalize(t.artist) === normalize(artist) &&
            aliases.some((a) => normalize(a) === normalize(row.artist)))) &&
        (row.discNumber == null || row.discNumber === t.disc) &&
        (row.trackNumber == null || row.trackNumber === t.position),
    )
    // An ambiguous file may be a duplicate of an already matched recording.
    if (options.length === 1) matched.set(options[0], matched.has(options[0]) ? null : row.id)
  }
  return matched
}
export function AlbumEditions({
  onEdition,
  album,
  local,
  actions,
  playLocal,
}: {
  onEdition: (id: string) => void
  playLocal(id: string): void
  album: Album
  local: LocalTrack[]
  actions: ReleaseActions
}) {
  const [choices, setChoices] = useState<Edition[]>()
  const [selected, setSelected] = useState('')
  const [tracks, setTracks] = useState<ReleaseTrack[]>()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  async function request(id?: string) {
    setBusy(true)
    setStatus('')
    try {
      if (id) {
        setSelected(id)
        onEdition(id)
        setTracks(undefined)
        setTracks(await window.music.editionTracks(id))
      } else {
        setChoices(await window.music.albumEditions(album.id))
      }
    } catch (error) {
      setStatus(message(error))
    } finally {
      setBusy(false)
    }
  }
  const [openTrack, setOpenTrack] = useState<ReleaseTrack>()
  const [searchingTrack, setSearchingTrack] = useState<ReleaseTrack>()
  const collected = collectedTracks(tracks ?? [], local)
  return (
    <section className="music-album-editions" aria-label="发行版本曲目">
      <Button size="small" disabled={busy || !!searchingTrack} onClick={() => void request()}>
        查看完整发行曲目
      </Button>
      {busy && <small role="status">正在查询 MusicBrainz…</small>}
      {status && <p role="alert">{status}</p>}
      {choices?.length === 0 && <p>没有找到对应的发行版本。</p>}
      {!!choices?.length && (
        <label htmlFor="album-edition-picker">
          发行版本{' '}
          <Dropdown
            id="album-edition-picker"
            inlinePopup
            aria-label="发行版本"
            className="edition-select"
            listbox={{ className: 'component-popup' }}
            placeholder="选择发行版本"
            value={choices.filter((c) => c.id === selected).map(labelEdition)[0] ?? ''}
            selectedOptions={selected ? [selected] : []}
            disabled={busy || !!searchingTrack}
            onOptionSelect={(_, d) => {
              if (d.optionValue) void request(d.optionValue)
            }}
          >
            {choices.map((c) => (
              <Option key={c.id} value={c.id} text={labelEdition(c)}>
                {labelEdition(c)}
              </Option>
            ))}
          </Dropdown>
        </label>
      )}
      {tracks?.length === 0 && <p>此发行版本暂无曲目资料。</p>}
      {!!tracks?.length && (
        <ol>
          {tracks.map((t) => {
            return (
              <CatalogSongRow
                key={[t.disc, t.number, t.title].join(':')}
                song={t}
                searching={!!searchingTrack}
                displayTitle={t.disc + '.' + t.number + ' ' + t.title}
                play={actions.play}
                album={album.title}
                localId={collected.get(t) || undefined}
                playLocal={() => {
                  const id = collected.get(t)
                  if (id) playLocal(id)
                }}
              >
                {collected.has(t) ? (
                  <small>已收录</small>
                ) : (
                  <MissingTrack
                    key={selected}
                    active={openTrack === t}
                    track={t}
                    album={album.title}
                    onSearch={() => setOpenTrack(t)}
                    disabled={!!searchingTrack}
                    onBusyChange={(busy) =>
                      setSearchingTrack((current) =>
                        busy ? t : current === t ? undefined : current,
                      )
                    }
                  />
                )}
              </CatalogSongRow>
            )
          })}
        </ol>
      )}
    </section>
  )
}
