import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Dropdown, Input, Option } from '@fluentui/react-components'
import type { LocalTrack } from '../../LibraryPane'
import './wave.css'

type Mark = { id: string; seconds: number; label: string }
type Wave = { peaks: number[]; duration: number }
type Props = {
  tracks: LocalTrack[]
  activeId?: string
  play: (id: string) => void
  audio: HTMLAudioElement | null
}
const call = (action: string, ...args: unknown[]) =>
  window.musicPlugins.call('wave', action, ...args)
const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max))
const clock = (s: number) =>
  Math.floor(s / 60) +
  ':' +
  Math.floor(s % 60)
    .toString()
    .padStart(2, '0') +
  '.' +
  Math.floor((s * 10) % 10)
const errorText = (err: unknown) => String(err).split('Error: ').pop() || '无法读取录音'

async function loadWave(id: string): Promise<Wave> {
  const result = (await call('audio', id)) as Wave | { bytes: Uint8Array }
  if ('peaks' in result) return result
  const context = new OfflineAudioContext(1, 1, 8000)
  const buffer = await context.decodeAudioData(new Uint8Array(result.bytes).buffer)
  const peaks = Array(Math.min(buffer.length, 1024)).fill(0)
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < peaks.length; i++) {
      let peak = peaks[i]
      const end = Math.floor(((i + 1) * data.length) / peaks.length)
      for (let j = Math.floor((i * data.length) / peaks.length); j < end; j++)
        peak = Math.max(peak, Math.abs(data[j]))
      peaks[i] = Math.min(1, peak)
    }
  }
  return { peaks, duration: buffer.duration }
}

export default function Waveform({ tracks, activeId, play, audio }: Props) {
  const [picked, setPicked] = useState(activeId)
  useEffect(() => {
    if (activeId) setPicked(activeId)
  }, [activeId])
  const local = tracks.filter((t) => t.available && t.listed)
  const track = local.find((t) => t.id === picked) ?? local[0]
  return (
    <section className="wave-plugin" aria-label="波形与片段试听">
      <h2>波形与片段试听</h2>
      {track ? (
        <>
          <Dropdown
            aria-label="分析歌曲"
            inlinePopup
            listbox={{ className: 'component-popup' }}
            value={track.title + ' · ' + track.artist}
            selectedOptions={[track.id]}
            onOptionSelect={(_, d) => setPicked(d.optionValue)}
          >
            {local.map((t) => (
              <Option key={t.id} value={t.id}>
                {t.title + ' · ' + t.artist}
              </Option>
            ))}
          </Dropdown>
          <Editor
            key={track.id}
            track={track}
            current={track.id === activeId}
            audio={audio}
            play={() => play(track.id)}
          />
        </>
      ) : (
        <p>本地曲库中还没有可分析的录音。</p>
      )}
    </section>
  )
}

