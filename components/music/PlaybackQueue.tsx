import { TrackMenu } from './TrackMenu'
import { useState } from 'react'
import { Button, Popover, PopoverSurface, PopoverTrigger } from '@fluentui/react-components'
import { ListMusic } from 'lucide-react'
type Song = {
  id: string
  title: string
  artist: string
  origin?: string
  localCopy?: string | null
  localId?: string | null
}
function localFile(song: Song) {
  if (song.origin === 'online') return song.localCopy
  return song.origin ? song.id : song.localId
}
export function PlaybackQueue({
  onOpen,
  active,
  tracks,
  items,
  order,
  index,
  navigable,
}: {
  onOpen?: () => void
  active?: Song
  tracks?: Song[]
  items?: Song[]
  order: string[]
  index: number
  navigable: Set<string>
}) {
  const [open, setOpen] = useState(false)
  const songs = new Map<string, Song>()
  if (open) for (const row of [...(tracks ?? []), ...(items ?? [])]) songs.set(row.id, row)
  const upcoming = open
    ? order.slice(index + 1).filter((id) => navigable.has(id) && songs.has(id))
    : []
  const seen = new Set<string>()
  return (
    <Popover
      positioning="above"
      open={open}
      onOpenChange={(_, d) => {
        if (d.open) onOpen?.()
        setOpen(d.open)
      }}
    >
      <PopoverTrigger disableButtonEnhancement>
        <Button
          size="small"
          appearance="subtle"
          aria-label="播放队列"
          title="播放队列"
          icon={<ListMusic size={17} />}
        />
      </PopoverTrigger>
      <PopoverSurface className="component-popup music-queue" aria-label="播放队列">
        <strong>播放队列</strong>
        {active && (
          <TrackMenu localId={localFile(active)}>
            <p>
              当前曲目 · {active.title} · {active.artist}
            </p>
          </TrackMenu>
        )}
        <small>接下来</small>
        {upcoming.length ? (
          <ol>
            {upcoming.map((id) => {
              const row = songs.get(id)
              if (!row) return null
              const key = seen.has(id) ? id + ':repeat' : id
              seen.add(id)
              return (
                <TrackMenu key={key} localId={localFile(row)}>
                  <li>
                    {row.title} · {row.artist}
                  </li>
                </TrackMenu>
              )
            })}
          </ol>
        ) : (
          <p>没有待播歌曲</p>
        )}
      </PopoverSurface>
    </Popover>
  )
}
