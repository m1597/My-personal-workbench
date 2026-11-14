import { Button, Dropdown, Option } from '@fluentui/react-components'
import { useEffect, useState } from 'react'

const speeds = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

export function WavePlaybackSpeed({ audio }: { audio: HTMLAudioElement | null }) {
  const [speed, setSpeed] = useState(1)
  useEffect(() => {
    if (!audio) return
    return () => {
      audio.defaultPlaybackRate = 1
      audio.playbackRate = 1
    }
  }, [audio])
  useEffect(() => {
    if (!audio) return
    audio.defaultPlaybackRate = speed
    audio.playbackRate = speed
  }, [audio, speed])
  return (
    <div className="wave-playback-speed">
      <label htmlFor="wave-speed">试听倍速</label>
      <Dropdown
        id="wave-speed"
        aria-label="试听倍速"
        inlinePopup
        listbox={{ className: 'component-popup' }}
        value={speed + '×'}
        selectedOptions={[String(speed)]}
        disabled={!audio}
        onOptionSelect={(_, data) => {
          const rate = Number(data.optionValue)
          if (speeds.includes(rate)) setSpeed(rate)
        }}
      >
        {speeds.map((rate) => (
          <Option key={rate} value={String(rate)} text={rate + '×'}>
            {rate}×
          </Option>
        ))}
      </Dropdown>
      <Button size="small" appearance="subtle" disabled={speed === 1} onClick={() => setSpeed(1)}>
        恢复 1×
      </Button>
    </div>
  )
}
