import { songRow } from './songRow'
import { SongCredits } from './SongCredits'
import { TrackMenu } from './TrackMenu'
import { useState } from 'react'
import { Button, Popover, PopoverSurface, PopoverTrigger } from '@fluentui/react-components'
import { ListMusic, Play } from 'lucide-react'
type Song = {
  id: string
  title: string
  artist: string
  origin?: string
  localCopy?: string | null
  localId?: string | null
}
function localFile(song: Song) {
  if (song.origin === 'online') return song.localCopy ? song.id : null
  return song.origin ? song.id : song.localId
}
export function PlaybackQueue({
  onOpen,
  play,
  active,
  tracks,
  items,
  order,
  index,
  navigable,
}: {
  play(id: string, occurrence?: number): void
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
  const upcoming: { row: Song; occurrence: number }[] = []
  if (open) {
    const occurrences = new Map<string, number>()
    for (const [at, id] of order.entries()) {
      const occurrence = occurrences.get(id) ?? 0
      occurrences.set(id, occurrence + 1)
      const row = songs.get(id)
      if (at > index && row && navigable.has(id)) upcoming.push({ row, occurrence })
    }
  }
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
      <PopoverSurface
        data-song-list=""
        className="component-popup music-queue"
        aria-label="播放队列"
      >
        <strong>播放队列</strong>
        {active && (
          <TrackMenu localId={localFile(active)}>
            <p {...songRow(() => play(active.id))}>
              当前曲目 · <strong>{active.title}</strong>{' '}
              <Button
                appearance="subtle"
                size="small"
                icon={<Play size={14} />}
                aria-label={'播放' + active.title}
                onClick={() => play(active.id)}
              />
              · <SongCredits song={active} beforeOpen={() => setOpen(false)} />
            </p>
          </TrackMenu>
        )}
        <small>接下来</small>
        {upcoming.length ? (
          <ol>
            {upcoming.map(({ row, occurrence }) => {
              return (
                <TrackMenu key={row.id + ':' + occurrence} localId={localFile(row)}>
                  <li {...songRow(() => play(row.id, occurrence))}>
                    <strong>{row.title}</strong>{' '}
                    <Button
                      appearance="subtle"
                      size="small"
                      icon={<Play size={14} />}
                      aria-label={'播放' + row.title}
                      onClick={() => play(row.id, occurrence)}
                    />
                    · <SongCredits song={row} beforeOpen={() => setOpen(false)} />
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
