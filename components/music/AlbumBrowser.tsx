import { CollectedSongRow } from './CollectedSongRow'
import { SongCredits } from './SongCredits'
import { BackButton } from './BackButton'
import {
  Button,
  Input,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  MenuItemRadio,
} from '@fluentui/react-components'
import { ArrowDownUp, Play, Search, Shuffle } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { LocalTrack } from './LibraryPane'
import { AlbumEditions } from './ReleaseCatalog'
import './albums.css'

export type Album = {
  id: string
  title: string
  artist: string
  tracks: string[]
}

const pendingCovers = new Map<string, Promise<string | null>>()
export const defaultCover = './default-cover.png'

export function requestCover(
  id: string,
  track: boolean,
  revision: number,
  edition?: string,
  group?: string,
) {
  const key = [revision, track ? 'track' : 'album', id, edition, group].join(':')
  let request = pendingCovers.get(key)
  if (!request) {
    request = (
      track
        ? window.music.trackCover(id, edition, group)
        : window.music.albumCover(id, edition, group)
    ).finally(() => {
      pendingCovers.delete(key)
    })
    pendingCovers.set(key, request)
  }
  return request
}

export function Cover({
  id,
  track = false,
  group,
  edition,
  revision = 0,
}: {
  id?: string
  group?: string
  edition?: string
  track?: boolean
  revision?: number
}) {
  const key = JSON.stringify([id, group, edition])
  const frame = useRef<HTMLSpanElement>(null)
  const [image, setImage] = useState<{
    id: string
    revision: number
    url: string
  }>()
  useEffect(() => {
    const element = frame.current
    if ((!id && !group && !edition) || !element) return
    let alive = true
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      observer.disconnect()
      void (async () =>
        (id && (await requestCover(id, track, revision, edition, group).catch(() => null))) ||
        (edition && (await window.music.releaseCover(edition, true).catch(() => null))) ||
        (group && (await window.music.releaseCover(group))))()
        .then((url) => {
          if (alive && url) setImage({ id: key, revision, url })
        })
        .catch(() => {})
    })
    observer.observe(element)
    return () => {
      alive = false
      observer.disconnect()
    }
  }, [key, id, group, edition, track, revision])
  return (
    <span ref={frame} className="album-art" aria-hidden="true">
      <img
        src={(image?.id === key && image?.revision === revision && image.url) || defaultCover}
        alt=""
        onError={image ? () => setImage(undefined) : undefined}
      />
    </span>
  )
}

type Props = {
  releaseActions: import('./ReleaseCatalog').ReleaseActions
  revision: number
  tracks: LocalTrack[]
  active: string
  queueNext: (ids: string[]) => void
  play: (id: string, queue: string[], wholeAlbum?: boolean) => void
}

const sortLabels = { name: '专辑名称', descending: '曲数从多到少', ascending: '曲数从少到多' }
type AlbumSort = keyof typeof sortLabels

