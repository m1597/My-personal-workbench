import { BackButton } from './BackButton'
import { Button, Checkbox, Dropdown, Input, Option, Tab, TabList } from '@fluentui/react-components'
import { Play, Search, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Playlist } from './PlaylistSortMenu'
import { guardSearchEnter } from './searchSubmit'
import './public-playlists.css'
export type PublicList = {
  id: string
  name: string
  author?: string
  count: string
  picture: string | null
}
export type PublicSong = {
  key: string
  title: string
  artist: string
  album: string
  duration: number
}
function ListImage({ picture }: { picture: string | null }) {
  const [src, setSrc] = useState('')
  const ref = useRef<HTMLImageElement>(null)
  useEffect(() => {
    if (!picture || !ref.current) return
    let alive = true
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      observer.disconnect()
      void window.music
        .publicListCover(picture)
        .then((url) => {
          if (url && alive) setSrc(url)
        })
        .catch(() => {})
    })
    observer.observe(ref.current)
    return () => {
      alive = false
      observer.disconnect()
    }
  }, [picture])
  return <img ref={ref} src={src || './default-cover.png'} alt="" />
}
export function PublicPlaylists({
  play,
  playlists,
  refresh,
  recommend,
}: {
  recommend: (query: string) => void
  play: (ids: string[]) => Promise<unknown>
  playlists: Playlist[]
  refresh: () => Promise<void>
}) {
  const [platform, setPlatform] = useState('wy'),
    [tag, setTag] = useState(''),
    [page, setPage] = useState(1)
  const [tags, setTags] = useState<{ id: string; name: string }[]>([])
  const [lists, setLists] = useState<PublicList[]>([]),
    [list, setList] = useState<PublicList>()
  const [songs, setSongs] = useState<PublicSong[]>([]),
    [selected, setSelected] = useState<string[]>([])
  const [draft, setDraft] = useState(''),
    [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const host = window.music
  useEffect(() => {
    let alive = true
    setTags([])
    void host
      .publicGenres(platform)
      .then((v) => {
        if (alive) setTags(v)
      })
      .catch((e) => {
        if (alive) setError(String(e).split('Error: ').pop() || '读取分类失败')
      })
    return () => {
      alive = false
    }
  }, [platform])
  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    setSongs([])
    setSelected([])
    const request = list
      ? host.publicListSongs(platform, list.id).then((v) => {
          if (alive) setSongs(v)
        })
      : host.publicLists(platform, tag, page, filter).then((v) => {
          if (alive) setLists(v)
        })
    void request
      .catch((e) => {
        if (alive) {
          setLists([])
          setError(String(e).split('Error: ').pop() || '读取歌单失败')
        }
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [platform, tag, page, list, filter])
  async function action(keys: string[], playlist?: string) {
    if (!keys.length || busy) return
    setBusy(true)
    setError('')
    try {
      const { ids, skipped } = await host.keepPublicSongs(keys, !playlist && keys.length > 1)
      if (skipped.length) setError('当前音质不可用：' + skipped.join('、'))
      if (!ids.length) return
      if (playlist) {
        await host.setMembership(playlist, ids, true)
        await refresh()
        setSelected([])
      } else {
        await refresh()
        await play(ids)
      }
    } catch (e) {
      setError(String(e).split('Error: ').pop() || '操作失败')
    } finally {
      setBusy(false)
    }
  }
  const [notice, setNotice] = useState('')
  async function importList(target: PublicList) {
    if (busy) return
    setBusy(true)
    setNotice('')
    setError('')
    try {
      await host.importPublicList(
        platform,
        target.id,
        target.name,
        list === target ? songs.map((song) => song.key) : undefined,
      )
      await refresh()
      setNotice('已导入到我的歌单：' + target.name)
    } catch (e) {
      setError(String(e).split('Error: ').pop() || '歌单导入失败')
    } finally {
      setBusy(false)
    }
  }
  const visible = lists
  return (
    <section className="public-playlists" aria-label="公开歌单">
      {list ? (
        <>
          <BackButton to="playlists" onClick={() => setList(undefined)} />
          <h2>{list.name}</h2>
          <div className="public-actions">
            <Button
              appearance="primary"
              disabled={!songs.length || busy}
              onClick={() => void action(songs.map((s) => s.key))}
            >
              播放全部
            </Button>
            <Button disabled={busy || loading} onClick={() => void importList(list)}>
              导入到我的歌单
            </Button>
            <Dropdown
              inlinePopup
              listbox={{ className: 'component-popup' }}
              aria-label="加入自己的歌单"
              placeholder="加入自己的歌单"
              selectedOptions={[]}
              disabled={!selected.length || busy || !playlists.length}
              onOptionSelect={(_, d) => {
                if (d.optionValue)
                  void action(
                    songs.filter((s) => selected.includes(s.key)).map((s) => s.key),
                    d.optionValue,
                  )
              }}
            >
              {playlists.map((p) => (
                <Option key={p.id} value={p.id}>
                  {p.name}
                </Option>
              ))}
            </Dropdown>
          </div>
          <ul className="public-songs">
            {songs.map((s) => (
              <li key={s.key}>
                <Checkbox
                  aria-label={'选择 ' + s.title}
                  checked={selected.includes(s.key)}
                  onChange={(_, d) =>
                    setSelected((ids) =>
                      d.checked ? [...ids, s.key] : ids.filter((k) => k !== s.key),
                    )
                  }
                />
                <div>
                  <strong>{s.title}</strong>
                  <small>
                    {s.artist} {s.album && ' · ' + s.album}
                  </small>
                </div>
                <Button
                  appearance="subtle"
                  icon={<Play size={16} />}
                  aria-label={'播放 ' + s.title}
                  disabled={busy}
                  onClick={() => void action([s.key])}
                />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <TabList
            aria-label="公开歌单平台"
            className="search-platforms"
            selectedValue={platform}
            onTabSelect={(_, d) => {
              setPlatform(String(d.value))
              setTag('')
              setPage(1)
              setFilter('')
              setDraft('')
            }}
          >
            <Tab value="wy">网易云音乐</Tab>
            <Tab value="tx">QQ 音乐</Tab>
            <Tab value="kg">酷狗音乐</Tab>
          </TabList>
          <div className="public-actions">
            <Dropdown
              inlinePopup
              listbox={{ className: 'component-popup' }}
              aria-label="歌单风格"
              selectedOptions={[tag]}
              value={tags.find((t) => t.id === tag)?.name || '全部风格'}
              onOptionSelect={(_, d) => {
                setTag(d.optionValue || '')
                setDraft('')
                setFilter('')
                setPage(1)
              }}
            >
              <Option value="">全部风格</Option>
              {tags.map((t) => (
                <Option key={t.id} value={t.id}>
                  {t.name}
                </Option>
              ))}
            </Dropdown>
            <form
              onKeyDownCapture={guardSearchEnter}
              onSubmit={(e) => {
                e.preventDefault()
                setFilter(draft.trim())
                setTag('')
                setPage(1)
              }}
            >
              <Input
                aria-label="搜索公开歌单"
                maxLength={160}
                placeholder="搜索公开歌单"
                value={draft}
                onChange={(_, d) => setDraft(d.value)}
                contentBefore={<Search size={16} />}
                contentAfter={
                  <Button
                    type="button"
                    size="small"
                    appearance="subtle"
                    aria-label="AI 推荐"
                    title="切换到 AI 推荐"
                    aria-pressed={false}
                    icon={<Sparkles size={16} />}
                    onClick={() => recommend(draft)}
                  />
                }
              />
              <Button type="submit">搜索</Button>
            </form>
          </div>
          <h2>{filter ? '搜索结果' : '热门歌单'}</h2>
          {!loading && (
            <div className="public-cards">
              {visible.map((l) => (
                <article key={l.id}>
                  <button className="public-list-card" type="button" onClick={() => setList(l)}>
                    <ListImage picture={l.picture} />
                    <strong>{l.name}</strong>
                    <small>
                      {[l.author, l.count && l.count + ' 次播放'].filter(Boolean).join(' · ')}
                    </small>
                  </button>
                  <Button
                    size="small"
                    appearance="subtle"
                    disabled={busy}
                    onClick={() => void importList(l)}
                  >
                    导入到我的歌单
                  </Button>
                </article>
              ))}
            </div>
          )}
          {!loading && !error && !visible.length && <p>本页没有匹配的歌单</p>}
          <div className="public-actions">
            <Button disabled={page <= 1 || loading} onClick={() => setPage((n) => n - 1)}>
              上一页
            </Button>
            <span>第 {page} 页</span>
            <Button disabled={!lists.length || loading} onClick={() => setPage((n) => n + 1)}>
              下一页
            </Button>
          </div>
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {loading && <p role="status">正在读取歌单…</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
