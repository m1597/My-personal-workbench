import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Checkbox,
  Input,
  Popover,
  PopoverSurface,
  PopoverTrigger,
} from '@fluentui/react-components'
import {
  FileMusic,
  Folder,
  ChevronRight,
  Plus,
  ListMusic,
  ListPlus,
  PanelLeft,
  FolderPlus,
  Music2,
  Play,
  Search,
  Trash2,
  Pause,
  FolderSearch,
} from 'lucide-react'
type FolderEntry = { id: string; name: string }
type FolderNode = FolderEntry & { children: Map<string, FolderNode> }
export type Playlist = { id: string; name: string; tracks: string[] }
export type LocalTrack = {
  id: string
  title: string
  artist: string
  folders: FolderEntry[]
  album: string
  duration: number
  available: number
}
export type ImportJob = {
  started?: boolean
  running: boolean
  added: number
  duplicates: number
  failed: number
  cancelled: boolean
}
export const formatTime = (t: number) =>
  Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0')
type Props = {
  rows: LocalTrack[]
  tracks: LocalTrack[]
  playlists: Playlist[]
  collection: string
  select: (id: string) => void
  create: (name: string) => Promise<boolean>
  membership: (list: string, id: string, added: boolean) => Promise<unknown>
  total: number
  search: string
  setSearch: (v: string) => void
  job?: ImportJob
  active: string
  playing: boolean
  play: (id: string) => void
  importFiles: (mode: 'folder' | 'files') => void
  cancel: () => void
  relocate: (id: string) => void
  remove: (id: string) => void
}
export function LibraryPane({
  tracks,
  playlists,
  collection,
  select,
  create,
  membership,
  rows,
  total,
  search,
  setSearch,
  job,
  active,
  playing,
  play,
  importFiles,
  cancel,
  relocate,
  remove,
}: Props) {
  const [limit, setLimit] = useState(100)
  const sentinel = useRef<HTMLLIElement>(null)
  useEffect(() => {
    const target = sentinel.current
    if (!target || limit >= rows.length) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setLimit((n) => n + 100)
      },
      { root: target.closest('.music-scroll'), rootMargin: '400px' },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [limit, rows.length])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [sidebar, setSidebar] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const folders = useMemo(() => {
    const root = new Map<string, FolderNode>()
    for (const track of tracks) {
      let branch = root
      for (const folder of track.folders) {
        let node = branch.get(folder.id)
        if (!node) {
          node = { ...folder, children: new Map() }
          branch.set(folder.id, node)
        }
        branch = node.children
      }
    }
    return root
  }, [tracks])
  const heading =
    playlists.find((p) => p.id === collection)?.name ??
    (collection !== 'all'
      ? tracks
          .find((t) => t.folders.some((f) => f.id === collection))
          ?.folders.find((f) => f.id === collection)?.name
      : undefined) ??
    '全部歌曲'
  const choose = (id: string) => {
    select(id)
    setSidebar(false)
    setLimit(100)
    sentinel.current?.closest('.music-scroll')?.scrollTo(0, 0)
  }
  const folderRows = (branch: Map<string, FolderNode>): React.ReactNode =>
    Array.from(branch.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((node) => (
        <div key={node.id}>
          <div className="folder-line">
            {node.children.size > 0 && (
              <Button
                appearance="subtle"
                size="small"
                aria-label={(expanded.has(node.id) ? '收起' : '展开') + node.name}
                aria-expanded={expanded.has(node.id)}
                icon={<ChevronRight size={14} />}
                onClick={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev)
                    if (next.has(node.id)) next.delete(node.id)
                    else next.add(node.id)
                    return next
                  })
                }
              />
            )}
            <Button
              appearance="subtle"
              size="small"
              aria-pressed={collection === node.id}
              icon={<Folder size={15} />}
              onClick={() => choose(node.id)}
            >
              {node.name}
            </Button>
          </div>
          {expanded.has(node.id) && (
            <div className="folder-children">{folderRows(node.children)}</div>
          )}
        </div>
      ))
  return (
    <div className="library-layout">
      <Button
        size="small"
        appearance="subtle"
        className="library-nav-toggle"
        icon={<PanelLeft size={15} />}
        aria-expanded={sidebar}
        onClick={() => setSidebar(!sidebar)}
      >
        曲库导航
      </Button>
      <aside className="library-sidebar" data-open={sidebar} aria-label="曲库分类">
        <Button
          appearance="subtle"
          aria-pressed={collection === 'all'}
          icon={<Music2 size={16} />}
          onClick={() => choose('all')}
        >
          全部歌曲
        </Button>
        <h3>文件夹</h3>
        {folderRows(folders)}
        <div className="playlist-heading">
          <h3>我的歌单</h3>
          <Button
            appearance="subtle"
            size="small"
            icon={<Plus size={16} />}
            aria-label="新建歌单"
            onClick={() => setCreating(!creating)}
          />
        </div>
        {creating && (
          <form
            className="playlist-form"
            onSubmit={async (e) => {
              e.preventDefault()
              if (name.trim() && (await create(name))) {
                setName('')
                setCreating(false)
              }
            }}
          >
            <Input
              size="small"
              placeholder="歌单名称"
              aria-label="歌单名称"
              maxLength={80}
              value={name}
              onChange={(_, v) => setName(v.value)}
            />
            <Button size="small" type="submit" disabled={!name.trim()}>
              创建
            </Button>
          </form>
        )}
        {playlists.map((list) => (
          <Button
            key={list.id}
            appearance="subtle"
            size="small"
            aria-pressed={collection === list.id}
            icon={<ListMusic size={15} />}
            onClick={() => choose(list.id)}
          >
            {list.name}
          </Button>
        ))}
      </aside>
      <section className="local-library" aria-label="本地歌曲库">
        <div className="library-title">
          <div>
            <h2>{heading}</h2>
            <small>{search ? rows.length + ' / ' + total : total} 首歌曲</small>
          </div>
          <div className="library-import">
            <Button
              size="small"
              icon={<FileMusic size={16} />}
              disabled={job?.running}
              onClick={() => importFiles('files')}
            >
              添加文件
            </Button>
            <Button
              size="small"
              appearance="primary"
              icon={<FolderPlus size={16} />}
              disabled={job?.running}
              onClick={() => importFiles('folder')}
            >
              添加文件夹
            </Button>
          </div>
        </div>
        <Input
          aria-label="搜索本地歌曲"
          type="search"
          placeholder="搜索歌名、艺人或专辑"
          contentBefore={<Search size={16} />}
          value={search}
          onChange={(_, v) => setSearch(v.value)}
        />
        {job?.started && (
          <div className="library-job" role="status">
            <span>
              {job.running ? '正在导入' : job.cancelled ? '导入已取消' : '导入完成'} · 新增{' '}
              {job.added} · 重复 {job.duplicates} · 失败 {job.failed}
            </span>
            {job.running && (
              <Button size="small" appearance="subtle" onClick={cancel}>
                取消导入
              </Button>
            )}
          </div>
        )}
        {rows.length ? (
          <>
            <div className="library-columns" aria-hidden="true">
              <span>歌曲 / 艺人</span>
              <span>专辑</span>
              <span>时长</span>
            </div>
            <ul>
              {rows.slice(0, limit).map((t) => (
                <li key={t.id} data-active={active === t.id} className="library-row">
                  <Button
                    size="small"
                    appearance="subtle"
                    disabled={!t.available}
                    aria-label={(active === t.id && playing ? '暂停' : '播放') + t.title}
                    icon={active === t.id && playing ? <Pause size={15} /> : <Play size={15} />}
                    onClick={() => play(t.id)}
                  />
                  <div className="library-name">
                    <strong title={t.title}>{t.title}</strong>
                    <small title={t.artist}>{t.artist}</small>
                    {!t.available && <small>文件不可用</small>}
                  </div>
                  <span className="library-album" title={t.album}>
                    {t.album || '—'}
                  </span>
                  <small className="library-time">{formatTime(t.duration)}</small>
                  <div className="track-actions">
                    <Popover>
                      <PopoverTrigger disableButtonEnhancement>
                        <Button
                          size="small"
                          appearance="subtle"
                          aria-label={'管理歌单' + t.title}
                          title="加入或移出歌单"
                          icon={<ListPlus size={16} />}
                        />
                      </PopoverTrigger>
                      <PopoverSurface className="component-popup playlist-options">
                        <strong>我的歌单</strong>
                        {playlists.length ? (
                          playlists.map((list) => (
                            <Checkbox
                              key={list.id}
                              label={list.name}
                              checked={list.tracks.includes(t.id)}
                              onChange={(_, v) =>
                                void membership(list.id, t.id, v.checked === true)
                              }
                            />
                          ))
                        ) : (
                          <small>在曲库导航中点「＋」新建歌单。</small>
                        )}
                      </PopoverSurface>
                    </Popover>
                    {!t.available && (
                      <Button
                        size="small"
                        appearance="subtle"
                        title="重新定位"
                        aria-label={'重新定位' + t.title}
                        icon={<FolderSearch size={16} />}
                        onClick={() => relocate(t.id)}
                      />
                    )}
                    <Button
                      size="small"
                      appearance="subtle"
                      title="从曲库移除"
                      aria-label={'从曲库移除' + t.title}
                      icon={<Trash2 size={15} />}
                      onClick={() => remove(t.id)}
                    />
                  </div>
                </li>
              ))}
              {rows.length > limit && <li ref={sentinel} aria-hidden="true" />}
            </ul>
          </>
        ) : (
          <div className="music-empty library-empty">
            <Music2 size={28} />
            <h2>
              {total ? '没有匹配的歌曲' : collection === 'all' ? '曲库还是空的' : '这里还没有歌曲'}
            </h2>
            <p>
              {total
                ? '试试其他歌名、艺人或专辑。'
                : collection === 'all'
                  ? '选择音乐文件或文件夹，歌曲会保留在原位置。'
                  : '在歌曲右侧打开「管理歌单」添加歌曲。'}
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
