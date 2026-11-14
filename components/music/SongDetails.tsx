import { useMusicFeedback } from './musicFeedback'
import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Dialog,
  DialogBody,
  DialogActions,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Option,
  Tab,
  TabList,
} from '@fluentui/react-components'
import type { ReleaseActions } from './ReleaseCatalog'

type Person = { id: string | null; name: string; role: string }
type Work = { id: string; title: string }
type Version = Work & { artist: string; duration: number; detail: string; type: string }
type Song = {
  originalArtist?: string
  recording: string | null
  works: Work[]
  people: Person[]
  error: string
}
type WorkInfo = { title: string; people: Person[]; recordings: Version[] }
export interface SongAPI {
  songDetails(id: string): Promise<Song>
  workDetails(id: string): Promise<WorkInfo>
  personWorks(id: string | null, track: string, name: string): Promise<(Work & { role: string })[]>
}
const message = (e: unknown) => String(e).split('Error: ').at(-1) || '读取失败'
const norm = (s: string) => s.normalize('NFKC').trim().toLowerCase()
function Details({
  trackId,
  initial,
  actions,
}: {
  trackId: string
  initial: string
  actions: ReleaseActions
}) {
  const feedback = useMusicFeedback()
  const [tab, setTab] = useState(initial)
  const [song, setSong] = useState<Song>()
  const [workId, setWorkId] = useState('')
  const [work, setWork] = useState<WorkInfo>()
  const [person, setPerson] = useState<Person>()
  const [otherLimit, setOtherLimit] = useState(30)
  const [other, setOther] = useState<(Work & { role: string })[]>()
  const [source, setSource] = useState<{ id: string; key: string }>()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [workError, setWorkError] = useState('')
  const [status, setStatus] = useState('')
  const [retry, setRetry] = useState(0)
  const alive = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: explicit retry reloads metadata.
  useEffect(() => {
    let live = true
    alive.current = true
    setError('')
    setSong(undefined)
    void window.music
      .songDetails(trackId)
      .then((s) => {
        if (live) {
          setSong(s)
          setWorkId(s.works.length === 1 ? s.works[0].id : '')
        }
      })
      .catch((e) => {
        if (live) setError(message(e))
      })
    return () => {
      live = false
      alive.current = false
    }
  }, [trackId, retry])
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry reloads the work after a failed lookup.
  useEffect(() => {
    let live = true
    setWork(undefined)
    setWorkError('')
    setPerson(undefined)
    setSource(undefined)
    setStatus('')
    if (workId)
      void window.music
        .workDetails(workId)
        .then((w) => {
          if (live) setWork(w)
        })
        .catch((e) => {
          if (live) setWorkError(message(e))
        })
    return () => {
      live = false
    }
  }, [workId, retry])
  useEffect(() => {
    let live = true
    setOther(undefined)
    setOtherLimit(30)
    if (person)
      void window.music
        .personWorks(person.id, trackId, person.name)
        .then((rows) => {
          if (live) setOther(rows)
        })
        .catch((e) => {
          if (live) {
            setOther([])
            setStatus(message(e))
          }
        })
    return () => {
      live = false
    }
  }, [person, trackId])
  async function run(id: string, fn: () => Promise<void>) {
    setBusy(id)
    setStatus('')
    try {
      await fn()
    } catch (e) {
      if (alive.current) setStatus(feedback.error(e))
    } finally {
      if (alive.current) setBusy('')
    }
  }
  async function locate(v: Version) {
    setSource(undefined)
    const result = await window.music.lxSearch({ title: v.title, artist: v.artist })
    const matches = result.items.filter(
      (r) =>
        norm(r.artist) === norm(v.artist) &&
        norm(r.title) === norm(v.title) &&
        (r.quality === undefined || r.quality.length) &&
        (!r.duration || !v.duration || Math.abs(r.duration - v.duration) < 2),
    )
    // Distinct performances can share both title and performer. Require timing or the distinguishing caption.
    const siblings =
      work?.recordings.filter(
        (r) =>
          norm(r.artist) === norm(v.artist) && norm(r.title) === norm(v.title) && r.id !== v.id,
      ) ?? []
    const live = /(?:\blive\b|现场|現場|演唱会|演唱會|演奏会|concert|tour|ライブ)/iu
    const instrumental = /(?:instrumental|karaoke|off vocal|伴奏|器乐|純音樂|纯音乐|カラオケ)/iu
    const studio = /(?:studio recording|studio version|录音室|錄音室)/iu
    const match = matches.find((r) => {
      const description = [r.title, r.album].join(' ')
      const timing = !!r.duration && !!v.duration && Math.abs(r.duration - v.duration) < 2
      const caption = !!v.detail && norm(description).includes(norm(v.detail))
      if (v.type.includes('现场') && (!live.test(description) || studio.test(description)))
        return false
      if (v.type === '器乐版' && !instrumental.test(description)) return false
      if (!v.type.includes('现场') && live.test(description) && !live.test(v.title)) return false
      if (!instrumental.test(v.title) && v.type !== '器乐版' && instrumental.test(description))
        return false
      if (
        v.type === '音乐视频' &&
        !/(?:music video|\bmv\b|音乐视频|音樂錄影帶)/iu.test(description)
      )
        return false
      if (v.detail && !caption && !timing) return false
      return siblings.every((s) => {
        if (s.duration && r.duration) return Math.abs(r.duration - s.duration) >= 2
        if (caption && v.detail !== s.detail) return true
        return (
          timing &&
          !!r.album &&
          s.type === '现场' &&
          !v.type.includes('现场') &&
          !live.test(description)
        )
      })
    })
    if (!match) throw Error('未找到能确认版本的可播放音源。')
    if (alive.current) setSource({ id: v.id, key: match.key })
  }
  const people = [...(song?.people ?? []), ...(work?.people ?? [])].filter(
    (p, i, all) =>
      all.findIndex((q) => q.role === p.role && q.name === p.name && q.id === p.id) === i,
  )
  const versions = work?.recordings.filter((r) => r.id !== song?.recording)
  const otherRows = other?.filter(
    (row) => row.id !== song?.recording && !song?.works.some((w) => w.id === row.id),
  )
  return (
    <>
      <TabList
        selectedValue={tab}
        onTabSelect={(_, d) => {
          setTab(String(d.value))
          setStatus('')
        }}
      >
        <Tab value="versions">其他演绎</Tab>
        <Tab value="credits">参与人员</Tab>
      </TabList>
      {(error || song?.error || workError) && (
        <p role="alert">
          {error || song?.error || workError}{' '}
          <Button size="small" onClick={() => setRetry((n) => n + 1)}>
            重试
          </Button>
        </p>
      )}
      {song && song.works.length > 1 && (
        <Dropdown
          aria-label="选择作品"
          inlinePopup
          placeholder="选择作品"
          value={song.works.find((w) => w.id === workId)?.title ?? ''}
          selectedOptions={workId ? [workId] : []}
          onOptionSelect={(_, d) => setWorkId(d.optionValue ?? '')}
        >
          {song.works.map((w) => (
            <Option key={w.id} value={w.id}>
              {w.title}
            </Option>
          ))}
        </Dropdown>
      )}
      {!song && !error && <p role="status">正在读取歌曲资料…</p>}
      {song && workId && !work && !workError && <p role="status">正在读取作品关系…</p>}
      {tab === 'versions' ? (
        <>
          {work && <h3>{work.title}</h3>}
          {versions?.length ? (
            <ul>
              {versions.map((v) => (
                <li key={v.id}>
                  <div>
                    <strong>{v.title}</strong>
                    <small>
                      {[
                        v.artist,
                        v.type === '录音' && norm(v.artist) === norm(song?.originalArtist ?? '')
                          ? '原唱'
                          : v.type,
                        v.detail,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  </div>
                  {source?.id === v.id ? (
                    <>
                      <Button
                        size="small"
                        disabled={!!busy}
                        onClick={() => void run(v.id, () => actions.play(source.key))}
                      >
                        试听
                      </Button>
                      <Dropdown
                        aria-label="加入歌单"
                        size="small"
                        inlinePopup
                        value="加入歌单"
                        disabled={!!busy}
                        selectedOptions={[]}
                        onOptionSelect={(_, d) => {
                          const id = d.optionValue
                          if (id)
                            void run(v.id, async () => {
                              const added = await actions.add(id, source.key)
                              setStatus(feedback.membership(d.optionText ?? '', added))
                            })
                        }}
                      >
                        {actions.playlists.length ? (
                          actions.playlists.map((p) => (
                            <Option key={p.id} value={p.id}>
                              {p.name}
                            </Option>
                          ))
                        ) : (
                          <Option disabled>请先创建歌单</Option>
                        )}
                      </Dropdown>
                    </>
                  ) : (
                    <Button
                      size="small"
                      disabled={!!busy}
                      onClick={() => void run(v.id, () => locate(v))}
                    >
                      {busy === v.id ? '查找中…' : '查找音源'}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            song && (!song.works.length || work) && <p>资料不足，暂无可确认的其他演绎。</p>
          )}
        </>
      ) : (
        <>
          {people.length ? (
            <ul>
              {people.map((p) => (
                <li key={[p.id, p.name, p.role].join(':')}>
                  <span>{p.role}</span>
                  <Button
                    size="small"
                    appearance="subtle"
                    aria-pressed={person === p}
                    onClick={() => {
                      setPerson(p)
                      setStatus('')
                    }}
                  >
                    {p.name}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            song && <p>资料不足，暂无可确认的参与人员。</p>
          )}
          {person && (
            <section aria-label="参与的其他作品">
              <h3>{person.name}参与的其他作品</h3>
              {!person.id && <small>按本地文件同名署名查找</small>}
              {!otherRows ? (
                <p>正在读取…</p>
              ) : otherRows.length ? (
                <>
                  <ul>
                    {otherRows.slice(0, otherLimit).map((r) => (
                      <li key={r.id}>
                        <strong>{r.title}</strong>
                        <small>{r.role}</small>
                      </li>
                    ))}
                  </ul>
                  {otherRows.length > otherLimit && (
                    <Button size="small" onClick={() => setOtherLimit((n) => n + 30)}>
                      显示更多作品
                    </Button>
                  )}
                </>
              ) : (
                <p>暂无其他作品资料。</p>
              )}
            </section>
          )}
        </>
      )}
      {status && <p role="status">{status}</p>}
    </>
  )
}
export function SongDetails({ trackId, actions }: { trackId: string; actions: ReleaseActions }) {
  const [open, setOpen] = useState<{ id: string; tab: string }>()
  return (
    <div className="song-details-buttons">
      {[
        ['versions', '其他演绎'],
        ['credits', '参与人员'],
      ].map(([tab, label]) => (
        <Button
          key={tab}
          size="small"
          appearance="subtle"
          onClick={() => setOpen({ id: trackId, tab })}
        >
          {label}
        </Button>
      ))}
      <Dialog
        open={!!open}
        onOpenChange={(_, d) => {
          if (!d.open) setOpen(undefined)
        }}
      >
        <DialogSurface className="component-popup song-details">
          <DialogBody>
            <DialogTitle>歌曲资料</DialogTitle>
            <DialogContent>
              {open && <Details trackId={open.id} initial={open.tab} actions={actions} />}
            </DialogContent>
            <DialogActions>
              <Button size="small" onClick={() => setOpen(undefined)}>
                关闭
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  )
}
