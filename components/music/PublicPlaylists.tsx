import { songRow } from './songRow'
import { SongCredits } from './SongCredits'
import { DiscoveryInput } from './DiscoveryInput'
import { BackButton } from './BackButton'
import { Button, Checkbox, Dropdown, Option, Tab, TabList } from '@fluentui/react-components'
import { Play } from 'lucide-react'
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
  ai,
  draft,
  setDraft,
  toggleAI,
}: {
  ai: boolean
  draft: string
  setDraft(value: string): void
  toggleAI(): void
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
  const [filter, setFilter] = useState('')
  const [thinking, setThinking] = useState(false)
  const queryVersion = useRef(0)
  useEffect(
    () => () => {
      queryVersion.current++
    },
    [],
  )
  async function submit() {
    const version = ++queryVersion.current
    setError('')
    setThinking(ai)
    try {
      const keyword = ai
        ? await window.music.aiCatalogQuery('publicLists', draft.trim())
        : draft.trim()
      if (version !== queryVersion.current) return
      setTag('')
      setPage(1)
      setFilter(keyword)
    } catch (e) {
      if (version === queryVersion.current)
        setError(String(e).split('Error: ').pop() || '歌单推荐失败')
    } finally {
      if (version === queryVersion.current) setThinking(false)
    }
  }
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
      const { ids, skipped } = await host.keepPublicSongs(
        keys,
        playlist ? 'save' : keys.length > 1 ? 'queue' : 'play',
      )
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
  type ImportStatus = { kind: 'working' | 'done' | 'failed'; text: string }
  const [imports, setImports] = useState<Record<string, ImportStatus>>({})
  const activeImports = useRef(new Set<string>())
  const importKey = (target: PublicList) => platform + '/' + target.id
  async function importList(target: PublicList) {
    const key = importKey(target)
    if (activeImports.current.has(key)) return
    activeImports.current.add(key)
    const report = (kind: ImportStatus['kind'], text: string) =>
      setImports((old) => ({ ...old, [key]: { kind, text } }))
    report('working', '正在导入…')
    try {
      const result = await host.importPublicList(
        platform,
        target.id,
        target.name,
        list === target ? songs.map((song) => song.key) : undefined,
      )
      report(
        'done',
        result.added
          ? '已导入 · 新增 ' + result.added + ' 首，跳过 ' + result.skipped + ' 首'
          : '已导入 · 全部重复，' + result.skipped + ' 首均已在歌单中',
      )
      await refresh()
    } catch (e) {
      report('failed', String(e).split('Error: ').pop() || '歌单导入失败')
    } finally {
      activeImports.current.delete(key)
    }
  }
  function importControl(target: PublicList, disabled = false) {
    const status = imports[importKey(target)]
    return (
      <div className="public-import">
        <Button
          size="small"
          appearance="subtle"
          disabled={disabled || status?.kind === 'working'}
          onClick={() => void importList(target)}
        >
          {status?.kind === 'failed'
            ? '重试导入'
            : status?.kind === 'working'
              ? '正在导入…'
              : '导入到我的歌单'}
        </Button>
        <small role={status?.kind === 'failed' ? 'alert' : 'status'}>{status?.text}</small>
      </div>
    )
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
            {importControl(list, loading)}
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
              <li
                key={s.key}
                {...songRow(() => {
                  if (!busy) void action([s.key])
                })}
              >
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
                    <SongCredits song={s} />
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
          <form
            className="download-search"
            onKeyDownCapture={guardSearchEnter}
            onSubmit={(e) => {
              e.preventDefault()
              if (!thinking && (!ai || draft.trim())) void submit()
            }}
          >
            <DiscoveryInput
              lists
              ai={ai}
              value={draft}
              edit={setDraft}
              toggle={() => {
                queryVersion.current++
                setThinking(false)
                toggleAI()
              }}
            />
            <Button type="submit" appearance="primary" disabled={thinking || (ai && !draft.trim())}>
              {ai ? '推荐歌单' : '搜索'}
            </Button>
          </form>
          <TabList
            aria-label="公开歌单平台"
            className="search-platforms"
            selectedValue={platform}
            onTabSelect={(_, d) => {
              setPlatform(String(d.value))
              setTag('')
              setPage(1)
              setFilter('')
              queryVersion.current++
              setThinking(false)
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
                queryVersion.current++
                setThinking(false)
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
                  {importControl(l)}
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
      {loading && <p role="status">正在读取歌单…</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
