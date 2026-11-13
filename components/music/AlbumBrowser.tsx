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
import { ArrowLeft, ArrowDownUp, Play, Search } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { formatTime, type LocalTrack } from './LibraryPane'
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

export function requestCover(id: string, track: boolean, revision: number) {
  const key = [revision, track ? 'track' : 'album', id].join(':')
  let request = pendingCovers.get(key)
  if (!request) {
    request = (track ? window.music.trackCover(id) : window.music.albumCover(id)).finally(() => {
      pendingCovers.delete(key)
    })
    pendingCovers.set(key, request)
  }
  return request
}

export function Cover({
  id,
  track = false,
  revision = 0,
}: {
  id?: string
  track?: boolean
  revision?: number
}) {
  const frame = useRef<HTMLSpanElement>(null)
  const [image, setImage] = useState<{
    id: string
    revision: number
    url: string
  }>()
  useEffect(() => {
    const element = frame.current
    if (!id || !element) return
    let alive = true
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      observer.disconnect()
      void requestCover(id, track, revision)
        .then((url) => {
          if (alive && url) setImage({ id, revision, url })
        })
        .catch(() => {})
    })
    observer.observe(element)
    return () => {
      alive = false
      observer.disconnect()
    }
  }, [id, track, revision])
  return (
    <span ref={frame} className="album-art" aria-hidden="true">
      <img
        src={(image?.id === id && image?.revision === revision && image.url) || defaultCover}
        alt=""
        onError={image ? () => setImage(undefined) : undefined}
      />
    </span>
  )
}

type Props = {
  searchRelease: (query: string) => void
  revision: number
  tracks: LocalTrack[]
  active: string
  queueNext: (ids: string[]) => void
  play: (id: string, queue: string[], wholeAlbum?: boolean) => void
}

const sortLabels = { name: '专辑名称', descending: '曲数从多到少', ascending: '曲数从少到多' }
type AlbumSort = keyof typeof sortLabels

export function AlbumBrowser({ searchRelease, revision, tracks, active, play, queueNext }: Props) {
  const [albums, setAlbums] = useState<Album[]>()
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [chosen, setChosen] = useState('')
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
        <Button
          className="album-back"
          size="small"
          appearance="subtle"
          icon={<ArrowLeft size={16} />}
          onClick={() => setChosen('')}
        >
          返回专辑
        </Button>
        <header className="album-detail-header">
          <Cover revision={revision} id={selected.id} />
          <div>
            <h2>{selected.title}</h2>
            <p>
              {selected.artist} · {selected.tracks.length} 首歌曲
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
          key={selected.id}
          album={selected}
          local={selected.tracks.flatMap((id) => trackMap.get(id) ?? [])}
          search={searchRelease}
        />
        <ol className="album-tracks">
          {selected.tracks.map((id) => {
            const row = trackMap.get(id)
            if (!row) return null
            return (
              <li key={id} data-active={id === active}>
                <Button
                  size="small"
                  appearance="subtle"
                  disabled={!row.available}
                  icon={<Play size={15} />}
                  aria-label={'播放' + row.title}
                  onClick={() => play(id, queue)}
                />
                <div className="library-name">
                  <strong title={row.title}>{row.title}</strong>
                  <small>
                    {row.artist}
                    {!row.available && ' · 文件不可用'}
                  </small>
                </div>
                <small className="library-time">{formatTime(row.duration)}</small>
              </li>
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
