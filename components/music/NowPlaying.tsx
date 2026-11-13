import { Button } from '@fluentui/react-components'
import { ArrowLeft } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { Cover } from './AlbumBrowser'
import './now-playing.css'

export type LyricLine = [number | null, string]

type Props = {
  title: string
  artist: string
  coverId?: string
  revision?: number
  lines?: LyricLine[]
  activeLine: number
  seek: (at: number) => void
  back: () => void
}

export function NowPlaying({
  title,
  artist,
  coverId,
  revision,
  lines,
  activeLine,
  seek,
  back,
}: Props) {
  const viewport = useRef<HTMLElement>(null)
  const [following, setFollowing] = useState(true)
  const timed = lines?.[0]?.[0] != null
  const initialized = useRef(false)
  useLayoutEffect(() => {
    const pane = viewport.current
    if (!pane || !following || lines?.[0]?.[0] == null) return
    let frame = 0
    function align(animate: boolean) {
      if (!pane) return
      cancelAnimationFrame(frame)
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
        if (t < 1) frame = requestAnimationFrame(step)
      }
      frame = requestAnimationFrame(step)
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
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [activeLine, following, lines])
  return (
    <section className="now-playing" aria-label="播放页">
      <div className="now-playing-toolbar">
        <Button appearance="subtle" size="small" icon={<ArrowLeft size={16} />} onClick={back}>
          返回
        </Button>
        {timed && !following && (
          <Button appearance="subtle" size="small" onClick={() => setFollowing(true)}>
            回到当前歌词
          </Button>
        )}
      </div>
      <div className="now-playing-body">
        <div className="now-playing-record">
          <Cover revision={revision} id={coverId} track />
          <h2>{title}</h2>
          {artist && <p>{artist}</p>}
        </div>
        {lines?.length ? (
          <section
            className="now-playing-lyrics"
            data-timed={timed}
            ref={viewport}
            aria-label={timed ? '同步歌词' : '歌词文本'}
            onWheel={(e) => {
              if (timed && e.deltaY) setFollowing(false)
            }}
            onTouchMove={() => {
              if (timed) setFollowing(false)
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
                    seek(at)
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
    </section>
  )
}
