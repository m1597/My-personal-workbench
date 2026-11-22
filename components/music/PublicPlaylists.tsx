import { Dropdown, Option } from '../../src/renderer/src/app/SharedDropdown'
import { useMusicFeedback } from './musicFeedback'
import { OnlineSongRow, RowPlay } from './OnlineSongRow'
import { SongCredits } from './SongCredits'
import { DiscoveryInput } from './DiscoveryInput'
import { BackButton } from './BackButton'
import { Button, Checkbox, Tab, TabList } from '@fluentui/react-components'
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
  onlineId?: string
  localId?: string
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
  const feedback = useMusicFeedback()
  const [platform, setPlatform] = useState('wy'),
    [tag, setTag] = useState(''),
    [page, setPage] = useState(1)
  const [tags, setTags] = useState<{ id: string; name: string }[]>([])
  const [lists, setLists] = useState<PublicList[]>([]),
    [list, setList] = useState<PublicList>()
  const [songs, setSongs] = useState<PublicSong[]>([]),
    [selected, setSelected] = useState<string[]>([])
  const [addedNotice, setAddedNotice] = useState('')
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
      if (version === queryVersion.current) setError(feedback.error(e))
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
        if (alive) setError(feedback.error(e))
      })
    return () => {
      alive = false
    }
  }, [platform, feedback.error])
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
          setError(feedback.error(e))
        }
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [platform, tag, page, list, filter, feedback.error])
  const [resolved, setResolved] = useState<Record<string, string>>({})
  async function action(keys: string[], playlist?: string, download = false) {
    if (!keys.length || busy) return
    setBusy(true)
    setError('')
    setAddedNotice('')
    try {
      const { ids, skipped } = await host.keepPublicSongs(
        keys,
        playlist || download ? 'save' : keys.length > 1 ? 'queue' : 'play',
      )
      if (skipped.length)
        setError(
          feedback.text('当前音质不可用：', 'Unavailable at this quality: ') + skipped.join(', '),
        )
      if (!ids.length) return
      if (keys.length === 1) setResolved((old) => ({ ...old, [keys[0]]: ids[0] }))
      if (download) {
        const results = await host.downloadSelection(ids)
        const failed = results.find((r) => r.status === 'failed')
        if (failed) setError(feedback.error(failed.error))
        setAddedNotice(
          feedback.text(
            `已下载并入库 ${results.filter((r) => r.status === 'saved').length} 首`,
            `Downloaded ${results.filter((r) => r.status === 'saved').length} tracks`,
          ),
        )
        await refresh()
        const state = await host.state()
        const copies = new Map(state.onlineTracks.map((row) => [row.id, row.localCopy]))
        setSongs((rows) =>
          rows.map((row) => ({
            ...row,
            localId: copies.get(row.onlineId || resolved[row.key]) || undefined,
          })),
        )
      } else if (playlist) {
        const receipt = await host.setMembership(playlist, ids, true)
        if (receipt && 'added' in receipt)
          setAddedNotice(
            feedback.text(
              `已加入 ${receipt.added} 首，原已在歌单中 ${receipt.skipped} 首`,
              `Added ${receipt.added}, already in playlist ${receipt.skipped}`,
            ),
          )
        await refresh()
        setSelected([])
      } else {
        await refresh()
        await play(ids)
      }
    } catch (e) {
      setError(feedback.error(e))
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
    report('working', feedback.text('正在导入…', 'Importing…'))
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
          ? feedback.text(
              `已导入 · 新增 ${result.added} 首，跳过 ${result.skipped} 首`,
              `Imported · ${result.added} added, ${result.skipped} skipped`,
            )
          : feedback.text(
              `已导入 · 全部重复，${result.skipped} 首均已在歌单中`,
              `No new tracks · All ${result.skipped} already in the playlist`,
            ),
      )
      await refresh()
    } catch (e) {
      report('failed', feedback.error(e))
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
            ? feedback.text('重试导入', 'Retry import')
            : status?.kind === 'working'
              ? feedback.text('正在导入…', 'Importing…')
              : feedback.text('导入到我的歌单', 'Import to my playlists')}
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
          <BackButton
            to="playlists"
            onClick={() => {
              setList(undefined)
              setAddedNotice('')
            }}
          />
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
          {addedNotice && <small role="status">{addedNotice}</small>}
          <ul className="public-songs">
            {songs.map((s) => (
              <OnlineSongRow
                key={s.key}
                className="public-recording"
                busy={busy}
                localId={s.localId}
                play={() => void action([s.key])}
                download={() => void action([s.key], undefined, true)}
                add={(list) => void action([s.key], list)}
              >
                <RowPlay
                  id={resolved[s.key] || s.onlineId}
                  title={s.title}
                  disabled={busy}
                  play={() => void action([s.key])}
                />
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
              </OnlineSongRow>
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