function Editor({
  track,
  current,
  audio,
  play,
}: {
  track: LocalTrack
  current: boolean
  audio: HTMLAudioElement | null
  play: () => void
}) {
  const [wave, setWave] = useState<Wave>()
  const [marks, setMarks] = useState<Mark[]>([])
  const [notice, setNotice] = useState('')
  const [label, setLabel] = useState('')
  const [cursor, setCursor] = useState(current && audio?.src ? audio.currentTime : 0)
  const [interval, setInterval] = useState<[number, number] | null>(null)
  const [loop, setLoop] = useState(false)
  const [draft, setDraft] = useState<[number, number] | null>(null)
  const dragging = useRef<{ start: number; pixel: number; id: number } | null>(null)
  const pending = useRef<number | null>(null)
  const duration = wave?.duration || track.duration
  useEffect(() => {
    let live = true
    void loadWave(track.id)
      .then((r) => {
        if (live) setWave(r)
      })
      .catch((err) => {
        if (live) setNotice(errorText(err))
      })
    void call('marks', track.id)
      .then((r) => {
        if (live) setMarks(r as Mark[])
      })
      .catch((err) => {
        if (live) setNotice(errorText(err))
      })
    return () => {
      live = false
    }
  }, [track.id])
  useEffect(() => {
    if (!audio || !current) return
    const restore = () => {
      if (pending.current !== null && audio.readyState >= 1) {
        audio.currentTime = pending.current
        pending.current = null
      }
    }
    restore()
    const pos = () => {
      if (pending.current === null) setCursor(audio.currentTime)
    }
    audio.addEventListener('loadedmetadata', restore)
    audio.addEventListener('timeupdate', pos)
    audio.addEventListener('seeked', pos)
    return () => {
      audio.removeEventListener('loadedmetadata', restore)
      audio.removeEventListener('timeupdate', pos)
      audio.removeEventListener('seeked', pos)
    }
  }, [audio, current])
  useEffect(() => {
    if (!loop || !interval || !current || !audio) return
    const [start, end] = interval
    const rewind = () => {
      if (
        !audio.paused &&
        !audio.seeking &&
        (audio.currentTime >= end || audio.currentTime + 0.05 < start)
      )
        audio.currentTime = start
    }
    const finished = (e: Event) => {
      e.stopImmediatePropagation()
      audio.currentTime = start
      void audio.play().catch((err) => setNotice(errorText(err)))
    }
    const timer = window.setInterval(rewind, 35)
    audio.addEventListener('ended', finished, true)
    return () => {
      window.clearInterval(timer)
      audio.removeEventListener('ended', finished, true)
    }
  }, [loop, interval, current, audio])

  function seek(seconds: number, startPlayback = false) {
    const at = clamp(seconds, duration)
    setCursor(at)
    if (current && audio?.src && audio.readyState >= 1) {
      audio.currentTime = at
      if (startPlayback && audio.paused) void audio.play().catch((err) => setNotice(errorText(err)))
    } else {
      pending.current = at
      play()
    }
  }
  function position(el: HTMLInputElement, x: number) {
    const rect = el.getBoundingClientRect()
    return clamp(((x - rect.left) / rect.width) * duration, duration)
  }
  function setRange(a: number, b: number) {
    const start = clamp(Math.min(a, b), duration),
      end = clamp(Math.max(a, b), duration)
    if (end - start < 0.05) {
      setNotice('片段至少需要 0.05 秒')
      return
    }
    setInterval([start, end])
    setLoop(true)
    setNotice('')
    seek(start, true)
  }
  async function mark(action: 'addMark' | 'removeMark', ...args: unknown[]) {
    try {
      await call(action, track.id, ...args)
      setMarks((await call('marks', track.id)) as Mark[])
      if (action === 'addMark') setLabel('')
    } catch (err) {
      setNotice(errorText(err))
    }
  }
  const shape = useMemo(
    () =>
      wave?.peaks.map((p, i) => `M${i + 0.5} ${50 - p * 48}v${Math.max(0.65, p * 96)}`).join(' '),
    [wave],
  )
  const selection = draft ?? interval
  return (
    <>
      <p>点击波形定位，拖选一段波形循环试听。</p>
      <div className="wave-plot">
        {wave && (
          <svg
            aria-hidden="true"
            preserveAspectRatio="none"
            viewBox={`0 0 ${wave.peaks.length} 100`}
          >
            <path d={shape} fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        )}
        {selection && (
          <div
            className="wave-selection"
            style={{
              left: (Math.min(...selection) / duration) * 100 + '%',
              width: (Math.abs(selection[1] - selection[0]) / duration) * 100 + '%',
            }}
          />
        )}
        <div className="wave-cursor" style={{ left: (cursor / duration) * 100 + '%' }} />
        {marks.map((m) => (
          <i className="wave-pin" key={m.id} style={{ left: (m.seconds / duration) * 100 + '%' }} />
        ))}
        {!wave && !notice && <span>正在分析录音…</span>}
        <input
          type="range"
          aria-label="波形定位"
          aria-valuetext={clock(cursor)}
          min={0}
          max={duration}
          step={0.05}
          value={cursor}
          onChange={(e) => {
            if (!dragging.current) {
              setLoop(false)
              seek(Number(e.target.value))
            }
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.preventDefault()
            e.currentTarget.focus()
            e.currentTarget.setPointerCapture(e.pointerId)
            dragging.current = {
              start: position(e.currentTarget, e.clientX),
              pixel: e.clientX,
              id: e.pointerId,
            }
          }}
          onPointerMove={(e) => {
            const p = dragging.current
            if (p?.id === e.pointerId && Math.abs(e.clientX - p.pixel) >= 3)
              setDraft([p.start, position(e.currentTarget, e.clientX)])
          }}
          onPointerCancel={() => {
            dragging.current = null
            setDraft(null)
          }}
          onPointerUp={(e) => {
            const p = dragging.current
            if (!p || p.id !== e.pointerId) return
            e.preventDefault()
            dragging.current = null
            setDraft(null)
            const end = position(e.currentTarget, e.clientX)
            if (Math.abs(e.clientX - p.pixel) >= 3) setRange(p.start, end)
            else {
              setLoop(false)
              seek(end)
            }
          }}
        />
      </div>
      <div className="wave-scale">
        <span>0:00</span>
        <strong>{clock(cursor)}</strong>
        <span>{clock(duration)}</span>
      </div>
      <div className="wave-actions">
        <Button
          size="small"
          onClick={() => {
            setLoop(false)
            setInterval([cursor, interval && interval[1] > cursor ? interval[1] : duration])
          }}
        >
          设为 A 点
        </Button>
        <Button
          size="small"
          onClick={() => {
            const start = interval?.[0] ?? 0
            if (cursor <= start) {
              setNotice('B 点需要晚于 A 点')
              return
            }
            setRange(start, cursor)
          }}
        >
          设为 B 点
        </Button>
        <Button
          size="small"
          aria-pressed={loop}
          disabled={!interval || interval[1] - interval[0] < 0.05}
          onClick={() => {
            if (!loop && interval) seek(interval[0], true)
            setLoop(!loop)
          }}
        >
          {loop ? '关闭循环' : '循环片段'}
        </Button>
        {interval && (
          <small>
            {clock(interval[0])} – {clock(interval[1])}
          </small>
        )}
      </div>
      <h3>时间点标记</h3>
      <form
        className="wave-actions"
        onSubmit={(e) => {
          e.preventDefault()
          void mark('addMark', cursor, label)
        }}
      >
        <Input
          aria-label="标记名称"
          size="small"
          value={label}
          maxLength={80}
          placeholder="标记名称（可选）"
          onChange={(_, d) => setLabel(d.value)}
        />
        <Button size="small" type="submit">
          标记当前位置
        </Button>
      </form>
      {marks.length > 0 && (
        <ul>
          {marks.map((m) => (
            <li key={m.id}>
              <Button
                appearance="subtle"
                size="small"
                onClick={() => {
                  setLoop(false)
                  seek(m.seconds)
                }}
              >
                {clock(m.seconds)} {m.label}
              </Button>
              <Button
                appearance="subtle"
                size="small"
                aria-label={'删除标记 ' + clock(m.seconds)}
                onClick={() => void mark('removeMark', m.id)}
              >
                删除
              </Button>
            </li>
          ))}
        </ul>
      )}
      {notice && <p role="status">{notice}</p>}
    </>
  )
}
