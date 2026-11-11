import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Button,
  Checkbox,
  Dropdown,
  Option,
  Slider,
  Input,
  Tab,
  TabList,
} from '@fluentui/react-components'
import { ComponentTheme, configureBackdrop } from '../../src/renderer/src/app/ComponentTheme'
import {
  AudioLines,
  Disc3,
  Play,
  Pause,
  SkipForward,
  PanelLeft,
  ArrowUpRight,
  ChevronDown,
  FolderPlus,
  Square,
  ListMusic,
  ChevronRight,
} from 'lucide-react'
import { LibraryPane, formatTime, type LocalTrack, type ImportJob } from './LibraryPane'
import './style.css'
type Batch = { id: string; day: string; preference: string }
type Track = { id: string; artist: string; title: string; album: string; version: string }
type Item = {
  id: string
  batch: string
  title: string
  artist: string
  reason: string
  track: string
  status: string
  checked: number
  candidates: Track[]
}
type State = {
  items: Item[]
  batches: Batch[]
  summary: string[]
  draft: string
  current: string
  position: number
  localTracks: LocalTrack[]
  importJob: ImportJob
  queue: string[]
  hasLibrary: boolean
}
type Mode = { mode: string }
declare global {
  interface Window {
    music: {
      importLocal(mode: 'folder' | 'files'): Promise<void>
      cancelImport(): Promise<void>
      refreshLocal(): Promise<void>
      removeLocal(id: string): Promise<void>
      relocateLocal(id: string): Promise<void>
      mediaFailed(id: string, url: string): Promise<void>
      localSource(id: string): Promise<string>
      playQueue(id: string, ids: string[], position: number): Promise<void>
      state(): Promise<State>
      draft(s: string): Promise<void>
      generate(s: string, summary?: string[]): Promise<string>
      stopGeneration(): Promise<void>
      match(id: string): Promise<void>
      choose(id: string, track: string): Promise<void>
      retry(id: string): Promise<void>
      cancel(id: string): Promise<void>
      cancelBatch(batch: string): Promise<void>
      bytes(id: string): Promise<Uint8Array<ArrayBuffer>>
      progress(id: string, time: number, duration: number): Promise<void>
      release(): Promise<void>
      clean(): Promise<void>
      checked(id: string, on: boolean): Promise<void>
      keep(batch: string): Promise<void>
    }
    musicWindow: {
      status(): Promise<Mode>
      transfer(action: string): Promise<{ ok: boolean; error?: string }>
      subscribe(fn: (v: Mode) => void): () => void
    }
  }
}
configureBackdrop()
const host = window.music
const playable = (row: Item) => ['已入库', '就绪'].includes(row.status)
function Music() {
  const [state, setState] = useState<State>(),
    [draft, setDraft] = useState(''),
    [batch, setBatch] = useState(''),
    [include, setInclude] = useState(false),
    [preview, setPreview] = useState(false),
    [paused, setPaused] = useState(true),
    [time, setTime] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [docked, setDocked] = useState(false)
  const [tab, setTab] = useState('library'),
    [search, setSearch] = useState('')
  const switching = useRef(Promise.resolve())
  const audio = useRef<HTMLAudioElement>(null),
    current = useRef(''),
    epoch = useRef(0),
    url = useRef('')
  const refresh = async () => setState(await host.state())
  async function act(fn: () => Promise<unknown>) {
    try {
      setError('')
      await fn()
      await refresh()
    } catch (e) {
      setError(String(e).replace(/^Error:.*?Error: /, ' '))
      await refresh().catch(() => {})
    }
  }
  useEffect(() => {
    void host
      .state()
      .then((s) => {
        setDraft(s.draft)
        setState(s)
        setBatch(s.items.find((i) => i.id === s.current)?.batch ?? s.batches[0]?.id ?? '')
      })
      .catch((e) => setError(String(e)))
    const mode = (v: Mode) => setDocked(v.mode === 'docked')
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
  const working =
    !!state?.importJob.running || state?.items.some((i) => ['等候', '下载中'].includes(i.status))
  useEffect(() => {
    if (working) {
      const t = setInterval(() => void host.state().then(setState), 200)
      return () => clearInterval(t)
    }
  }, [working])
  const rows = state?.items.filter((i) => i.batch === batch) ?? []
  const localRows = (state?.localTracks ?? []).filter((row) =>
    [row.title, row.artist, row.album].some((value) =>
      value.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
    ),
  )
  const visibleQueue =
    tab === 'library'
      ? localRows.filter((row) => row.available).map((row) => row.id)
      : rows.filter(playable).map((row) => row.id)
  const legacyQueue =
    state?.items
      .filter(
        (row) =>
          row.batch === state.items.find((item) => item.id === state.current)?.batch &&
          playable(row),
      )
      .map((row) => row.id) ?? []
  const queue = state?.queue.length ? state.queue : legacyQueue
  const now = current.current || state?.current || ''
  const available = new Set([
    ...(state?.localTracks ?? []).filter((t) => t.available).map((t) => t.id),
    ...(state?.items ?? []).filter(playable).map((t) => t.id),
  ])
  const following = queue.slice(queue.indexOf(now) + 1).find((id) => available.has(id))
  function play(id: string, ids = visibleQueue) {
    const seq = ++epoch.current
    const run = async () => {
      const el = audio.current
      if (!el || seq !== epoch.current) return
      if (current.current === id) {
        await host.playQueue(id, ids, el.currentTime)
        await el.play()
        return
      }
      if (current.current) await host.progress(current.current, el.currentTime, el.duration)
      const local = state?.localTracks.find((t) => t.id === id)
      const src = local
        ? await host.localSource(id)
        : URL.createObjectURL(new Blob([await host.bytes(id)], { type: 'audio/wav' }))
      if (seq !== epoch.current) {
        if (!local) URL.revokeObjectURL(src)
        return
      }
      el.pause()
      if (url.current) URL.revokeObjectURL(url.current)
      current.current = id
      url.current = local ? '' : src
      const resume =
        id === state?.current && state.position < (local?.duration ?? 20) - 0.1 ? state.position : 0
      el.src = src
      el.currentTime = resume
      await host.playQueue(id, ids, resume)
      await el.play()
    }
    const operation = switching.current.then(run)
    switching.current = operation.catch(() => {})
    return operation
  }
  async function next() {
    if (following) await play(following, queue)
  }
  async function end(clean = true) {
    ++epoch.current
    const el = audio.current
    if (el) {
      el.pause()
      if (current.current) await host.progress(current.current, el.currentTime, el.duration)
      current.current = ''
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
  const chosenBatch = state?.batches.find((b) => b.id === batch)
  const elapsed = current.current ? time : (state?.position ?? 0)
  const clock = formatTime
  const duration =
    audio.current?.duration || (active ? ('duration' in active ? active.duration : 20) : 0)
  const primary = active && available.has(active.id) ? active.id : visibleQueue[0]
  const resumeLabel =
    !current.current && active && available.has(active.id)
      ? '从 ' + Math.floor(elapsed) + ' 秒继续'
      : '播放'
  async function generate() {
    setBusy(true)
    try {
      setBatch(await host.generate(draft, include ? state?.summary : undefined))
      setInclude(false)
      setPreview(false)
    } finally {
      setBusy(false)
    }
  }
  return (
    <ComponentTheme surface={docked ? 'embedded' : 'window'} className="music-shell">
      <header className="music-header">
        <div className="music-mark">
          <AudioLines size={21} />
        </div>
        <div className="music-heading">
          <h1>音乐试听</h1>
          <small>{tab === 'library' ? '本地音乐' : '离线合成曲库'}</small>
        </div>
        <Button
          appearance="subtle"
          icon={docked ? <ArrowUpRight size={16} /> : <PanelLeft size={16} />}
          onClick={() =>
            void act(async () => {
              const r = await window.musicWindow.transfer(docked ? 'detach' : 'attach')
              if (!r.ok) throw Error(r.error)
            })
          }
        >
          {docked ? '分离窗口' : '加入工作台'}
        </Button>
      </header>
      <TabList
        className="music-tabs"
        aria-label="音乐页面"
        selectedValue={tab}
        onTabSelect={(_, data) => setTab(String(data.value))}
      >
        <Tab value="library">本地曲库</Tab>
        <Tab value="audition">推荐试听</Tab>
      </TabList>
      <main className="music-scroll">
        {tab === 'library' ? (
          <LibraryPane
            rows={localRows}
            total={state?.localTracks.length ?? 0}
            search={search}
            setSearch={setSearch}
            job={state?.importJob}
            active={now}
            playing={!paused}
            importFiles={(mode) => void act(() => host.importLocal(mode))}
            cancel={() => void act(() => host.cancelImport())}
            play={(id) => void act(() => play(id))}
            relocate={(id) => void act(() => host.relocateLocal(id))}
            remove={(id) =>
              void act(async () => {
                if (current.current === id) await end(false)
                await host.removeLocal(id)
              })
            }
          />
        ) : (
          <>
            <section className="music-compose">
              <h2>
                <label htmlFor="preference">今天想听什么</label>
              </h2>
              <div className="music-input">
                <Input
                  id="preference"
                  maxLength={1000}
                  value={draft}
                  placeholder="输入心情、风格或喜欢的艺人"
                  onChange={(_, d) => {
                    setDraft(d.value)
                    void host.draft(d.value).catch((e) => setError(String(e)))
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing && draft.trim() && !busy)
                      void act(generate)
                  }}
                />
                <Button
                  appearance="primary"
                  disabled={busy || !draft.trim()}
                  icon={<ListMusic size={16} />}
                  onClick={() => void act(generate)}
                >
                  生成离线试听单
                </Button>
              </div>
              <Button
                className="music-summary"
                size="small"
                appearance="transparent"
                aria-expanded={preview}
                icon={preview ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                onClick={() => setPreview(!preview)}
              >
                预览曲库摘要{include ? ' · 已附加' : ''}
              </Button>
              {preview && (
                <div className="music-summary-content">
                  <p>{state?.summary.join('；') || '音乐库为空'}</p>
                  <Checkbox
                    disabled={!state?.summary.length}
                    label="本次附加以上摘要"
                    checked={include}
                    onChange={(_, v) => setInclude(v.checked === true)}
                  />
                </div>
              )}
              {busy && (
                <Button size="small" onClick={() => void host.stopGeneration()}>
                  取消生成
                </Button>
              )}
            </section>
            <section className="music-list">
              <div className="music-section-head">
                <h2>推荐记录</h2>
                {chosenBatch && (
                  <Dropdown
                    size="small"
                    inlinePopup
                    aria-label="推荐记录"
                    listbox={{ className: 'component-popup' }}
                    value={chosenBatch.day + ' · ' + chosenBatch.preference}
                    selectedOptions={[batch]}
                    onOptionSelect={(_, d) => d.optionValue && setBatch(d.optionValue)}
                  >
                    {state?.batches.map((b) => (
                      <Option key={b.id} value={b.id}>
                        {b.day + ' · ' + b.preference}
                      </Option>
                    ))}
                  </Dropdown>
                )}
              </div>
              {rows.length > 0 ? (
                <>
                  <div className="music-tools">
                    <small>{rows.length} 首曲目</small>
                    {rows.some((r) => r.status === '待匹配') && (
                      <Button size="small" onClick={() => void act(() => host.match(batch))}>
                        匹配目录
                      </Button>
                    )}
                    {rows.some((row) => ['等候', '下载中'].includes(row.status)) && (
                      <Button size="small" onClick={() => void act(() => host.cancelBatch(batch))}>
                        取消本批下载
                      </Button>
                    )}
                    <Button
                      size="small"
                      appearance="subtle"
                      disabled={!selected.length}
                      icon={<FolderPlus size={15} />}
                      onClick={() => void act(() => host.keep(batch))}
                    >
                      保留所选（{selected.length}）
                    </Button>
                  </div>
                  <ol>
                    {rows.map((r) => {
                      const version = r.candidates.find((t) => t.id === r.track)
                      return (
                        <li key={r.id} data-active={r.id === active?.id}>
                          <div className="music-track-icon">
                            {playable(r) ? (
                              <Button
                                appearance="subtle"
                                icon={
                                  r.id === current.current && !paused ? (
                                    <AudioLines size={18} />
                                  ) : (
                                    <Play size={16} />
                                  )
                                }
                                aria-label={'试听' + r.title}
                                onClick={() => void act(() => play(r.id))}
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
                            <small>
                              {r.status}
                              {version ? ' · ' + version.album + ' · ' + version.version : ''}
                            </small>
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
                            {['已过期', '文件缺失', '已取消', '中断', '下载失败'].includes(
                              r.status,
                            ) && (
                              <Button size="small" onClick={() => void act(() => host.retry(r.id))}>
                                重新获取
                              </Button>
                            )}
                          </div>
                          {playable(r) && (
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
                      )
                    })}
                  </ol>
                </>
              ) : (
                <div className="music-empty">
                  <ListMusic size={24} />
                  <p>生成的试听单会按日期保存在这里</p>
                </div>
              )}
            </section>
          </>
        )}
      </main>
      <footer className="music-player">
        <div className="music-transport">
          <div className="music-disc">
            <Disc3 size={23} />
          </div>
          <div className="music-heading">
            <strong>{active?.title ?? '尚未播放'}</strong>
            <small>{active?.artist ?? '试听播放器'}</small>
          </div>
          <Button
            appearance="primary"
            shape="circular"
            disabled={!primary}
            aria-label={paused ? resumeLabel : '暂停'}
            title={paused ? resumeLabel : '暂停'}
            icon={paused ? <Play size={16} /> : <Pause size={16} />}
            onClick={() => {
              if (!paused) audio.current?.pause()
              else if (primary)
                void act(() =>
                  play(primary, primary === now && queue.includes(primary) ? queue : visibleQueue),
                )
            }}
          />
          <Button
            appearance="subtle"
            aria-label="下一首"
            title="下一首"
            icon={<SkipForward size={17} />}
            disabled={!following}
            onClick={() => void act(next)}
          />
          <Button
            appearance="subtle"
            aria-label={localMode ? '停止播放' : '结束试听并清理缓存'}
            title={localMode ? '停止播放' : '结束试听并清理缓存'}
            icon={<Square size={14} />}
            disabled={localMode ? !current.current : !state?.items.some(playable)}
            onClick={() => void act(() => end(!localMode))}
          />
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
              void (
                e.currentTarget.error?.code === 4 || e.currentTarget.readyState === 0
                  ? host.mediaFailed(id, src)
                  : host.release()
              )
                .then(refresh)
                .catch((e) => setError(String(e)))
            }
          }}
          onEnded={() => void act(next)}
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
