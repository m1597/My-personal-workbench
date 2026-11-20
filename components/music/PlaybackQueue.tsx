import { SongCredits } from './SongCredits'
import { useMusicFeedback } from './musicFeedback'
import { useState } from 'react'
import { Button, Popover, PopoverSurface, PopoverTrigger } from '@fluentui/react-components'
import { OnlineSongRow, RowPlay } from './OnlineSongRow'
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
  if (song.origin === 'online') return song.localCopy ? song.id : null
  return song.origin ? song.id : song.localId
}
function QueueSong({
  song,
  play,
  close,
  current = false,
}: {
  song: Song
  play(): void
  close(): void
  current?: boolean
}) {
  const feedback = useMusicFeedback()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const id = song.localId || song.id
  async function run(action: () => Promise<string>) {
    setBusy(true)
    setStatus('')
    try {
      setStatus(await action())
    } catch (error) {
      setStatus(feedback.error(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <OnlineSongRow
      className="queue-recording"
      busy={busy}
      localId={localFile(song) || undefined}
      canDownload={song.origin === 'online'}
      play={play}
      download={() =>
        void run(async () => {
          const [result] = await window.music.downloadSelection([id])
          if (result?.status === 'failed') throw Error(result.error)
          return feedback.text(
            result?.status === 'saved' ? '已下载并入库' : '已跳过',
            result?.status === 'saved' ? 'Downloaded to library' : 'Skipped',
          )
        })
      }
      add={(list, name) =>
        void run(async () => {
          const receipt = await window.music.setMembership(list, id, true)
          return feedback.membership(name, Boolean(receipt && 'added' in receipt && receipt.added))
        })
      }
    >
      <RowPlay title={song.title} id={current ? song.id : undefined} play={play} disabled={busy} />
      <div className="catalog-song-text">
        <strong>{song.title}</strong>
        <small>
          <SongCredits song={song} beforeOpen={close} />
        </small>
        {status && <small role="status">{status}</small>}
      </div>
    </OnlineSongRow>
  )
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
          <>
            <p>当前曲目</p>
            <ul className="queue-current">
              <QueueSong
                current
                song={active}
                play={() => play(active.id)}
                close={() => setOpen(false)}
              />
            </ul>
          </>
        )}
        <small>接下来</small>
        {upcoming.length ? (
          <ol>
            {upcoming.map(({ row, occurrence }) => {
              return (
                <QueueSong
                  key={row.id + ':' + occurrence}
                  song={row}
                  play={() => play(row.id, occurrence)}
                  close={() => setOpen(false)}
                />
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
