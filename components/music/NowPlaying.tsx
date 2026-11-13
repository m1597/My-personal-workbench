import { Button } from '@fluentui/react-components'
import { ArrowLeft } from 'lucide-react'
import { useLayoutEffect, useRef } from 'react'
import { Cover } from './AlbumBrowser'
import './now-playing.css'

type Props = {
  title: string
  artist: string
  coverId?: string
  revision?: number
  lines?: [number, string][]
  activeLine: number
  back: () => void
}

export function NowPlaying({ title, artist, coverId, revision, lines, activeLine, back }: Props) {
  const viewport = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const pane = viewport.current
    if (!pane || !lines?.length) return
    function align(smooth: boolean) {
      if (!pane) return
      const line = pane.children.item(activeLine) as HTMLParagraphElement | null
      const top = line ? line.offsetTop - (pane.clientHeight - line.offsetHeight) / 2 : 0
      pane.scrollTo({
        top,
        behavior:
          smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant',
      })
    }
    align(true)
    let width = pane.clientWidth
    let height = pane.clientHeight
    const observer = new ResizeObserver(() => {
      if (width === pane.clientWidth && height === pane.clientHeight) return
      width = pane.clientWidth
      height = pane.clientHeight
      align(false)
    })
    observer.observe(pane)
    return () => observer.disconnect()
  }, [lines, activeLine])
  return (
    <section className="now-playing" aria-label="播放页">
      <Button
        appearance="subtle"
        size="small"
        className="now-playing-back"
        icon={<ArrowLeft size={16} />}
        onClick={back}
      >
        返回
      </Button>
      <div className="now-playing-body">
        <div className="now-playing-record">
          <Cover key={revision} id={coverId} track fallback="./default-cover.png" />
          <h2>{title}</h2>
          {artist && <p>{artist}</p>}
        </div>
        {lines?.length ? (
          <section className="now-playing-lyrics" ref={viewport} aria-label="同步歌词">
            {lines.map(([at, text], index) => (
              <p key={at} aria-current={index === activeLine ? 'true' : undefined}>
                {text}
              </p>
            ))}
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