export function AlbumBrowser({ releaseActions, revision, tracks, active, play, queueNext }: Props) {
  const [albums, setAlbums] = useState<Album[]>()
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [chosen, setChosen] = useState('')
  const [remoteEdition, setRemoteEdition] = useState<{ album: string; id: string }>()
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<AlbumSort>('name')
  const section = useRef<HTMLElement>(null)
  const listOffset = useRef(0)
  const trackMap = useMemo(
    () => new Map(tracks.filter((row) => row.listed).map((row) => [row.id, row])),
    [tracks],
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: host index revisions and explicit retries trigger a new read.
  useEffect(() => {
    let alive = true
    setError(false)
    void window.music
      .albums()
      .then((result) => {
        if (alive) setAlbums(result)
      })
      .catch(() => {
        if (alive) setError(true)
      })
    return () => {
      alive = false
    }
  }, [attempt, revision])

  const listed = useMemo(
    () =>
      (albums ?? [])
        .map((album) => ({
          ...album,
          tracks: album.tracks.filter((id) => trackMap.has(id)),
        }))
        .filter((album) => album.tracks.length),
    [albums, trackMap],
  )
  const selected = listed.find((album) => album.id === chosen)
  const query = search.trim().toLocaleLowerCase()
  const filtered = useMemo(() => {
    const result = listed.filter((album) =>
      [album.title, album.artist].some((value) => value.toLocaleLowerCase().includes(query)),
    )
    if (sort !== 'name')
      result.sort((a, b) =>
        sort === 'descending'
          ? b.tracks.length - a.tracks.length
          : a.tracks.length - b.tracks.length,
      )
    return result
  }, [listed, query, sort])
  const detailOpen = Boolean(selected)
  const playableAlbums = useMemo(
    () => filtered.filter((album) => album.tracks.some((id) => trackMap.get(id)?.available)),
    [filtered, trackMap],
  )
  useLayoutEffect(() => {
    const scroll = section.current?.closest('.music-scroll')
    scroll?.scrollTo(0, detailOpen ? 0 : listOffset.current)
  }, [detailOpen])
  if (error)
    return (
      <div role="alert">
        读取本地专辑失败。{' '}
        <Button size="small" onClick={() => setAttempt((n) => n + 1)}>
          重试
        </Button>
      </div>
    )
  if (!albums) return <small role="status">正在读取本地专辑…</small>
  if (selected) {
    const queue = selected.tracks.filter((id) => trackMap.get(id)?.available)
    return (
      <section ref={section} aria-label="专辑曲目" className="album-detail">
        <BackButton to="albums" onClick={() => setChosen('')} />
        <header className="album-detail-header">
          <Cover
            revision={revision}
            id={selected.id}
            edition={remoteEdition?.album === selected.id ? remoteEdition.id : undefined}
          />
          <div>
            <h2>{selected.title}</h2>
            <p>
              <SongCredits song={{ title: selected.title, artist: selected.artist }} /> ·{' '}
              {selected.tracks.length} 首歌曲
            </p>
            <Button
              size="small"
              appearance="primary"
              icon={<Play size={15} />}
              disabled={!queue.length}
              onClick={() => play(queue[0], queue, true)}
            >
              播放整张
            </Button>
          </div>
        </header>
        <AlbumEditions
          onEdition={(id) => setRemoteEdition({ album: selected.id, id })}
          key={selected.id}
          album={selected}
          local={selected.tracks.flatMap((id) => trackMap.get(id) ?? [])}
          actions={releaseActions}
          playLocal={(id) => play(id, queue)}
        />
        <ol className="album-tracks">
          {selected.tracks.map((id) => {
            const row = trackMap.get(id)
            if (!row) return null
            return (
              <CollectedSongRow
                key={id}
                song={row}
                active={id === active}
                play={() => play(id, queue)}
              />
            )
          })}
        </ol>
      </section>
    )
  }
  return (
    <section ref={section} aria-label="专辑列表" className="album-browser">
      <Input
        aria-label="搜索本地专辑"
        type="search"
        placeholder="搜索专辑或专辑艺人"
        contentBefore={<Search size={16} />}
        value={search}
        onChange={(_, d) => setSearch(d.value)}
      />
      <div className="album-controls">
        <Button
          size="small"
          icon={<Shuffle size={15} />}
          disabled={!playableAlbums.length}
          onClick={() => {
            const album = playableAlbums[Math.floor(Math.random() * playableAlbums.length)]
            const queue = album.tracks.filter((id) => trackMap.get(id)?.available)
            listOffset.current = section.current?.closest('.music-scroll')?.scrollTop ?? 0
            setChosen(album.id)
            play(queue[0], queue, true)
          }}
        >
          随机听一张
        </Button>
        <Menu checkedValues={{ sort: [sort] }}>
          <MenuTrigger disableButtonEnhancement>
            <Button size="small" icon={<ArrowDownUp size={15} />} aria-label="专辑排序">
              {sortLabels[sort]}
            </Button>
          </MenuTrigger>
          <MenuPopover className="component-popup">
            <MenuList>
              {(Object.keys(sortLabels) as AlbumSort[]).map((value) => (
                <MenuItemRadio key={value} name="sort" value={value} onClick={() => setSort(value)}>
                  {sortLabels[value]}
                </MenuItemRadio>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>
        <small>{filtered.length} 张专辑</small>
      </div>
      <div className="album-grid">
        {filtered.map((album) => (
          <Menu key={album.id} openOnContext>
            <MenuTrigger disableButtonEnhancement>
              <button
                type="button"
                className="album-tile"
                aria-label={album.title + ' · ' + album.artist}
                onClick={() => {
                  listOffset.current = section.current?.closest('.music-scroll')?.scrollTop ?? 0
                  setChosen(album.id)
                }}
              >
                <Cover revision={revision} id={album.id} />
                <strong title={album.title}>{album.title}</strong>
                <small title={album.artist}>
                  {album.artist} · {album.tracks.length} 首
                </small>
              </button>
            </MenuTrigger>
            <MenuPopover className="component-popup">
              <MenuList>
                <MenuItem
                  disabled={!album.tracks.some((id) => trackMap.get(id)?.available)}
                  onClick={() =>
                    queueNext(album.tracks.filter((id) => trackMap.get(id)?.available))
                  }
                >
                  下一首播放整张
                </MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        ))}
      </div>
      {!filtered.length && (
        <p className="music-empty">
          {listed.length ? '没有匹配的专辑' : '导入本地歌曲后，可在这里按专辑浏览。'}
        </p>
      )}
    </section>
  )
}
