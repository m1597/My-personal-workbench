import { Button, Slider } from '@fluentui/react-components'
import { Volume2, VolumeX } from 'lucide-react'
import { type FocusEvent, type RefObject, useLayoutEffect, useState } from 'react'
import type { MusicPreferences } from './MusicSettings'

export function VolumeControls({
  compact = false,
  stepRef,
  initial,
  audio,
  onError,
}: {
  stepRef: RefObject<((delta: number) => void) | null>
  compact?: boolean
  initial: Pick<MusicPreferences, 'volume' | 'muted'>
  audio: RefObject<HTMLAudioElement | null>
  onError: (error: string) => void
}) {
  const [{ volume, muted }, setOutput] = useState(() => ({
    volume: initial.volume,
    muted: initial.muted,
  }))
  const [expanded, setExpanded] = useState(false)
  useLayoutEffect(() => {
    if (audio.current) {
      audio.current.volume = volume / 100
      audio.current.muted = muted
    }
  }, [audio, volume, muted])
  function change(level: number, silent: boolean) {
    setOutput({ volume: level, muted: silent })
    void window.music.setMusicOutput(level, silent).catch(() => onError('音量设置未能保存'))
  }
  useLayoutEffect(() => {
    stepRef.current = (delta) => {
      const level = Math.max(0, Math.min(100, (muted ? 0 : volume) + delta))
      change(level || volume, level === 0)
    }
    return () => {
      stepRef.current = null
    }
  })
  function leave(event: FocusEvent<HTMLElement>) {
    if (!event.currentTarget.closest('.music-volume')?.contains(event.relatedTarget))
      setExpanded(false)
  }
  return (
    <div className="music-volume" data-expanded={compact && expanded}>
      <Button
        appearance="subtle"
        size="small"
        onBlur={leave}
        aria-label={compact ? '调节音量' : '静音'}
        aria-expanded={compact ? expanded : undefined}
        aria-pressed={compact ? undefined : muted}
        title={compact ? '调节音量' : muted ? '取消静音' : '静音'}
        icon={muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        onClick={() => (compact ? setExpanded(!expanded) : change(volume, !muted))}
      />
      {(!compact || expanded) && (
        <Slider
          onBlur={leave}
          onKeyDown={(event) => {
            if (compact && event.key === 'Escape') {
              event.currentTarget.closest('.music-volume')?.querySelector('button')?.focus()
              setExpanded(false)
            }
          }}
          aria-label="音量"
          aria-valuetext={(muted ? 0 : volume) + '%'}
          title={'音量 ' + (muted ? 0 : volume) + '%'}
          min={0}
          max={100}
          step={1}
          value={muted ? 0 : volume}
          onChange={(_, d) => change(d.value || volume, d.value === 0)}
        />
      )}
    </div>
  )
}
