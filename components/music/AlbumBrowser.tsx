import { Button, Input } from '@fluentui/react-components'
import { ArrowLeft, Disc3, Play, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatTime, type LocalTrack } from './LibraryPane'
import './albums.css'

export type Album = { id: string; title: string; artist: string; tracks: string[] }

export function Cover({
  id,
  track = false,
  fallback,
}: {
  id?: string
  track?: boolean
  fallback?: string
}) {
  const frame = useRef<HTMLSpanElement>(null)
  const [image, setImage] = useState<{ id: string; url: string }>()
  useEffect(() => {
    const element = frame.current
    if (!id || !element) return
    let alive = true
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      observer.disconnect()
      const request = track ? window.music.trackCover(id) : window.music.albumCover(id)
      void request
        .then((url) => {
          if (alive && url) setImage({ id, url })
        })
        .catch(() => {})
    })
    observer.observe(element)
    return () => {
      alive = false
      observer.disconnect()
    }
  }, [id, track])
  return (
    <span ref={frame} className="album-art" aria-hidden="true">
      {image && image.id === id ? (
        <img src={image.url} alt="" onError={() => setImage(undefined)} />
      ) : fallback ? (
        <img src={fallback} alt="" />
      ) : (
        <Disc3 />
      )}
    </span>
  )
}

type Props = {
  revision: number
  tracks: LocalTrack[]
  active: string
  play: (id: string, queue: string[]) => void
}

export function AlbumBrowser({ revision, tracks, active, play }: Props) {
  const [albums, setAlbums] = useState<Album[]>()
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [chosen, setChosen] = useState('')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(48)
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
  const filtered = listed.filter((album) =>
    [album.title, album.artist].some((value) => value.toLocaleLowerCase().includes(query)),
  )
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
      <section aria-label="专辑曲目" className="album-detail">
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
          <Cover key={revision} id={selected.id} />
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
              onClick={() => play(queue[0], queue)}
            >
              播放整张
            </Button>
          </div>
        </header>
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
    <section aria-label="专辑列表" className="album-browser">
      <Input
        aria-label="搜索本地专辑"
        type="search"
        placeholder="搜索专辑或专辑艺人"
        contentBefore={<Search size={16} />}
        value={search}
        onChange={(_, d) => {
          setSearch(d.value)
          setLimit(48)
        }}
      />
      <small>{filtered.length} 张专辑</small>
      <div className="album-grid">
        {filtered.slice(0, limit).map((album) => (
          <button
            type="button"
            key={album.id}
            className="album-tile"
            aria-label={album.title + ' · ' + album.artist}
            onClick={() => setChosen(album.id)}
          >
            <Cover key={revision} id={album.id} />
            <strong title={album.title}>{album.title}</strong>
            <small title={album.artist}>
              {album.artist} · {album.tracks.length} 首
            </small>
          </button>
        ))}
      </div>
      {filtered.length > limit && (
        <Button onClick={() => setLimit((n) => n + 48)}>显示更多专辑</Button>
      )}
      {!filtered.length && (
        <p className="music-empty">
          {listed.length ? '没有匹配的专辑' : '导入本地歌曲后，可在这里按专辑浏览。'}
        </p>
      )}
    </section>
  )
}
