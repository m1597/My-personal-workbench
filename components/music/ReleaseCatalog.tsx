import { Button, Dropdown, Option, Input } from '@fluentui/react-components'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { LocalTrack } from './LibraryPane'
import type { Album } from './AlbumBrowser'
import './release-catalog.css'

type Artist = { id: string; name: string; detail: string }
type Edition = { id: string; title: string; artist: string; detail: string }
const labelEdition = (c: Edition) => [c.title, c.artist, c.detail].filter(Boolean).join(' · ')
type ReleaseTrack = { disc: number; number: string; title: string; artist: string }
type News = { id: string; title: string; artist: string; date: string }
export interface ReleaseAPI {
  findArtists(term: string): Promise<Artist[]>
  followedArtists(): Promise<Artist[]>
  followArtist(id: string, on: boolean): Promise<Artist[]>
  releaseNews(refresh?: boolean): Promise<News[]>
  albumEditions(id: string): Promise<Edition[]>
  editionTracks(id: string): Promise<ReleaseTrack[]>
}
const message = (error: unknown) => String(error).split('Error: ').at(-1) || '读取发行资料失败'
export function ArtistReleases({ search }: { search: (query: string) => void }) {
  const [followed, setFollowed] = useState<Artist[]>([])
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<Artist[]>()
  const [news, setNews] = useState<News[]>()
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)
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
  function toggle(id: string, on: boolean) {
    void act(async () => {
      const list = await window.music.followArtist(id, on)
      setNews(undefined)
      await load(list)
    })
  }
  return (
    <section className="music-release-news" aria-label="关注歌手的新发行">
      <header>
        <h2>关注歌手的新发行</h2>
        <Button size="small" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          管理关注
        </Button>
        {!!followed.length && (
          <Button size="small" disabled={busy} onClick={() => void act(() => load(followed, true))}>
            刷新发行
          </Button>
        )}
      </header>
      {expanded && (
        <div className="artist-management">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (query.trim() && !busy)
                void act(async () => {
                  setMatches(await window.music.findArtists(query.trim()))
                })
            }}
          >
            <Input
              aria-label="要关注的歌手"
              maxLength={160}
              value={query}
              placeholder="输入歌手名"
              onChange={(_, d) => {
                setQuery(d.value)
                setMatches(undefined)
              }}
            />
            <Button size="small" type="submit" disabled={busy || !query.trim()}>
              查找歌手
            </Button>
          </form>
          {matches?.length === 0 && <p>没有找到匹配的歌手</p>}
          {matches
            ?.filter((a) => !followed.some((f) => f.id === a.id))
            .map((a) => (
              <div key={a.id}>
                {a.name} <small>{a.detail}</small>{' '}
                <Button size="small" disabled={busy} onClick={() => toggle(a.id, true)}>
                  关注{a.name}
                </Button>
              </div>
            ))}
          {followed.map((a) => (
            <div key={a.id}>
              {a.name} <small>{a.detail}</small>{' '}
              <Button size="small" disabled={busy} onClick={() => toggle(a.id, false)}>
                取消关注{a.name}
              </Button>
            </div>
          ))}
        </div>
      )}
      {busy && <small role="status">正在读取发行资料…</small>}
      {status && <p role="alert">{status}</p>}
      {!busy &&
        !status &&
        (!followed.length ? (
          <p>关注歌手后可在这里查看新发行。</p>
        ) : (
          news?.length === 0 && <p>近 90 天暂无新发行。</p>
        ))}
      {!!news?.length && (
        <ul>
          {news.map((r) => (
            <li key={r.id}>
              <div>
                <strong>{r.title}</strong>
                <small>
                  {r.artist} · {r.date}
                </small>
              </div>
              <Button size="small" onClick={() => search(r.title + ' ' + r.artist)}>
                去搜索
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
const normalize = (v: string) => v.trim().normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ')
export function AlbumEditions({
  album,
  local,
  search,
}: {
  album: Album
  local: LocalTrack[]
  search: (query: string) => void
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
  const remaining = [...local]
  return (
    <section className="music-album-editions" aria-label="发行版本曲目">
      <Button size="small" disabled={busy} onClick={() => void request()}>
        查看完整发行曲目
      </Button>
      {busy && <small role="status">正在查询 MusicBrainz…</small>}
      {status && <p role="alert">{status}</p>}
      {choices?.length === 0 && <p>没有找到对应的发行版本。</p>}
      {!!choices?.length && (
        <label>
          发行版本{' '}
          <Dropdown
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
            const index = remaining.findIndex(
              (row) =>
                row.available &&
                normalize(row.title) === normalize(t.title) &&
                normalize(row.artist) === normalize(t.artist),
            )
            if (index >= 0) remaining.splice(index, 1)
            return (
              <li key={t.disc + ':' + t.number + ':' + t.title}>
                <div>
                  <strong>
                    {t.disc}.{t.number} {t.title}
                  </strong>
                  <small>{t.artist}</small>
                </div>
                {index >= 0 ? (
                  <small>已收录</small>
                ) : (
                  <Button size="small" onClick={() => search(t.title + ' ' + t.artist)}>
                    搜索缺曲
                  </Button>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
