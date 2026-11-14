import { Button, Popover, PopoverTrigger, PopoverSurface } from '@fluentui/react-components'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { defaultCover, requestCover } from './AlbumBrowser'
import { SongDetails } from './SongDetails'
import type { ReleaseActions } from './ReleaseCatalog'
import './now-playing.css'

const readingKeys = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'])

export type LyricLine = [number | null, string, string?]

type Props = {
  actions: ReleaseActions
  trackId: string
  title: string
  artist: string
  coverId?: string
  revision?: number
  lines?: LyricLine[]
  activeLine: number
  offset: number
  adjustTiming: (step: 'earlier' | 'later' | 'reset') => void
  seek: (at: number) => void
  back: () => void
}

function RecordArt({ id, revision = 0 }: { id?: string; revision?: number }) {
  const [art, setArt] = useState({ front: defaultCover, previous: '' })
  useEffect(() => {
    let live = true
    const load = async () => {
      const src = (id && (await requestCover(id, true, revision).catch(() => null))) || defaultCover
      const image = new Image()
      image.src = src
      const front = await image.decode().then(
        () => src,
        () => defaultCover,
      )
      if (live)
        setArt((current) =>
          current.front === front ? current : { front, previous: current.front },
        )
    }
    void load()
    return () => {
      live = false
    }
  }, [id, revision])
  return (
    <div className="record-art" aria-hidden="true">
      {art.previous && (
        <div className="record-art-layer">
          <img src={art.previous} alt="" />
          <img src={art.previous} alt="" />
        </div>
      )}
      <div
        key={art.front}
        className="record-art-layer record-art-current"
        onAnimationEnd={() =>
          setArt((current) =>
            current.front === art.front ? { ...current, previous: '' } : current,
          )
        }
      >
        <img src={art.front} alt="" />
        <span className="album-art">
          <img src={art.front} alt="" />
        </span>
      </div>
    </div>
  )
}

export function NowPlaying({
  actions,
  trackId,
  title,
  artist,
  coverId,
  revision,
  lines,
  activeLine,
  offset,
  adjustTiming,
  seek,
  back,
}: Props) {
  const viewport = useRef<HTMLElement>(null)
  const [following, setFollowing] = useState(true)
  const timed = lines?.[0]?.[0] != null
  const initialized = useRef(false)
  const frame = useRef(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: each new recording starts in follow mode.
  useLayoutEffect(() => {
    initialized.current = false
    setFollowing(true)
  }, [trackId])
  function browse() {
    cancelAnimationFrame(frame.current)
    setFollowing(false)
  }
  useLayoutEffect(() => {
    const pane = viewport.current
    if (!pane || !following || lines?.[0]?.[0] == null) return
    function align(animate: boolean) {
      if (!pane) return
      cancelAnimationFrame(frame.current)
      const line = pane.children.item(activeLine) as HTMLElement | null
      const destination = line ? line.offsetTop - (pane.clientHeight - line.offsetHeight) / 2 : 0
      const start = pane.scrollTop
      if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        pane.scrollTop = destination
        return
      }
      const began = performance.now()
      function step(now: number) {
        if (!pane) return
        const t = Math.min(1, (now - began) / 420)
        const eased = (1 - Math.cos(Math.PI * t)) / 2
        pane.scrollTop = start + (destination - start) * eased
        if (t < 1) frame.current = requestAnimationFrame(step)
      }
      frame.current = requestAnimationFrame(step)
    }
    align(initialized.current)
    initialized.current = true
    let width = pane.clientWidth
    let height = pane.clientHeight
    const observer = new ResizeObserver(() => {
      if (width === pane.clientWidth && height === pane.clientHeight) return
      width = pane.clientWidth
      height = pane.clientHeight
      align(false)
    })
    observer.observe(pane)
    return () => {
      cancelAnimationFrame(frame.current)
      observer.disconnect()
    }
  }, [activeLine, following, lines])
  return (
    <section className="now-playing" aria-label="播放页">
      <div className="now-playing-toolbar">
        <Button appearance="subtle" size="small" icon={<ArrowLeft size={16} />} onClick={back}>
          返回
        </Button>
        {trackId && <SongDetails trackId={trackId} actions={actions} />}
        {timed && (
          <Popover positioning="below-end">
            <PopoverTrigger disableButtonEnhancement>
              <Button size="small" appearance="subtle">
                歌词校准
              </Button>
            </PopoverTrigger>
            <PopoverSurface className="component-popup lyric-timing">
              <strong>当前录音的歌词时间</strong>
              <span role="status">
                {offset === 0
                  ? '原时间'
                  : (offset < 0 ? '提前 ' : '延后 ') + (Math.abs(offset) / 1000).toFixed(1) + ' 秒'}
              </span>
              <div>
                <Button
                  size="small"
                  disabled={offset <= -30000}
                  onClick={() => adjustTiming('earlier')}
                >
                  提前 0.5 秒
                </Button>
                <Button
                  size="small"
                  disabled={offset >= 30000}
                  onClick={() => adjustTiming('later')}
                >
                  延后 0.5 秒
                </Button>
              </div>
              <Button
                size="small"
                appearance="subtle"
                disabled={!offset}
                onClick={() => adjustTiming('reset')}
              >
                恢复原时间
              </Button>
            </PopoverSurface>
          </Popover>
        )}
        {timed && !following && (
          <Button appearance="subtle" size="small" onClick={() => setFollowing(true)}>
            回到当前歌词
          </Button>
        )}
      </div>
      <div className="now-playing-body">
        <div className="now-playing-record">
          <RecordArt revision={revision} id={coverId} />
          <h2>{title}</h2>
          {artist && <p>{artist}</p>}
        </div>
        <div className="now-playing-lyric-pane">
          {lines?.length ? (
            <section
              className="now-playing-lyrics"
              data-timed={timed}
              ref={viewport}
              aria-label={timed ? '同步歌词' : '歌词文本'}
              onKeyDown={(e) => {
                if (readingKeys.has(e.key)) {
                  e.stopPropagation()
                  if (timed) browse()
                }
              }}
              onFocus={(e) => {
                if (timed && e.target.matches('button:focus-visible:not([aria-current])')) {
                  browse()
                }
              }}
              onWheel={(e) => {
                if (timed && e.deltaY) browse()
              }}
              onTouchMove={() => {
                if (timed) browse()
              }}
            >
              {lines.map(([at, text], index) =>
                at === null ? (
                  // A plain transcript is immutable and may repeat the same line.
                  // biome-ignore lint/suspicious/noArrayIndexKey: text rows have no stable timestamp or local state.
                  <p key={index}>{text}</p>
                ) : (
                  <button
                    type="button"
                    key={at}
                    aria-current={index === activeLine ? 'true' : undefined}
                    onClick={() => {
                      setFollowing(true)
                      seek(Math.max(0, at + offset / 1000))
                    }}
                  >
                    {text}
                  </button>
                ),
              )}
            </section>
          ) : (
            <p className="now-playing-empty" role="status">
              {lines ? '暂无歌词' : '正在读取歌词…'}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
