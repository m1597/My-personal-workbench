import {
  useSidebarSorting,
  useGroupSorting,
  orderedSidebarItems,
  type SidebarSorting,
} from './SidebarSorting'
import { PlaylistSortMenu, type Playlist, type PlaylistSorting } from './PlaylistSortMenu'
export type { Playlist } from './PlaylistSortMenu'
import { TrackMenu } from './TrackMenu'
import { AlbumBrowser } from './AlbumBrowser'
import { InfrequentTracks } from './InfrequentTracks'
import { RecentHistory } from './LibraryTools'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Checkbox,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
  Input,
  Popover,
  PopoverSurface,
  PopoverTrigger,
} from '@fluentui/react-components'
import {
  Folder,
  Plus,
  ListMusic,
  ListPlus,
  PanelLeft,
  Music2,
  Play,
  Search,
  Trash2,
  Pause,
  FolderSearch,
  Heart,
  History,
} from 'lucide-react'
type FolderEntry = { id: string; name: string }
export type LocalTrack = {
  id: string
  title: string
  artist: string
  folder: FolderEntry | null
  album: string
  duration: number
  recommendationSource?: string
  notInterested?: boolean
  listed: number
  available: number
  observedAt: number
  hiddenFromRecent?: number
  lastHeardAt: number | null
  size: number | null
  favorite: number
  origin: 'local' | 'download' | 'daily'
  playCount: number
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
interface Props extends SidebarSorting, PlaylistSorting {
  albumRevision: number
  favorite: (id: string, value: boolean) => Promise<unknown>
  addFavorites: (ids: string[]) => Promise<number | null>
  rows: LocalTrack[]
  tracks: LocalTrack[]
  playlists: Playlist[]
  collection: string
  days: number
  changeDays: (days: number) => void
  select: (id: string) => void
  create: (name: string) => Promise<boolean>
  membership: (list: string, ids: string | string[], added: boolean) => Promise<boolean>
  total: number
  search: string
  setSearch: (v: string) => void
  job?: ImportJob
  active: string
  playing: boolean
  play: (id: string, queue?: string[]) => void
  cancel: () => void
  relocate: (id: string) => void
  onQueue: (id: string, next: boolean) => void
  dismiss: (id: string) => void
  playRow: (id: string) => void
  queueAlbumNext: (ids: string[]) => void
  playAlbum: (id: string, queue: string[]) => void
  error: string
  remove: (id: string | string[], trash: boolean) => Promise<boolean>
  renameList: (id: string, name: string) => Promise<boolean>
  deleteList: (id: string) => Promise<boolean>
  openFolder: (id: string) => void
  removeFolder: (id: string) => Promise<boolean>
}
export function LibraryPane({
  albumRevision,
  favorite,
  addFavorites,
  tracks,
  playlists,
  sidebarOrder,
  moveSidebarItem,
  setPlaylistSort,
  movePlaylistTrack,
  collection,
  days,
  changeDays,
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
  cancel,
  relocate,
  remove,
  error,
  playRow,
  playAlbum,
  queueAlbumNext,
  onQueue,
  dismiss,
  renameList,
  deleteList,
  removeFolder,
  openFolder,
}: Props) {
  const [limit, setLimit] = useState(100)
  const [albumView, setAlbumView] = useState(false)
  const showAlbums = collection === 'all' && albumView
  const [selection, setSelection] = useState<Set<string> | null>(null)
  const [batchBusy, setBatchBusy] = useState(false)
  const [favoriteResult, setFavoriteResult] = useState<{ selection: Set<string>; text: string }>()
  const selectedIds = useMemo(
    () => (selection ? rows.filter((t) => selection.has(t.id)).map((t) => t.id) : []),
    [selection, rows],
  )
  const userPlaylists = playlists.filter((list) => !list.system)
  const batchFavorite = async () => {
    if (batchBusy || !selection || !selectedIds.length) return
    setBatchBusy(true)
    setFavoriteResult(undefined)
    try {
      const added = await addFavorites(selectedIds)
      if (added !== null)
        setFavoriteResult({
          selection,
          text: `新增收藏 ${added} 首，原已收藏 ${selectedIds.length - added} 首`,
        })
    } finally {
      setBatchBusy(false)
    }
  }
  const batchMembership = async (id: string, added: boolean) => {
    if (batchBusy || !selectedIds.length) return
    setBatchBusy(true)
    try {
      if (await membership(id, selectedIds, added)) setSelection(null)
    } finally {
      setBatchBusy(false)
    }
  }
  const sentinel = useRef<HTMLLIElement>(null)
  useEffect(() => {
    const target = sentinel.current
    if (showAlbums || !target || limit >= rows.length) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setLimit((n) => n + 100)
      },
      { root: target.closest('.music-scroll'), rootMargin: '400px' },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [limit, rows.length, showAlbums])
  const [sidebar, setSidebar] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [action, setAction] = useState<{
    kind: 'rename' | 'deleteList' | 'folder' | 'song' | 'batch'
    ids?: string[]
    id: string
    name: string
  }>()
  const remainingIds = useMemo(() => {
    if (!action?.ids) return undefined
    const present = new Set(tracks.map((track) => track.id))
    return action.ids.filter((id) => present.has(id))
  }, [action, tracks])
  const [editName, setEditName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [failedAction, setFailedAction] = useState<typeof action>()
  const saving = useRef(false)
  const confirm = async (task: () => Promise<unknown>) => {
    if (saving.current) return
    setFailedAction(undefined)
    saving.current = true
    setSubmitting(true)
    try {
      if (await task()) setAction(undefined)
      else setFailedAction(action)
    } finally {
      saving.current = false
      setSubmitting(false)
    }
  }
  const folders = useMemo(() => {
    const entries = new Map<string, FolderEntry>()
    for (const { folder } of tracks) if (folder) entries.set(folder.id, folder)
    return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [tracks])
  const sortable = useSidebarSorting(moveSidebarItem)
  const sortableTrack = useGroupSorting(movePlaylistTrack, 'application/x-fitbay-playlist-track')
  const currentPlaylist = playlists.find((p) => p.id === collection)
  const currentFolder = folders.find((f) => f.id === collection)
  const heading = currentPlaylist?.name ?? currentFolder?.name ?? '全部歌曲'
  const choose = (id: string) => {
    setAlbumView(false)
    setSelection(null)
    select(id)
    setSidebar(false)
    setLimit(100)
    sentinel.current?.closest('.music-scroll')?.scrollTo(0, 0)
  }
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
          size="small"
          icon={<Music2 size={16} />}
          onClick={() => choose('all')}
        >
          全部歌曲
        </Button>
        <Button
          appearance="subtle"
          aria-pressed={collection === 'infrequent'}
          size="small"
          icon={<ListMusic size={16} />}
          onClick={() => choose('infrequent')}
        >
          不常听
        </Button>
        <Button
          appearance="subtle"
          aria-pressed={collection === 'recent'}
          size="small"
          icon={<History size={16} />}
          onClick={() => choose('recent')}
        >
          最近播放
        </Button>
        <Button
          appearance="subtle"
          aria-pressed={collection === 'favorites'}
          size="small"
          icon={<Heart size={16} />}
          onClick={() => choose('favorites')}
        >
          我的收藏
        </Button>
        <h3>文件夹</h3>
        {orderedSidebarItems(folders, sidebarOrder?.folders).map((node) => (
          <Menu key={node.id} openOnContext>
            <MenuTrigger disableButtonEnhancement>
              <Button
                appearance="subtle"
                size="small"
                {...sortable('folders', node.id)}
                title={node.name}
                aria-pressed={collection === node.id}
                icon={<Folder size={16} />}
                onClick={() => choose(node.id)}
              >
                {node.name}
              </Button>
            </MenuTrigger>
            <MenuPopover className="component-popup">
              <MenuList>
                <MenuItem onClick={() => openFolder(node.id)}>打开文件所在位置</MenuItem>
                <MenuItem onClick={() => setAction({ kind: 'folder', ...node })}>
                  从曲库移除文件夹
                </MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        ))}
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
                setSelection(null)
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
        {orderedSidebarItems(playlists, sidebarOrder?.playlists).map((list) => {
          const trigger = (
            <Button
              key={list.id}
              {...sortable('playlists', list.id)}
              appearance="subtle"
              size="small"
              aria-pressed={collection === list.id}
              icon={<ListMusic size={16} />}
              onClick={() => choose(list.id)}
            >
              {list.name}
            </Button>
          )
          if (list.system) return trigger
          return (
            <Menu key={list.id} openOnContext>
              <MenuTrigger disableButtonEnhancement>{trigger}</MenuTrigger>
              <MenuPopover className="component-popup">
                <MenuList>
                  <MenuItem
                    onClick={() => {
                      setEditName(list.name)
                      setAction({ kind: 'rename', ...list })
                    }}
                  >
                    重命名歌单
                  </MenuItem>
                  <MenuItem onClick={() => setAction({ kind: 'deleteList', ...list })}>
                    删除歌单
                  </MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
          )
        })}
      </aside>
      {collection === 'recent' ? (
        <RecentHistory tracks={tracks} play={play} />
      ) : collection === 'infrequent' ? (
        <InfrequentTracks
          rows={rows}
          days={days}
          changeDays={changeDays}
          active={active}
          playing={playing}
          play={play}
          remove={remove}
        />
      ) : (
        <section className="local-library" aria-label="本地歌曲库">
          {collection === 'all' && (
            <fieldset className="library-view-switch" aria-label="曲库视图">
              {(['歌曲', '专辑'] as const).map((name) => (
                <Button
                  key={name}
                  size="small"
                  appearance="subtle"
                  aria-pressed={name === (albumView ? '专辑' : '歌曲')}
                  onClick={() => setAlbumView(name === '专辑')}
                >
                  {name}
                </Button>
              ))}
            </fieldset>
          )}
          {showAlbums ? (
            <AlbumBrowser
              revision={albumRevision}
              tracks={tracks}
              active={active}
              play={playAlbum}
              queueNext={queueAlbumNext}
            />
          ) : (
            <>
              <div className="library-title">
                <div>
                  <h2>{collection === 'favorites' ? '我的收藏' : heading}</h2>
                  <small>{search ? rows.length + ' / ' + total : total} 首歌曲</small>
                </div>
                {currentPlaylist && (
                  <PlaylistSortMenu playlist={currentPlaylist} setPlaylistSort={setPlaylistSort} />
                )}
                <Button
                  size="small"
                  disabled={batchBusy || (!selection && !rows.length)}
                  aria-pressed={!!selection}
                  onClick={() => setSelection(selection ? null : new Set())}
                >
                  {selection ? '退出多选' : '多选'}
                </Button>
              </div>
              <Input
                aria-label="搜索本地歌曲"
                type="search"
                placeholder="搜索歌名、艺人或专辑"
                contentBefore={<Search size={16} />}
                value={search}
                onChange={(_, v) => {
                  if (selection) setSelection(new Set())
                  setSearch(v.value)
                }}
              />
              {selection && (
                <section className="library-import" aria-label="批量管理歌曲">
                  <Checkbox
                    label="全选当前列表"
                    disabled={batchBusy || !rows.length}
                    checked={
                      selectedIds.length === 0
                        ? false
                        : selectedIds.length === rows.length || 'mixed'
                    }
                    onChange={() =>
                      setSelection(
                        new Set(selectedIds.length === rows.length ? [] : rows.map((t) => t.id)),
                      )
                    }
                  />
                  <small role="status">已选 {selectedIds.length} 首</small>
                  <Menu>
                    <MenuTrigger disableButtonEnhancement>
                      <Button
                        size="small"
                        disabled={batchBusy || !selectedIds.length}
                        icon={<ListPlus size={15} />}
                      >
                        加入歌单
                      </Button>
                    </MenuTrigger>
                    <MenuPopover className="component-popup">
                      <MenuList>
                        {userPlaylists.length ? (
                          userPlaylists.map((list) => (
                            <MenuItem
                              key={list.id}
                              onClick={() => void batchMembership(list.id, true)}
                            >
                              {list.name}
                            </MenuItem>
                          ))
                        ) : (
                          <MenuItem disabled>请先在曲库导航中新建歌单</MenuItem>
                        )}
                      </MenuList>
                    </MenuPopover>
                  </Menu>
                  <Button
                    size="small"
                    disabled={batchBusy || !selectedIds.length}
                    icon={<Heart size={15} />}
                    onClick={() => void batchFavorite()}
                  >
                    加入收藏
                  </Button>
                  {currentFolder && (
                    <Button
                      size="small"
                      disabled={batchBusy || !selectedIds.length}
                      icon={<Trash2 size={15} />}
                      onClick={() =>
                        setAction({
                          kind: 'batch',
                          id: collection,
                          ids: selectedIds,
                          name: '所选 ' + selectedIds.length + ' 首歌曲',
                        })
                      }
                    >
                      移除所选歌曲
                    </Button>
                  )}
                  {playlists.some((list) => list.id === collection) && (
                    <Button
                      size="small"
                      disabled={batchBusy || !selectedIds.length}
                      onClick={() => void batchMembership(collection, false)}
                    >
                      从当前歌单移除
                    </Button>
                  )}
                  {favoriteResult?.selection === selection && (
                    <small role="status">{favoriteResult.text}</small>
                  )}
                </section>
              )}
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
                      <TrackMenu
                        key={t.id}
                        queueable={!!t.available}
                        onQueue={(next) => onQueue(t.id, next)}
                        onDismiss={
                          collection === 'system-recommendations' ? () => dismiss(t.id) : undefined
                        }
                        dismissed={t.notInterested}
                      >
                        <li
                          {...(currentPlaylist?.sort === 'custom' && !selection
                            ? sortableTrack(collection, t.id)
                            : {})}
                          data-active={active === t.id}
                          className="library-row"
                          onDoubleClick={(e) => {
                            if (
                              !selection &&
                              t.available &&
                              e.target instanceof Element &&
                              e.currentTarget.contains(e.target) &&
                              !e.target.closest('button, input, .track-actions, [role="button"]')
                            )
                              playRow(t.id)
                          }}
                        >
                          {selection ? (
                            <Checkbox
                              aria-label={'选择' + t.title}
                              checked={selection.has(t.id)}
                              disabled={batchBusy}
                              onChange={(_, data) =>
                                setSelection((current) => {
                                  if (!current) return current
                                  const next = new Set(current)
                                  if (data.checked) next.add(t.id)
                                  else next.delete(t.id)
                                  return next
                                })
                              }
                            />
                          ) : (
                            <Button
                              size="small"
                              appearance="subtle"
                              disabled={!t.available}
                              aria-label={(active === t.id && playing ? '暂停' : '播放') + t.title}
                              icon={
                                active === t.id && playing ? (
                                  <Pause size={15} />
                                ) : (
                                  <Play size={15} />
                                )
                              }
                              onClick={() => play(t.id)}
                            />
                          )}
                          <div className="library-name">
                            <strong title={t.title}>{t.title}</strong>
                            <small title={t.artist}>{t.artist}</small>
                            {t.recommendationSource && (
                              <small title={t.recommendationSource}>
                                推荐来源 · {t.recommendationSource}
                              </small>
                            )}
                            {!t.available && <small>文件不可用</small>}
                          </div>
                          <span className="library-album" title={t.album}>
                            {t.album || '—'}
                          </span>
                          <small className="library-time">{formatTime(t.duration)}</small>
                          {!selection && (
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
                                  <Checkbox
                                    label="我的收藏"
                                    checked={!!t.favorite}
                                    onChange={(_, d) => void favorite(t.id, d.checked === true)}
                                  />
                                  <strong>我的歌单</strong>
                                  {playlists.some((p) => !p.system) ? (
                                    playlists
                                      .filter((p) => !p.system)
                                      .map((list) => (
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
                                onClick={() => setAction({ kind: 'song', id: t.id, name: t.title })}
                              />
                            </div>
                          )}
                        </li>
                      </TrackMenu>
                    ))}
                    {rows.length > limit && <li ref={sentinel} aria-hidden="true" />}
                  </ul>
                </>
              ) : (
                <div className="music-empty library-empty">
                  <Music2 size={28} />
                  <h2>
                    {total
                      ? '没有匹配的歌曲'
                      : collection === 'all'
                        ? '曲库还是空的'
                        : '这里还没有歌曲'}
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
            </>
          )}
        </section>
      )}
      {action && (
        <Dialog
          open
          onOpenChange={(_, next) => {
            if (!next.open && !saving.current) setAction(undefined)
          }}
        >
          <DialogSurface className="component-popup library-action-dialog">
            <DialogBody>
              <DialogTitle>
                {
                  {
                    song: '移除歌曲',
                    batch: '移除所选歌曲',
                    rename: '重命名歌单',
                    deleteList: '删除歌单',
                    folder: '移除文件夹',
                  }[action.kind]
                }
              </DialogTitle>
              <DialogContent>
                {action.kind === 'rename' ? (
                  <Input
                    aria-label="新歌单名称"
                    maxLength={80}
                    value={editName}
                    onChange={(_, v) => setEditName(v.value)}
                  />
                ) : action.kind === 'song' || action.kind === 'batch' ? (
                  <>
                    从 FitBay 移除「
                    {remainingIds ? `所选 ${remainingIds.length} 首歌曲` : action.name}
                    」会同步移除其歌单引用，原文件保留。
                  </>
                ) : action.kind === 'folder' ? (
                  <>
                    移除「{action.name}
                    」内歌曲的曲库索引。原文件保留，已加入歌单的歌曲仍可从歌单播放。
                  </>
                ) : (
                  <>删除「{action.name}」及其歌单内的引用。曲库和音乐文件保留。</>
                )}
                {failedAction === action && error && <p role="alert">{error}</p>}
              </DialogContent>
              <DialogActions fluid>
                {action.kind === 'song' || action.kind === 'batch' ? (
                  <>
                    <Button
                      appearance="primary"
                      disabled={submitting}
                      onClick={() => void confirm(() => remove(remainingIds ?? action.id, false))}
                    >
                      仅从 FitBay 移除
                    </Button>
                    {playlists.some((list) => list.id === collection) && (
                      <Button
                        disabled={submitting}
                        onClick={() => void confirm(() => membership(collection, action.id, false))}
                      >
                        仅从当前歌单移除
                      </Button>
                    )}
                    <Button
                      disabled={submitting}
                      onClick={() => void confirm(() => remove(remainingIds ?? action.id, true))}
                    >
                      移至系统回收站
                    </Button>
                  </>
                ) : action.kind === 'rename' ? (
                  <Button
                    appearance="primary"
                    disabled={submitting || !editName.trim()}
                    onClick={() => void confirm(() => renameList(action.id, editName))}
                  >
                    保存名称
                  </Button>
                ) : (
                  <Button
                    appearance="primary"
                    disabled={submitting}
                    onClick={() =>
                      void confirm(() =>
                        action.kind === 'folder' ? removeFolder(action.id) : deleteList(action.id),
                      )
                    }
                  >
                    {action.kind === 'folder' ? '确认移除文件夹' : '确认删除歌单'}
                  </Button>
                )}
                <Button disabled={submitting} onClick={() => setAction(undefined)}>
                  取消
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
    </div>
  )
}
