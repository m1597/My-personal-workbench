import { playlistRows, type PlaylistSorting } from './PlaylistSortMenu'
import { TrackMenu } from './TrackMenu'
import { Cover, type Album } from './AlbumBrowser'
import { NowPlaying } from './NowPlaying'
import { guideSteps, MusicGuide } from './MusicGuide'
import { observeListening } from './listening'
import type { SourceInventory } from './MusicSourcesSettings'
import {
  MusicSettings,
  type MusicPreferences,
  type SettingsCategory,
  type TransportAction,
  type TasteStatus,
} from './MusicSettings'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button, Checkbox, Slider, Tab, TabList } from '@fluentui/react-components'
import { ComponentTheme, configureBackdrop } from '../../src/renderer/src/app/ComponentTheme'
import {
  AudioLines,
  Heart,
  Disc3,
  CircleHelp,
  PanelBottomClose,
  PanelTopOpen,
  PanelTopClose,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Shuffle,
  Repeat1,
  ListOrdered,
  FolderPlus,
  Square,
  ListMusic,
} from 'lucide-react'
import {
  type Playlist,
  LibraryPane,
  formatTime,
  type LocalTrack,
  type ImportJob,
} from './LibraryPane'
import { PlaybackQueue } from './PlaybackQueue'
import { VolumeControls } from './VolumeControls'
import './style.css'
const legacySummaries: Record<string, string> = {
  denied: '当前来源明确禁止保存这首歌',
  preview: '当前来源仅提供试听',
  unknown: '当前来源未声明是否允许保存这首歌',
  mixed: '各来源的结果不同，本次未能保存',
  missing: '当前来源没有找到匹配的录音版本',
  quality: '当前来源没有可下载的完整音质',
  unusable: '当前来源没有返回可保存的完整音频',
  source: '请先在设置中导入音乐源',
  'source-request': '音乐源暂未返回可用结果，可稍后重试',
  storage: '保存文件失败，请检查下载目录和可用空间',
  network: '暂时无法获取平台结果，可稍后重试',
  cancelled: '本次下载已取消',
}
type Batch = {
  id: string
  day: string
  preference: string
  targetCount: number | null
  state: 'running' | 'completed' | 'cancelled' | 'blocked' | null
  message: string | null
  details: string | null
}
type Track = {
  id: string
  artist: string
  title: string
  album: string
  version: string
}
type Item = {
  id: string
  batch: string
  title: string
  artist: string
  recordingAlbum?: string
  reason: string
  track: string
  status: string
  daily: string | null
  localId: string | null
  localAvailable: number | null
  diagnosis: string
  notInterested: boolean
  attemptSources: string
  downloadSummary: string
  downloadError: string
  audioDuration: number | null
  online: boolean
  checked: number
  candidates: Track[]
}
import { RecommendationComposer } from './RecommendationComposer'
import type { ModelInfo } from './ModelSettings'
import { DownloadPane } from './LxPanel'
import type { LibraryToolsAPI } from './LibraryTools'
import type { Versions } from './LxPanel'
type State = {
  prefs: MusicPreferences
  models: ModelInfo
  items: Item[]
  batches: Batch[]
  summary: string[]
  draft: string
  current: string
  position: number
  sidebarOrder: Record<'folders' | 'playlists', string[]>
  playlists: Playlist[]
  localTracks: LocalTrack[]
  albumRevision: number
  importJob: ImportJob
  queue: string[]
  queueOccurrence: number
  pendingAlbum: string[]
  repeatOne: boolean
  hasLibrary: boolean
}
type Presentation = 'full' | 'bar' | 'background'
type Mode = { mode: string; presentation: Presentation }
declare global {
  interface Window {
    music: LibraryToolsAPI & {
      albums(): Promise<Album[]>
      albumCover(id: string): Promise<string | null>
      trackCover(id: string): Promise<string | null>
      musicGuide(): Promise<{ seen: boolean; script: string }>
      markMusicGuide(): Promise<void>
      setMusicQuality(quality: string): Promise<void>
      setMusicOutput(volume: number, muted: boolean): Promise<void>
      setMusicShortcut(action: TransportAction, key: string): Promise<void>
      setMusicMediaKeys(enabled: boolean): Promise<void>
      chooseMusicDirectory(kind: 'manual' | 'recommend'): Promise<void>
      configureModel(id: string, model: string, key: string, forget: boolean): Promise<void>
      onLyricsSaved(listener: () => void): () => void
      onLibraryChanged(listener: (removed: string[]) => void): () => void
      onSourcesChanged(listener: () => void): () => void
      lxSources(): Promise<SourceInventory>
      lxRefreshCatalog(): Promise<SourceInventory>
      lxImportSelected(ids: string[]): Promise<{ origin: string; id?: string; error?: string }[]>
      lxSelectSource(id: string): Promise<void>
      lxInfo(): Promise<string>
      lxImport(link?: string): Promise<void>
      lxCancel(scope?: 'import'): Promise<void>
      lxSearch(
        query: string | { title: string; artist: string },
        platform?: string,
      ): Promise<Versions>
      lxPreview(id: string, key: string, quality: string): Promise<string>
      lxDownload(key: string, quality: string): Promise<string>
      lxDownload(
        key: string,
        quality: string,
        detailed: true,
      ): Promise<'' | { file: string; sources: string[] }>
      moveSidebarItem(
        group: 'folders' | 'playlists',
        id: string,
        target: string,
        after: boolean,
      ): Promise<void>
      createPlaylist(name: string): Promise<string>
      setPlaylistSort: PlaylistSorting['setPlaylistSort']
      movePlaylistTrack: PlaylistSorting['movePlaylistTrack']
      setMembership(playlist: string, track: string | string[], added: boolean): Promise<void>
      importLocal(mode: 'folder' | 'files'): Promise<void>
      cancelImport(): Promise<void>
      refreshLocal(): Promise<void>
      lyrics(id: string): Promise<[number, string][]>
      showLyrics(on: boolean): Promise<void>
      unlockLyrics(): Promise<void>
      onLyricLocked(listener: (locked: boolean) => void): () => void
      lyricLine(line: string): Promise<void>
      removeLocal(id: string | string[]): Promise<void>
      trashLocal(id: string | string[]): Promise<boolean>
      openFolder(id: string): Promise<void>
      removeFolder(id: string): Promise<string[]>
      renamePlaylist(id: string, name: string): Promise<void>
      deletePlaylist(id: string): Promise<void>
      relocateLocal(id: string): Promise<void>
      mediaFailed(id: string, url: string): Promise<void>
      localSource(id: string): Promise<string>
      dismissRecommendation(id: string): Promise<void>
      setRepeatOne(enabled: boolean): Promise<void>
      setQueue(ids: string[], occurrence?: number, pendingAlbum?: string[]): Promise<void>
      playQueue(
        id: string,
        ids: string[],
        position: number,
        occurrence?: number,
        pendingAlbum?: string[],
      ): Promise<void>
      state(): Promise<State>
      draft(s: string): Promise<void>
      getTasteStatus(): Promise<TasteStatus>
      setTasteConsent(value: boolean): Promise<TasteStatus>
      prepareRecommendation(id: string, key?: string): Promise<void>
      recommendationChoices(id: string): Promise<Versions['items']>
      generate(
        s: string,
        mode?: 'auto' | 'style' | 'artist',
        similar?: boolean,
        targetCount?: number,
      ): Promise<string | null>
      stopGeneration(): Promise<void>
      match(id: string): Promise<void>
      choose(id: string, track: string): Promise<void>
      retry(id: string): Promise<void>
      cancel(id: string): Promise<void>
      cancelBatch(batch: string): Promise<void>
      bytes(id: string): Promise<Uint8Array<ArrayBuffer>>
      progress(id: string, time: number, duration: number): Promise<void>
      heardLocal(url: string): Promise<void>
      release(): Promise<void>
      clean(): Promise<void>
      checked(id: string, on: boolean): Promise<void>
      keep(batch: string): Promise<void>
    }
    musicWindow: {
      thumbnailState(state: {
        paused: boolean
        previous: boolean
        toggle: boolean
        next: boolean
      }): void
      onTransport(fn: (action: TransportAction) => void): () => void
      status(): Promise<Mode>
      present(mode: Presentation): Promise<void>
      transfer(action: string): Promise<{ ok: boolean; error?: string }>
      subscribe(fn: (v: Mode) => void): () => void
    }
  }
}
configureBackdrop()
const host = window.music
const playable = (row: Item) => ['已入库', '就绪'].includes(row.status)
function occurrenceIndex(ids: string[], id: string, occurrence = 0) {
  let index = ids.indexOf(id)
  for (let i = 0; i < occurrence && index >= 0; i++) index = ids.indexOf(id, index + 1)
  return index < 0 ? ids.indexOf(id) : index
}
function occurrenceAt(ids: string[], index: number) {
  return ids.slice(0, index).filter((id) => id === ids[index]).length
}
function shuffleQueue(ids: string[], first?: string) {
  const result = [...new Set(ids)].filter((id) => id !== first)
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  if (first && ids.includes(first)) result.unshift(first)
  return result
}
function Music() {
  const [guide, setGuide] = useState<number | null>(null)
  const guideOrigin = useRef({ tab: 'library', category: 'library' as SettingsCategory })
  function visitGuide(step: number) {
    const page = guideSteps[step].page
    if (page === 'audition') setTab(page)
    else {
      setSettingsCategory(page)
      setTab('settings')
    }
    setGuide(step)
  }
  function closeGuide() {
    setGuide(null)
    setSettingsCategory(guideOrigin.current.category)
    setTab(guideOrigin.current.tab)
  }
  const startFirstGuide = useEffectEvent(() => visitGuide(0))
  const [script, setScript] = useState('')
  useEffect(() => {
    let alive = true
    void window.music
      .musicGuide()
      .then(async (info) => {
        if (!alive) return
        setScript(info.script)
        if (!info.seen) {
          startFirstGuide()
          await window.music.markMusicGuide()
        }
      })
      .catch((e) => alive && setError(String(e)))
    return () => {
      alive = false
    }
  }, [])
  const [state, setState] = useState<State>(),
    [paused, setPaused] = useState(true),
    [time, setTime] = useState(0),
    [loadedId, setLoadedId] = useState(''),
    [error, setError] = useState(''),
    [docked, setDocked] = useState(false)
  const [presentation, setPresentation] = useState<Presentation>('full')
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>('library')
  function openSettings(category: SettingsCategory) {
    setSettingsCategory(category)
    setTab('settings')
    requestAnimationFrame(() => document.querySelector('.music-scroll')?.scrollTo(0, 0))
  }
  const [tab, setTab] = useState('library'),
    [requestedCollection, setCollection] = useState('all'),
    [search, setSearch] = useState('')
  const [online, setOnline] = useState<{
    row: Item
    result: Versions
    queueIds: string[]
  }>()
  const [infrequentDays, setInfrequentDays] = useState(90)
  const [resolving, setResolving] = useState(false)
  const [shuffled, setShuffled] = useState<string[] | null>(null)
  const [repeatOne, setRepeatOne] = useState(false)
  const switching = useRef(Promise.resolve())
  const audio = useRef<HTMLAudioElement>(null),
    current = useRef(''),
    epoch = useRef(0),
    url = useRef('')
  const refresh = async () => setState(await host.state())
  const libraryChanged = useEffectEvent(async (removed: string[]) => {
    if (removed.includes(current.current)) await end(false)
    await refresh()
  })
  useEffect(() => host.onLibraryChanged((removed) => void libraryChanged(removed)), [])
  const heard = useEffectEvent((src: string) => {
    if (src.startsWith('fitbay-audio:'))
      void host
        .heardLocal(src)
        .then(refresh)
        .catch((e) => setError(String(e)))
  })
  useEffect(() => {
    if (!audio.current) return
    return observeListening(audio.current, (src) => heard(src))
  }, [])
  async function act(fn: () => Promise<unknown>) {
    try {
      setError('')
      await fn()
      await refresh()
      return true
    } catch (e) {
      setError(String(e).replace(/^Error:.*?Error: /, ' '))
      await refresh().catch(() => {})
      return false
    }
  }
  useEffect(() => {
    void host
      .state()
      .then((s) => {
        setState(s)
        setRepeatOne(s.repeatOne)
      })
      .catch((e) => setError(String(e)))
    const mode = (v: Mode) => {
      setDocked(v.mode === 'docked')
      setPresentation(v.presentation)
    }
    void window.musicWindow.status().then(mode)
    return window.musicWindow.subscribe(mode)
  }, [])
  useEffect(() => {
    if (tab !== 'library') return
    let mounted = true
    const rescan = () =>
      void host
        .refreshLocal()
        .then(() => host.state())
        .then((s) => {
          if (mounted) setState(s)
        })
        .catch((e) => setError(String(e)))
    rescan()
    window.addEventListener('focus', rescan)
    return () => {
      mounted = false
      window.removeEventListener('focus', rescan)
    }
  }, [tab])
  const [generating, setGenerating] = useState(false)
  const batch = state?.batches[0]
  const running = batch?.state === 'running'
  const working =
    running ||
    generating ||
    !!state?.importJob.running ||
    state?.items.some((i) =>
      ['等候', '下载中', '待处理', '正在匹配', '正在保存', '正在校验'].includes(i.status),
    )
  useEffect(() => {
    if (working) {
      const t = setInterval(() => void host.state().then(setState), 200)
      return () => clearInterval(t)
    }
  }, [working])
  useEffect(() => {
    if (tab !== 'audition') return
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    function update() {
      clearTimeout(timer)
      void host
        .state()
        .then((next) => {
          if (alive) setState(next)
        })
        .catch((e) => {
          if (alive) setError(String(e))
        })
      const midnight = new Date()
      midnight.setHours(24, 0, 0, 0)
      timer = setTimeout(update, Math.max(1, midnight.getTime() - Date.now()))
    }
    update()
    window.addEventListener('focus', update)
    return () => {
      alive = false
      clearTimeout(timer)
      window.removeEventListener('focus', update)
    }
  }, [tab])
  const batchRows = (state?.items ?? []).filter((row) => row.batch === batch?.id)
  const savedDaily = (row: Item) => row.status === '已入库' && !!row.localAvailable && !!row.localId
  const legacyDaily = !batch?.targetCount && batchRows.some((row) => row.daily)
  const details =
    batch?.details ??
    (legacyDaily
      ? batchRows
          .filter((row) => row.daily && !savedDaily(row))
          .map((row) => {
            const messages = [
              row.downloadSummary || legacySummaries[row.diagnosis],
              row.downloadError,
            ].filter(Boolean)
            const reason = [...new Set(messages)].join(' · ') || row.status
            return `${row.title} · ${row.artist}：${reason}`
          })
          .join('\n')
      : '')
  const rows = batchRows
    .filter((row) => (row.daily ? savedDaily(row) : row.status !== '已在曲库'))
    .slice(0, batch?.targetCount ?? 5)
  const downloaded = [...new Set(rows.flatMap((r) => (r.daily && r.localId ? [r.localId] : [])))]
  async function forBatches(items: Item[], action: (batch: string) => Promise<unknown>) {
    for (const id of new Set(items.map((item) => item.batch))) await action(id)
  }
  const playlist = state?.playlists.find((p) => p.id === requestedCollection)
  const collection =
    requestedCollection === 'infrequent' ||
    ['recent', 'favorites'].includes(requestedCollection) ||
    playlist ||
    (requestedCollection !== 'all' &&
      state?.localTracks.some((track) => track.folder?.id === requestedCollection))
      ? requestedCollection
      : 'all'
  const memberIds = new Set(playlist?.tracks)
  const trackById = new Map((state?.localTracks ?? []).map((track) => [track.id, track]))
  const categoryRows = playlist
    ? playlistRows(playlist, trackById)
    : (state?.localTracks ?? []).filter(
        (row) =>
          (collection === 'all' && !!row.listed) ||
          (collection === 'favorites' && !!row.favorite) ||
          (collection === 'infrequent' &&
            !!row.listed &&
            (row.lastHeardAt ?? row.observedAt) <= Date.now() - infrequentDays * 86400000) ||
          memberIds.has(row.id) ||
          row.folder?.id === collection,
      )
  const localRows = categoryRows.filter((row) =>
    [row.title, row.artist, row.album].some((value) =>
      value.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
    ),
  )
  const queueable = (row: Item) => playable(row) || row.online
  const visibleQueue =
    tab === 'library'
      ? localRows.filter((row) => row.available).map((row) => row.id)
      : [...new Set(rows.filter(queueable).map((row) => row.localId ?? row.id))]
  const legacyQueue =
    state?.items
      .filter(
        (row) =>
          row.batch === state.items.find((item) => item.id === state.current)?.batch &&
          queueable(row),
      )
      .map((row) => row.id) ?? []
  const queue = state?.queue.length ? state.queue : legacyQueue
  const now = loadedId || state?.current || ''
  const available = new Set([
    ...(state?.localTracks ?? []).filter((t) => t.available).map((t) => t.id),
    ...(state?.items ?? []).filter(playable).map((t) => t.id),
  ])
  const order = shuffled ?? queue
  const index = occurrenceIndex(order, now, state?.queueOccurrence)
  const navigable = new Set([
    ...available,
    ...(state?.items ?? []).filter((r) => r.online).map((r) => r.id),
  ])
  const playableQueue = queue.filter((id) => navigable.has(id))
  function adjacentIndex(direction: number) {
    if (index < 0) return -1
    for (let step = 1; step < order.length; step++) {
      const next = index + step * direction
      if (!repeatOne && (next < 0 || next >= order.length)) break
      const position = (next + order.length) % order.length
      if (navigable.has(order[position])) return position
    }
    return -1
  }
  const following = adjacentIndex(1)
  const preceding = adjacentIndex(-1)
  function onQueue(input: string | string[], next: boolean) {
    const update = async () => {
      const latest = await host.state()
      const currentId = current.current || latest.current
      const added = new Set(typeof input === 'string' ? [input] : input)
      const albumIncludesCurrent = Array.isArray(input) && added.has(currentId)
      if (!albumIncludesCurrent) added.delete(currentId)
      function arrange(ids: string[]) {
        const currentIndex = occurrenceIndex(ids, currentId, latest.queueOccurrence)
        const result = ids.filter((key, i) => i === currentIndex || !added.has(key))
        if (currentId && !result.includes(currentId)) result.unshift(currentId)
        const anchor = occurrenceIndex(
          result,
          currentId,
          albumIncludesCurrent ? 0 : latest.queueOccurrence,
        )
        result.splice(next ? anchor + 1 : result.length, 0, ...added)
        return result
      }
      const ids = arrange(latest.queue.length ? latest.queue : legacyQueue)
      const pending = Array.isArray(input)
        ? input
        : latest.pendingAlbum.filter((id) => !added.has(id))
      await host.setQueue(ids, albumIncludesCurrent ? 0 : latest.queueOccurrence, pending)
      setShuffled((prev) => prev && arrange(prev))
      await refresh()
    }
    const op = switching.current.then(update)
    switching.current = op.catch((e) => setError(String(e)))
  }
  function startTrack(id: string, ids = visibleQueue) {
    if (current.current === id && audio.current) {
      ++epoch.current
      if (audio.current.paused) return audio.current.play()
      audio.current.pause()
      return Promise.resolve()
    }
    if (shuffled) setShuffled(shuffleQueue(ids, id))
    return play(id, ids)
  }
  function resumeOrStart() {
    if (!primary) return Promise.resolve()
    if (primary === now && queue.includes(primary))
      return navigate(primary, queue, state?.queueOccurrence, false, state?.pendingAlbum)
    if (queue.length && order.includes(primary))
      return navigate(primary, queue, state?.queueOccurrence, false, state?.pendingAlbum)
    if (shuffled) {
      const nextOrder = shuffleQueue(visibleQueue)
      setShuffled(nextOrder)
      return navigate(nextOrder[0], visibleQueue)
    }
    return navigate(primary, visibleQueue)
  }
  function play(
    id: string,
    ids = visibleQueue,
    occurrence = 0,
    restart = false,
    pendingAlbum: string[] = [],
  ) {
    const seq = ++epoch.current
    const run = async () => {
      const el = audio.current
      if (!el || seq !== epoch.current) return
      if (current.current === id) {
        if (restart) el.currentTime = 0
        await host.playQueue(id, ids, el.currentTime, occurrence, pendingAlbum)
        await el.play()
        return
      }
      if (current.current) await host.progress(current.current, el.currentTime, el.duration)
      const local = state?.localTracks.find((t) => t.id === id)
      const item = state?.items.find((r) => r.id === id)
      const stream = local || item?.online || item?.daily
      const src = stream
        ? await host.localSource(id)
        : URL.createObjectURL(new Blob([await host.bytes(id)], { type: 'audio/wav' }))
      if (seq !== epoch.current) {
        if (!stream) URL.revokeObjectURL(src)
        return
      }
      el.pause()
      if (url.current) URL.revokeObjectURL(url.current)
      current.current = id
      setLoadedId(id)
      url.current = stream ? '' : src
      const resume =
        id === state?.current &&
        state.position < (local?.duration ?? item?.audioDuration ?? 20) - 0.1
          ? state.position
          : 0
      el.src = src
      el.currentTime = resume
      setTime(resume)
      await host.playQueue(id, ids, resume, occurrence, pendingAlbum)
      await el.play()
    }
    const operation = switching.current.then(run)
    switching.current = operation.catch(() => {})
    return operation
  }
  async function navigate(
    id: string,
    ids: string[],
    occurrence = 0,
    restart = false,
    pendingAlbum: string[] = [],
  ) {
    const row = state?.items.find((r) => r.id === id)
    if (row?.online && !playable(row)) await audition(row, undefined, undefined, ids)
    else await play(id, ids, occurrence, restart, pendingAlbum)
  }
  function navigateAt(position: number) {
    const pending = state?.pendingAlbum ?? []
    const target = order[position]
    const at = position > index ? pending.indexOf(target) : -1
    return navigate(
      target,
      queue,
      occurrenceAt(order, position),
      true,
      at >= 0 ? pending.slice(at + 1) : [],
    )
  }
  async function next() {
    if (following >= 0) await navigateAt(following)
    else if (shuffled && playableQueue.length) {
      const round = shuffleQueue(playableQueue)
      if (round.length > 1 && round[0] === now) {
        const swap = 1 + Math.floor(Math.random() * (round.length - 1))
        ;[round[0], round[swap]] = [round[swap], round[0]]
      }
      setShuffled(round)
      await navigate(round[0], queue)
    }
  }
  async function finishTrack() {
    if (following > index && state?.pendingAlbum.includes(order[following])) {
      await navigateAt(following)
      return
    }
    if (repeatOne && audio.current && current.current) {
      audio.current.currentTime = 0
      await audio.current.play()
    } else await next()
  }
  async function end(clean = true) {
    ++epoch.current
    if (resolving) await host.lxCancel()
    const el = audio.current
    if (el) {
      el.pause()
      if (current.current) await host.progress(current.current, el.currentTime, el.duration)
      current.current = ''
      setLoadedId('')
      el.removeAttribute('src')
      el.load()
    }
    URL.revokeObjectURL(url.current)
    await host.release()
    if (clean) await host.clean()
  }
  const selected = rows.filter((i) => i.checked)
  const active =
    state?.localTracks.find((i) => i.id === now) ?? state?.items.find((i) => i.id === now)
  const localMode = active ? 'duration' in active : tab === 'library'
  const elapsed = current.current ? time : (state?.position ?? 0)
  const [lyricsOpen, setLyricsOpen] = useState(false)
  const previousTab = useRef('library')
  const showPlayer = tab === 'playing'
  const needLyrics = lyricsOpen || showPlayer
  const coverId = (active && ('duration' in active ? active.id : active.localId)) || undefined
  const favoriteTrack = coverId ? trackById.get(coverId) : undefined
  const favoriteButton = favoriteTrack && (
    <Button
      appearance="subtle"
      size="small"
      className="music-favorite"
      aria-label="收藏当前歌曲"
      aria-pressed={!!favoriteTrack.favorite}
      title={favoriteTrack.favorite ? '取消收藏' : '加入我的收藏'}
      icon={<Heart size={15} fill={favoriteTrack.favorite ? 'currentColor' : 'none'} />}
      onClick={() => void act(() => host.setFavorite(favoriteTrack.id, !favoriteTrack.favorite))}
    />
  )
  function openPlayer() {
    if (!showPlayer) previousTab.current = tab
    setGuide(null)
    setTab('playing')
    if (presentation === 'bar') void act(() => window.musicWindow.present('full'))
  }
  const [lyricsLocked, setLyricsLocked] = useState(false)
  useEffect(() => host.onLyricLocked(setLyricsLocked), [])
  const [lyrics, setLyrics] = useState<{
    id: string
    lines: [number, string][]
  }>()
  useEffect(() => {
    if (!needLyrics || !now) return
    let revision = 0
    function refreshLyrics() {
      const request = ++revision
      void host
        .lyrics(now)
        .then((lines) => {
          if (request === revision) setLyrics({ id: now, lines })
        })
        .catch(() => {
          if (request === revision) setLyrics({ id: now, lines: [] })
        })
    }
    const unsubscribe = host.onLyricsSaved(refreshLyrics)
    refreshLyrics()
    return () => {
      revision++
      unsubscribe()
    }
  }, [needLyrics, now])
  const lines = lyrics?.id === now ? lyrics.lines : undefined
  let activeLine = -1
  if (lines) {
    for (const [index, [at]] of lines.entries()) {
      if (at > elapsed) break
      activeLine = index
    }
  }
  const lyric = lines?.[activeLine]?.[1] ?? ''
  useEffect(() => {
    if (lyricsOpen) void host.lyricLine(lyric).catch(() => {})
  }, [lyric, lyricsOpen])
  const clock = formatTime
  const duration =
    audio.current?.duration ||
    (active ? ('duration' in active ? active.duration : (active.audioDuration ?? 20)) : 0)
  const primary =
    active && available.has(active.id)
      ? active.id
      : (order.find((id) => navigable.has(id)) ?? visibleQueue[0])
  const resumeLabel =
    !current.current && active && available.has(active.id)
      ? '从 ' + Math.floor(elapsed) + ' 秒继续'
      : '播放'
  function togglePlayback() {
    if (audio.current && !audio.current.paused) {
      ++epoch.current
      audio.current.pause()
    } else void act(resumeOrStart)
  }
  const transport = useEffectEvent((action: TransportAction) => {
    if (action === 'toggle') togglePlayback()
    else if (action === 'previous' && preceding >= 0) void act(() => navigateAt(preceding))
    else if (action === 'next' && canNext) void act(next)
  })
  useEffect(() => window.musicWindow.onTransport((action) => transport(action)), [])
  const canPrevious = preceding >= 0
  const canToggle = Boolean(primary)
  const canNext =
    !resolving && Boolean(following >= 0 || (shuffled && index >= 0 && playableQueue.length))
  const modeName = shuffled ? '随机播放' : repeatOne ? '单曲循环' : '顺序播放'
  const nextModeName = shuffled ? '单曲循环' : repeatOne ? '顺序播放' : '随机播放'
  useEffect(() => {
    window.musicWindow.thumbnailState({
      paused,
      previous: canPrevious,
      toggle: canToggle,
      next: canNext,
    })
  }, [paused, canPrevious, canToggle, canNext])
  async function audition(row: Item, key?: string, quality?: string, queueIds = visibleQueue) {
    const request = ++epoch.current
    setResolving(true)
    try {
      if (!key || !quality) {
        const result = await host.lxSearch(row.id)
        if (request !== epoch.current) return
        if (!result.items.length) throw Error('音乐源中没有找到此录音')
        const exact = result.items.filter(
          (v) =>
            v.title.trim().toLocaleLowerCase() === row.title.trim().toLocaleLowerCase() &&
            v.artist.trim().toLocaleLowerCase() === row.artist.trim().toLocaleLowerCase(),
        )
        if (exact.length !== 1) {
          setTab('audition')
          setOnline({ row, result, queueIds })
          return
        }
        key = exact[0].key
        quality = result.quality.includes('320k') ? '320k' : result.quality[0]
      }
      await host.lxPreview(row.id, key, quality)
      setOnline(undefined)
      await refresh()
      if (request === epoch.current) await play(row.id, queueIds)
    } catch (e) {
      if (request === epoch.current) throw e
    } finally {
      setResolving(false)
    }
  }
  return (
    <ComponentTheme
      surface={docked ? 'embedded' : 'window'}
      className={presentation === 'bar' ? 'music-shell music-bar-only' : 'music-shell'}
    >
      {!docked && (
        <header className="music-header">
          <div className="music-mark">
            <AudioLines size={21} />
          </div>
          <div className="music-heading">
            <h1>Music</h1>
            <small>
              {showPlayer
                ? '正在播放'
                : tab === 'download'
                  ? '在线下载'
                  : tab === 'library'
                    ? '本地音乐'
                    : tab === 'settings'
                      ? '设置'
                      : '每日推荐'}
            </small>
          </div>
        </header>
      )}
      <div className="music-navigation">
        <TabList
          className="music-tabs"
          aria-label="音乐页面"
          selectedValue={tab}
          onTabSelect={(_, data) => {
            setGuide(null)
            setTab(String(data.value))
          }}
        >
          <Tab value="library">本地曲库</Tab>
          <Tab value="download">下载音乐</Tab>
          <Tab value="audition">每日推荐</Tab>
          <Tab value="settings">设置</Tab>
        </TabList>
        <div className="music-view-actions">
          <span className="music-guide-trigger">
            <Button
              appearance="subtle"
              size="small"
              aria-label="使用引导"
              aria-describedby="music-guide-hint"
              icon={<CircleHelp size={17} />}
              onClick={() => {
                if (guide === null) guideOrigin.current = { tab, category: settingsCategory }
                visitGuide(0)
              }}
            />
            <span role="tooltip" id="music-guide-hint">
              打开 Music 使用引导
            </span>
          </span>
          <Button
            appearance="subtle"
            size="small"
            aria-label="只显示播放栏"
            title="只显示播放栏"
            icon={<PanelBottomClose size={17} />}
            onClick={() => void act(() => window.musicWindow.present('bar'))}
          />
          <Button
            appearance="subtle"
            size="small"
            aria-label="隐藏到后台"
            title="隐藏到后台"
            icon={<PanelTopClose size={17} />}
            onClick={() => void act(() => window.musicWindow.present('background'))}
          />
        </div>
      </div>
      {guide !== null && state && (
        <MusicGuide key={guide} step={guide} close={closeGuide} change={visitGuide} />
      )}
      <main key={tab} className="music-scroll">
        {showPlayer ? (
          <NowPlaying
            key={now}
            title={active?.title ?? '尚未播放'}
            artist={active?.artist ?? ''}
            coverId={coverId}
            revision={state?.albumRevision}
            lines={now ? lines : []}
            activeLine={activeLine}
            back={() => setTab(previousTab.current)}
          />
        ) : tab === 'library' ? (
          <LibraryPane
            albumRevision={state?.albumRevision ?? 0}
            favorite={(id, on) => act(() => host.setFavorite(id, on))}
            addFavorites={async (ids) => {
              let added = 0
              const ok = await act(async () => {
                added = await host.setFavorite(ids, true)
              })
              return ok ? added : null
            }}
            rows={localRows}
            total={categoryRows.length}
            tracks={state?.localTracks ?? []}
            sidebarOrder={state?.sidebarOrder}
            moveSidebarItem={(group, id, target, after) =>
              act(() => host.moveSidebarItem(group, id, target, after))
            }
            playlists={state?.playlists ?? []}
            setPlaylistSort={(id, sort, descending) =>
              act(() => host.setPlaylistSort(id, sort, descending))
            }
            movePlaylistTrack={(id, track, target, after) =>
              act(() => host.movePlaylistTrack(id, track, target, after))
            }
            collection={collection}
            days={infrequentDays}
            changeDays={setInfrequentDays}
            select={(id) => {
              setCollection(id)
              setSearch('')
              if (id === 'system-recommendations') void act(() => host.refreshLocal())
            }}
            create={(name) =>
              act(async () => {
                setCollection(await host.createPlaylist(name))
                setSearch('')
              })
            }
            membership={(list, id, added) => act(() => host.setMembership(list, id, added))}
            search={search}
            setSearch={setSearch}
            job={state?.importJob}
            active={now}
            playing={!paused}
            cancel={() => void act(() => host.cancelImport())}
            play={(id, ids) => void act(() => startTrack(id, ids))}
            relocate={(id) => void act(() => host.relocateLocal(id))}
            error={error}
            queueAlbumNext={(ids) => onQueue(ids, true)}
            onQueue={onQueue}
            dismiss={(id) => void act(() => host.dismissRecommendation(id))}
            playRow={(id) => void act(() => play(id, visibleQueue))}
            playAlbum={(id, ids) =>
              void act(() => {
                if (shuffled) setShuffled(shuffleQueue(ids, id))
                return play(id, ids)
              })
            }
            renameList={(id, name) => act(() => host.renamePlaylist(id, name))}
            deleteList={(id) => act(() => host.deletePlaylist(id))}
            openFolder={(id) => void act(() => host.openFolder(id))}
            removeFolder={(id) =>
              act(async () => {
                const removed = await host.removeFolder(id)
                if (removed.includes(current.current)) await end(false)
              })
            }
            remove={async (id, trash) => {
              let removed = false
              const ok = await act(async () => {
                if (trash) {
                  try {
                    if (!(await host.trashLocal(id))) return
                  } catch (error) {
                    const playing = current.current
                    if (playing) {
                      const latest = await host.state()
                      if (
                        current.current === playing &&
                        !latest.current &&
                        !latest.localTracks.some((row) => row.id === playing) &&
                        !latest.items.some((row) => row.id === playing && row.localId)
                      )
                        await end(false)
                    }
                    throw error
                  }
                } else await host.removeLocal(id)
                removed = true
                if (Array.isArray(id) ? id.includes(current.current) : id === current.current)
                  await end(false)
              })
              return ok && (removed || collection !== 'infrequent')
            }}
          />
        ) : tab === 'settings' ? (
          state && (
            <MusicSettings
              category={settingsCategory}
              selectCategory={(category) => {
                setGuide(null)
                setSettingsCategory(category)
              }}
              script={script}
              guideTarget={guide === null ? undefined : guideSteps[guide].target}
              models={state.models}
              prefs={state.prefs}
              job={state.importJob}
              refresh={refresh}
            />
          )
        ) : tab === 'download' ? (
          <DownloadPane
            preferredQuality={state?.prefs.quality}
            tracks={state?.localTracks ?? []}
            refresh={refresh}
          />
        ) : (
          <>
            {state && (
              <RecommendationComposer
                activeTarget={running ? batch?.targetCount : null}
                running={running}
                models={state.models}
                openSettings={() => openSettings('model')}
                initialDraft={state.draft}
                onGenerating={setGenerating}
                refresh={refresh}
              />
            )}
            <section className="music-list">
              <div className="music-section-head">
                <h2>本次推荐</h2>
              </div>
              {(batch?.targetCount || legacyDaily) && (
                <div className="music-batch-status">
                  {batch?.targetCount ? (
                    <p role="status">
                      已下载 {rows.length}/{batch.targetCount}
                      {batch.state === 'completed' && rows.length < batch.targetCount
                        ? '，部分已下载歌曲已移除或暂不可用'
                        : running && rows.length >= batch.targetCount
                          ? '，正在完成本批'
                          : batch.message && `，${batch.message}`}
                    </p>
                  ) : (
                    <p role="status">已下载 {downloaded.length} 首</p>
                  )}
                  {details && (
                    <details className="music-failure-details">
                      <summary>查看详情</summary>
                      <p>{details}</p>
                    </details>
                  )}
                </div>
              )}
              {rows.length > 0 ? (
                <>
                  <div className="music-tools">
                    {!batch?.targetCount && !legacyDaily && (
                      <small>
                        本次 {rows.length} 首 · 已下载 {downloaded.length}/{rows.length}
                      </small>
                    )}
                    {rows.some((r) => r.daily) && (
                      <Button
                        className="music-play-batch"
                        size="small"
                        disabled={!downloaded.length}
                        onClick={() => {
                          setShuffled(null)
                          void act(() => play(downloaded[0], downloaded))
                        }}
                      >
                        播放本次推荐
                      </Button>
                    )}
                    {rows.some((r) => r.status === '待匹配') && (
                      <Button
                        size="small"
                        onClick={() =>
                          void act(() =>
                            forBatches(
                              rows.filter((r) => r.status === '待匹配'),
                              host.match,
                            ),
                          )
                        }
                      >
                        匹配目录
                      </Button>
                    )}
                    {rows.some((row) => ['等候', '下载中'].includes(row.status)) && (
                      <Button
                        size="small"
                        onClick={() =>
                          void act(() =>
                            forBatches(
                              rows.filter((r) => ['等候', '下载中'].includes(r.status)),
                              host.cancelBatch,
                            ),
                          )
                        }
                      >
                        取消本批下载
                      </Button>
                    )}
                    {rows.some((r) => !r.daily) && (
                      <Button
                        size="small"
                        appearance="subtle"
                        disabled={!selected.length}
                        icon={<FolderPlus size={15} />}
                        onClick={() =>
                          void act(() =>
                            forBatches(
                              selected.filter((r) => !r.daily),
                              host.keep,
                            ),
                          )
                        }
                      >
                        保留所选（{selected.length}）
                      </Button>
                    )}
                  </div>
                  <ol>
                    {rows.map((r) => {
                      const version = r.candidates.find((t) => t.id === r.track)
                      return (
                        <TrackMenu
                          key={r.id}
                          queueable={playable(r)}
                          onQueue={(next) => onQueue(r.localId ?? r.id, next)}
                          onDismiss={() => void act(() => host.dismissRecommendation(r.id))}
                          dismissed={r.notInterested}
                        >
                          <li data-active={(r.localId ?? r.id) === active?.id}>
                            <div className="music-track-icon">
                              {playable(r) ? (
                                <Button
                                  appearance="subtle"
                                  icon={
                                    (r.localId ?? r.id) === current.current && !paused ? (
                                      <Pause size={16} />
                                    ) : (
                                      <Play size={16} />
                                    )
                                  }
                                  aria-label={
                                    ((r.localId ?? r.id) === current.current && !paused
                                      ? '暂停'
                                      : '试听') + r.title
                                  }
                                  onClick={() => void act(() => startTrack(r.localId ?? r.id))}
                                />
                              ) : (
                                <Disc3 size={18} />
                              )}
                            </div>
                            <div className="music-track">
                              <div>
                                <strong>{r.title}</strong>
                                <span>{r.artist}</span>
                              </div>
                              <p>{r.reason}</p>
                              {r.status !== '模型推荐' && !(r.daily && r.status === '待重试') && (
                                <small>
                                  {r.status}
                                  {r.recordingAlbum
                                    ? ' · ' + r.recordingAlbum
                                    : version
                                      ? ' · ' + version.album + ' · ' + version.version
                                      : ''}
                                </small>
                              )}
                              {r.online && !playable(r) && (
                                <Button
                                  size="small"
                                  disabled={resolving}
                                  onClick={() => void act(() => audition(r))}
                                >
                                  试听在线录音
                                </Button>
                              )}
                              {online?.row.id === r.id && (
                                <section className="music-versions" aria-label="选择试听版本">
                                  {online.result.items.map((v) => (
                                    <Button
                                      key={v.key}
                                      size="small"
                                      disabled={resolving}
                                      onClick={() =>
                                        void act(() =>
                                          audition(
                                            r,
                                            v.key,
                                            online.result.quality.includes('320k')
                                              ? '320k'
                                              : online.result.quality[0],
                                            online.queueIds,
                                          ),
                                        )
                                      }
                                    >
                                      {[v.title, v.artist, v.album].filter(Boolean).join(' · ')} ·
                                      试听
                                    </Button>
                                  ))}
                                  <Button
                                    size="small"
                                    onClick={() => {
                                      if (resolving) void host.lxCancel()
                                      setOnline(undefined)
                                    }}
                                  >
                                    取消
                                  </Button>
                                </section>
                              )}
                              {r.status === '待选版本' && (
                                <div className="music-versions">
                                  {r.candidates.map((t) => (
                                    <Button
                                      key={t.id}
                                      size="small"
                                      onClick={() => void act(() => host.choose(r.id, t.id))}
                                    >
                                      {t.album} · {t.version}
                                    </Button>
                                  ))}
                                </div>
                              )}
                              {['等候', '下载中'].includes(r.status) && (
                                <Button
                                  size="small"
                                  onClick={() => void act(() => host.cancel(r.id))}
                                >
                                  取消
                                </Button>
                              )}
                              {!r.online &&
                                ['已过期', '文件缺失', '已取消', '中断', '下载失败'].includes(
                                  r.status,
                                ) && (
                                  <Button
                                    size="small"
                                    onClick={() => void act(() => host.retry(r.id))}
                                  >
                                    重新获取
                                  </Button>
                                )}
                            </div>
                            {!r.daily && playable(r) && (
                              <Checkbox
                                aria-label="保留"
                                title={'保留' + r.title}
                                checked={!!r.checked}
                                onChange={(_, v) =>
                                  void act(() => host.checked(r.id, v.checked === true))
                                }
                              />
                            )}
                          </li>
                        </TrackMenu>
                      )
                    })}
                  </ol>
                </>
              ) : (
                <div className="music-empty">
                  <ListMusic size={24} />
                  <p>
                    {running
                      ? '正在查找可下载的新歌…'
                      : state?.batches.length
                        ? '本次尚无新歌入库'
                        : '生成后，这里会显示本次推荐'}
                  </p>
                </div>
              )}
            </section>
          </>
        )}
      </main>
      <footer className="music-player">
        <div className="music-transport">
          <div className="music-disc">
            <Cover key={state?.albumRevision} id={coverId} track />
          </div>
          <div className="music-heading">
            {active ? (
              <button
                type="button"
                className="music-title-link"
                onClick={openPlayer}
                title="打开播放页"
              >
                <strong>{active.title}</strong>
              </button>
            ) : (
              <strong>尚未播放</strong>
            )}
            <small>{active?.artist ?? '试听播放器'}</small>
          </div>
          <Button
            appearance="subtle"
            size="small"
            className="music-order"
            aria-label={`当前${modeName}，切换为${nextModeName}`}
            title={`当前${modeName}，切换为${nextModeName}`}
            icon={
              shuffled ? (
                <Shuffle size={17} />
              ) : repeatOne ? (
                <Repeat1 size={17} />
              ) : (
                <ListOrdered size={17} />
              )
            }
            onClick={() => {
              void host.setRepeatOne(!!shuffled).catch((e) => setError(String(e)))
              setRepeatOne(!!shuffled)
              setShuffled(
                !shuffled && !repeatOne
                  ? shuffleQueue(queue.length ? queue : visibleQueue, now)
                  : null,
              )
            }}
          >
            <span>{modeName}</span>
          </Button>
          <Button
            size="small"
            appearance="subtle"
            aria-label={lyricsLocked ? '解锁桌面歌词' : '桌面歌词'}
            title={lyricsLocked ? '解锁桌面歌词，恢复拖动' : '桌面歌词'}
            icon={
              <span className="music-lyric-glyph" aria-hidden="true">
                词
              </span>
            }
            aria-pressed={lyricsOpen}
            onClick={() =>
              void act(async () => {
                if (lyricsLocked) {
                  await host.unlockLyrics()
                  return
                }
                await host.showLyrics(!lyricsOpen)
                setLyricsOpen(!lyricsOpen)
              })
            }
          >
            {lyricsLocked && '解锁'}
          </Button>
          <PlaybackQueue
            active={active}
            tracks={state?.localTracks}
            items={state?.items}
            order={order}
            index={index}
            navigable={navigable}
          />

          <Button
            appearance="subtle"
            aria-label="上一首"
            title="上一首"
            icon={<SkipBack size={17} />}
            disabled={preceding < 0}
            onClick={() => {
              if (preceding >= 0) void act(() => navigateAt(preceding))
            }}
          />
          <Button
            appearance="primary"
            shape="circular"
            disabled={!primary}
            aria-label={paused ? resumeLabel : '暂停'}
            title={paused ? resumeLabel : '暂停'}
            icon={paused ? <Play size={16} /> : <Pause size={16} />}
            onClick={togglePlayback}
          />
          <Button
            appearance="subtle"
            aria-label="下一首"
            title="下一首"
            icon={<SkipForward size={17} />}
            disabled={!canNext}
            onClick={() => void act(next)}
          />
          <Button
            appearance="subtle"
            aria-label={localMode ? '停止播放' : '结束试听并清理缓存'}
            title={localMode ? '停止播放' : '结束试听并清理缓存'}
            icon={<Square size={14} />}
            disabled={!resolving && (localMode ? !current.current : !state?.items.some(playable))}
            onClick={() => void act(() => end(!localMode))}
          />
          {presentation === 'bar' && (
            <Button
              appearance="subtle"
              size="small"
              aria-label="展开 Music"
              title="展开 Music"
              icon={<PanelTopOpen size={17} />}
              onClick={() => void act(() => window.musicWindow.present('full'))}
            />
          )}
        </div>
        <div className="music-seek">
          <span>{clock(elapsed)}</span>
          <Slider
            aria-label="播放进度"
            min={0}
            max={duration || 1}
            step={0.1}
            value={elapsed}
            disabled={!current.current}
            onChange={(_, d) => {
              if (audio.current) audio.current.currentTime = d.value
            }}
          />
          <span>{clock(duration)}</span>
          {state && <VolumeControls initial={state.prefs} audio={audio} onError={setError} />}
        </div>
        <audio
          ref={audio}
          preload="metadata"
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          onTimeUpdate={(e) => {
            setTime(e.currentTarget.currentTime)
            if (current.current)
              void host.progress(
                current.current,
                e.currentTarget.currentTime,
                e.currentTarget.duration,
              )
          }}
          onError={(e) => {
            if (!current.current) return
            setError('音频播放失败，请检查文件是否可用')
            const src = e.currentTarget.currentSrc
            if (src.startsWith('fitbay-audio:')) {
              const id = current.current
              current.current = ''
              setLoadedId('')
              void (
                e.currentTarget.error?.code === 4 || e.currentTarget.readyState === 0
                  ? host.mediaFailed(id, src)
                  : host.release()
              )
                .then(refresh)
                .catch((e) => setError(String(e)))
            }
          }}
          onEnded={() => void act(finishTrack)}
        >
          <track kind="captions" />
        </audio>
        <p role="status">{error}</p>
      </footer>
    </ComponentTheme>
  )
}
const root = document.getElementById('root')
if (root) createRoot(root).render(<Music />)
