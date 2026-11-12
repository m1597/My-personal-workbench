import { Button, Slider } from '@fluentui/react-components'
import { Volume2, VolumeX } from 'lucide-react'
import { type RefObject, useLayoutEffect, useState } from 'react'
import type { MusicPreferences } from './MusicSettings'

export function VolumeControls({
  initial,
  audio,
  onError,
}: {
  initial: Pick<MusicPreferences, 'volume' | 'muted'>
  audio: RefObject<HTMLAudioElement | null>
  onError: (error: string) => void
}) {
  const [{ volume, muted }, setOutput] = useState(() => ({
    volume: initial.volume,
    muted: initial.muted,
  }))
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
  return (
    <div className="music-volume">
      <Button
        appearance="subtle"
        size="small"
        aria-label="静音"
        aria-pressed={muted}
        title={muted ? '取消静音' : '静音'}
        icon={muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        onClick={() => change(volume, !muted)}
      />
      <Slider
        aria-label="音量"
        aria-valuetext={(muted ? 0 : volume) + '%'}
        title={'音量 ' + (muted ? 0 : volume) + '%'}
        min={0}
        max={100}
        step={1}
        value={muted ? 0 : volume}
        onChange={(_, d) => change(d.value || volume, d.value === 0)}
      />
    </div>
  )
}
