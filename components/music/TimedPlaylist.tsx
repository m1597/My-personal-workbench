import { useMemo, useState } from 'react'
import { Button, Input, Popover, PopoverSurface, PopoverTrigger } from '@fluentui/react-components'
import { ChevronDown } from 'lucide-react'
import { formatTime, type LocalTrack, type PlaylistTrack } from './LibraryPane'

type Entry = { id: string; duration: number }

function fitTracks(rows: Entry[], seconds: number) {
  if (!Number.isSafeInteger(seconds) || seconds < 1) return []
  if (rows.reduce((sum, t) => sum + t.duration, 0) <= seconds) return rows
  // Round costs up so the actual full recordings always fit. Bound memory for long time slots.
  const unit = Math.max(1, Math.ceil(seconds / 32768))
  const capacity = Math.floor(seconds / unit)
  const last = new Int32Array(capacity + 1).fill(-1)
  last[0] = -2
  let best = 0
  for (const [i, row] of rows.entries()) {
    const cost = Math.ceil(row.duration / unit)
    for (let total = Math.min(capacity, best + cost); total >= cost; total--) {
      if (last[total] !== -1 || last[total - cost] === -1) continue
      last[total] = i
      best = Math.max(best, total)
    }
    if (best === capacity) break
  }
  const chosen: Entry[] = []
  while (best > 0) {
    const track = rows[last[best]]
    chosen.push(track)
    best -= Math.ceil(track.duration / unit)
  }
  return chosen.reverse()
}

export function TimedPlaylist({
  members,
  tracks,
  play,
}: {
  members: PlaylistTrack[]
  tracks: LocalTrack[]
  play(id: string, queue: string[], whole: boolean): void
}) {
  const [open, setOpen] = useState(false)
  const [minutes, setMinutes] = useState('25')
  const target = Number(minutes) * 60
  const valid =
    /^\d+(?:\.\d+)?$/.test(minutes) && Number.isSafeInteger(Math.round(target)) && target >= 1
  const candidates = useMemo(() => {
    if (!open) return []
    const local = new Map(tracks.map((t) => [t.id, t]))
    const seen = new Set<string>()
    const candidates: Entry[] = []
    for (const member of members) {
      const row = member.origin === 'online' ? local.get(member.localCopy ?? '') : member
      if (
        !row?.available ||
        !Number.isFinite(row.duration) ||
        row.duration <= 0 ||
        seen.has(row.id)
      )
        continue
      seen.add(row.id)
      candidates.push({ id: row.id, duration: row.duration })
    }
    return candidates
  }, [members, tracks, open])
  const preview = useMemo(
    () => (valid ? fitTracks(candidates, Math.floor(target)) : []),
    [candidates, target, valid],
  )
  const duration = preview.reduce((sum, t) => sum + t.duration, 0)
  return (
    <Popover open={open} onOpenChange={(_, d) => setOpen(d.open)} positioning="below-end">
      <PopoverTrigger disableButtonEnhancement>
        <Button
          size="small"
          aria-label="歌单播放选项"
          title="按可用时间排歌"
          icon={<ChevronDown size={15} />}
        />
      </PopoverTrigger>
      <PopoverSurface className="component-popup timed-playlist" aria-label="按可用时间排歌">
        <strong>按可用时间排歌</strong>
        <label>
          可用时间（分钟）
          <Input value={minutes} inputMode="decimal" onChange={(_, d) => setMinutes(d.value)} />
        </label>
        <p role="status">
          {!valid
            ? '请输入有效时长'
            : preview.length
              ? preview.length + ' 首 · 实际总时长 ' + formatTime(duration)
              : '没有能在这段时间内播完的本地歌曲'}
        </p>
        {preview.length > 0 && preview.length === candidates.length && duration + 1 <= target && (
          <small>已选全部可用本地歌曲，总时长短于你填写的时间。</small>
        )}
        <Button
          size="small"
          appearance="primary"
          disabled={!preview.length}
          onClick={() => {
            const ids = preview.map((t) => t.id)
            setOpen(false)
            play(ids[0], ids, true)
          }}
        >
          开始播放
        </Button>
      </PopoverSurface>
    </Popover>
  )
}
