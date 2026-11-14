import { OnlineSongRow } from './OnlineSongRow'
import { ArtistPortrait } from './ArtistPortrait'
import { guardSearchEnter } from './searchSubmit'
import { Button, Dropdown, Option, Input } from '@fluentui/react-components'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { LibraryCatalogPage, useCatalogNavigation } from './LibraryCatalogPage'
import type { LocalTrack, PlaylistTrack } from './LibraryPane'
import { Cover, type Album } from './AlbumBrowser'
import { TrackMenu } from './TrackMenu'
import type { SongAPI } from './SongDetails'
import './release-catalog.css'

type Artist = { id: string; name: string; detail: string }
type Edition = { id: string; title: string; artist: string; detail: string }
const labelEdition = (c: Edition) => [c.title, c.artist, c.detail].filter(Boolean).join(' · ')
type ReleaseTrack = {
  position: number | null
  disc: number
  number: string
  title: string
  artist: string
}
export type News = { type: string; id: string; title: string; artist: string; date: string }
export interface ReleaseAPI extends SongAPI {
  findArtists(term: string): Promise<Artist[]>
  similarArtists(id: string): Promise<Artist[]>
  artistHighlights(id: string): Promise<Pick<ReleaseTrack, 'artist' | 'title'>[]>
  followedArtists(): Promise<Artist[]>
  followArtist(id: string, on: boolean): Promise<Artist[]>
  releaseNews(refresh?: boolean): Promise<News[]>
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
const artistNames = (name: string) =>
  normalize(name)
    .split(/\s*(?:\/|、|;|＆|&|\bfeat\.?\s+|\bfeaturing\s+)\s*/u)
    .filter(Boolean)

export interface ReleaseActions {
  play: PlayRecording
  add: (playlist: string, key: string) => Promise<void>
  playlists: { id: string; name: string }[]
}
async function matchTrack(
  track: Pick<ReleaseTrack, 'title' | 'artist'>,
  album = '',
  requireAlbum = false,
) {
  const artists = artistNames(track.artist)
  const result = await window.music.lxSearch({ title: track.title, artist: artists[0] ?? '' })
  const matches = result.items.filter(
    (item) =>
      normalize(item.title) === normalize(track.title) &&
      (!artists.length || artistNames(item.artist).some((name) => artists.includes(name))) &&
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
  actions,
  onSearch,
  active,
}: {
  active: boolean
  onSearch: () => void
  track: ReleaseTrack
  album: string
  actions: ReleaseActions
}) {
  const [recording, setRecording] = useState<Awaited<ReturnType<typeof matchTrack>>>()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setStatus('')
    try {
      await action()
    } catch (e) {
      setStatus(message(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="missing-track-actions">
      {recording && active ? (
        <>
          <small>
            {[recording.title, recording.artist, recording.album].filter(Boolean).join(' · ')}
          </small>
          <Button
            size="small"
            disabled={busy}
            onClick={() => void run(() => actions.play(recording.key))}
          >
            播放
          </Button>
          <Dropdown
            inlinePopup
            size="small"
            aria-label="加入歌单"
            placeholder="加入歌单"
            value="加入歌单"
            selectedOptions={[]}
            disabled={busy}
            listbox={{ className: 'component-popup' }}
            onOptionSelect={(_, d) => {
              const id = d.optionValue
              if (id)
                void run(async () => {
                  await actions.add(id, recording.key)
                  setStatus('已加入' + d.optionText)
                })
            }}
          >
            {actions.playlists.length ? (
              actions.playlists.map((p) => (
                <Option key={p.id} value={p.id}>
                  {p.name}
                </Option>
              ))
            ) : (
              <Option disabled>请先创建歌单</Option>
            )}
          </Dropdown>
        </>
      ) : (
        <Button
          size="small"
          disabled={busy}
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
export function NewsTracks({
  group,
  play,
  local = [],
  playLocal,
  named = false,
  aliases = [],
}: {
  group: News
  play: PlayRecording
  local?: LocalTrack[]
  playLocal?: (id: string, ids: string[]) => void
  named?: boolean
  aliases?: string[]
}) {
  const [pending, setPending] = useState('')
  const [playError, setPlayError] = useState('')
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
        setSelected(named && list.length > 1 ? '' : (list[0]?.id ?? ''))
        if (!list.length) setError('此发行暂无正式版本资料。')
      })
      .catch((e) => {
        if (active) setError(message(e))
      })
    return () => {
      active = false
    }
  }, [group.id, group.title, group.artist, named, editionRetry])
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
  async function listen(track: ReleaseTrack) {
    const localId = collectedTracks(tracks ?? [], local, group.artist, aliases).get(track)
    if (localId && playLocal) {
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
      await play(recording.key)
    } catch (e) {
      if (attempt.current === request) setPlayError(track.title + ' · ' + message(e))
    } finally {
      if (attempt.current === request) setPending('')
    }
  }
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
            <li key={[t.disc, t.number, t.title].join(':')}>
              <div>
                <strong>
                  {t.disc}.{t.number} {t.title}
                </strong>
                <small>{t.artist}</small>
              </div>
              <Button size="small" disabled={Boolean(pending)} onClick={() => void listen(t)}>
                {pending === t.disc + ':' + t.number ? '正在查找…' : '播放'}
              </Button>
            </li>
          ))}
        </ol>
      )}
      {playError && <small role="alert">{playError}</small>}
    </div>
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
  const [songs, setSongs] = useState<Pick<ReleaseTrack, 'artist' | 'title'>[]>()
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
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
  const [status, setStatus] = useState('')
  async function perform(
    song: Pick<ReleaseTrack, 'artist' | 'title'>,
    action: 'play' | 'download' | 'add',
    list?: string,
    name?: string,
  ) {
    setPending(true)
    setError('')
    setStatus('')
    try {
      const recording = await matchTrack(song)
      if (!live.current) return
      if (action === 'play') await play(recording.key)
      else if (action === 'add' && list) {
        const reference = await window.music.rememberOnline(recording.key)
        await window.music.setMembership(list, reference, true)
        setStatus('已加入「' + name + '」')
      } else {
        const prefs = (await window.music.state()).prefs
        const quality = recording.quality?.includes(prefs.quality)
          ? prefs.quality
          : recording.quality?.[0]
        if (!quality) throw Error('该录音没有可下载音质')
        const saved = await window.music.lxDownload(recording.key, quality, true)
        if (saved) setStatus('已下载并入库')
      }
    } catch (e) {
      if (live.current) setError(message(e))
    } finally {
      if (live.current) setPending(false)
    }
  }
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
      {status && <small role="status">{status}</small>}
      {error && <small role="alert">{error}</small>}
      {visible ? (
        visible.length ? (
          <ul>
            {visible.map((song) => (
              <OnlineSongRow
                key={song.title}
                className="highlight-recording"
                busy={pending}
                play={() => void perform(song, 'play')}
                download={() => void perform(song, 'download')}
                add={(list, name) => void perform(song, 'add', list, name)}
              >
                <span>{song.title}</span>
              </OnlineSongRow>
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
function FollowButton({
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
  return (
    <Button
      size="small"
      className="artist-follow-button"
      disabled={disabled}
      aria-label={(following ? '取消关注' : '关注') + artist.name}
      onClick={() => toggle(artist.id, !following)}
    >
      {following ? (
        <>
          <span className="follow-status">已关注</span>
          <span className="follow-cancel">取消关注</span>
        </>
      ) : (
        '关注'
      )}
    </Button>
  )
}
function SimilarArtists({
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
}: {
  rows: News[]
  play: PlayRecording
  albums: Album[]
}) {
  const [openGroup, setOpenGroup] = useState('')
  if (!rows.length) return null
  return (
    <ul>
      {rows.map((r) => (
        <li key={r.id} className="release-event">
          <div className="release-event-head">
            <Cover
              id={
                albums.find(
                  (album) =>
                    normalize(album.title) === normalize(r.title) &&
                    normalize(album.artist) === normalize(r.artist),
                )?.id
              }
            />
            <div>
              <strong>{r.title}</strong>
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
          {openGroup === r.id && <NewsTracks group={r} play={play} />}
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
  const [matches, setMatches] = useState<Artist[]>()
  const [news, setNews] = useState<News[]>()
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
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
    const data = list.length ? await window.music.releaseNews(force) : []
    if (alive.current) setNews(data)
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
      const found = await window.music.findArtists(term)
      if (alive.current && searchVersion.current === request) setMatches(found)
    } catch (error) {
      if (alive.current && searchVersion.current === request) setSearchError(message(error))
    } finally {
      if (alive.current && searchVersion.current === request) setSearching(false)
    }
  }
  function toggle(id: string, on: boolean) {
    void act(async () => {
      const list = await window.music.followArtist(id, on)
      if (!on && selected?.id === id) setSelected(undefined)
      setNews(undefined)
      await load(list)
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
          {status && <p role="alert">{status}</p>}
          {!busy &&
            !status &&
            (!followed.length ? (
              <p>关注歌手后可在这里查看新发行。</p>
            ) : (
              news?.length === 0 && <p>近 90 天暂无新发行。</p>
            ))}
          <ReleaseList rows={news ?? []} albums={albums} play={play} />
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
                placeholder="输入歌手名"
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
            {searchError && <small role="alert">{searchError}</small>}
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
  album,
  local,
  actions,
}: {
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
  const collected = collectedTracks(tracks ?? [], local)
  return (
    <section className="music-album-editions" aria-label="发行版本曲目">
      <Button size="small" disabled={busy} onClick={() => void request()}>
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
            disabled={busy}
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
              <TrackMenu key={t.disc + ':' + t.number + ':' + t.title} localId={collected.get(t)}>
                <li>
                  <div>
                    <strong>
                      {t.disc}.{t.number} {t.title}
                    </strong>
                    <small>{t.artist}</small>
                  </div>
                  {collected.has(t) ? (
                    <small>已收录</small>
                  ) : (
                    <MissingTrack
                      key={selected}
                      active={openTrack === t}
                      track={t}
                      album={album.title}
                      actions={actions}
                      onSearch={() => setOpenTrack(t)}
                    />
                  )}
                </li>
              </TrackMenu>
            )
          })}
        </ol>
      )}
    </section>
  )
}
