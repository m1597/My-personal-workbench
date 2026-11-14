import '../../examples/component-host/lyric-groups.css'
import { useEffect, useEffectEvent, useState } from 'react'
import type { RefObject } from 'react'
import { Checkbox, Dropdown, Field, Option } from '@fluentui/react-components'
import type { MusicPreferences, PlayerOptions } from './MusicSettings'

async function outputs() {
  return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput')
}
const headset = (label: string) => /head(phone|set)|ear(phone|bud)|airpods|耳机|耳麦/i.test(label)
export function useOutputDevice(
  audio: RefObject<HTMLAudioElement | null>,
  prefs: MusicPreferences | undefined,
  pause: () => void,
  error: (message: string) => void,
) {
  const onPause = useEffectEvent(pause)
  const sinkChoice = prefs?.sink
  const unplug = prefs?.unplug
  useEffect(() => {
    if (sinkChoice === undefined || !navigator.mediaDevices || !audio.current) return
    const el = audio.current
    let alive = true,
      previous: MediaDeviceInfo[] | undefined
    let pending = Promise.resolve()
    async function update() {
      const devices = await outputs()
      if (!alive) return
      const previousDefault = previous?.find((d) => d.deviceId === 'default')
      const endpoints =
        previous?.filter(
          (d) => d.deviceId && !['default', 'communications'].includes(d.deviceId),
        ) ?? []
      const defaultLabel = previousDefault?.label.replace(/^.*?\s+-\s+/, '')
      const byLabel = endpoints.filter((d) => defaultLabel && d.label === defaultLabel)
      const byGroup = endpoints.filter(
        (d) => previousDefault?.groupId && d.groupId === previousDefault.groupId,
      )
      const previousOutput = sinkChoice
        ? endpoints.find((d) => d.deviceId === sinkChoice)
        : byLabel.length === 1
          ? byLabel[0]
          : byGroup.length === 1
            ? byGroup[0]
            : undefined
      if (
        previousOutput &&
        !devices.some((d) => d.deviceId === previousOutput.deviceId) &&
        (sinkChoice || headset(previousOutput.label) || headset(previousDefault?.label || '')) &&
        unplug === 'pause' &&
        !el.paused
      )
        onPause()
      previous = devices
      const sink = devices.some((d) => d.deviceId === sinkChoice) ? sinkChoice || '' : ''
      if (el.sinkId !== sink) await el.setSinkId(sink)
    }
    function refresh() {
      pending = pending.then(update).catch(() => {
        if (alive) error('无法切换播放设备，请在播放设置中重新选择。')
      })
    }
    refresh()
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => {
      alive = false
      navigator.mediaDevices.removeEventListener('devicechange', refresh)
    }
  }, [audio, sinkChoice, unplug, error])
}

export function PlayerOptionsPane({
  category,
  prefs,
  change,
}: {
  category: 'lyrics' | 'playback'
  prefs: MusicPreferences
  change: (key: keyof PlayerOptions, value: string) => Promise<boolean>
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  useEffect(() => {
    if (category !== 'playback' || !navigator.mediaDevices) return
    let alive = true
    const update = () =>
      void outputs()
        .then((items) => {
          if (alive) setDevices(items)
        })
        .catch(() => {})
    update()
    navigator.mediaDevices.addEventListener('devicechange', update)
    return () => {
      alive = false
      navigator.mediaDevices.removeEventListener('devicechange', update)
    }
  }, [category])
  const field = (label: string, key: keyof PlayerOptions, items: [string, string][]) => (
    <Field label={label}>
      <Dropdown
        inlinePopup
        listbox={{ className: 'component-popup' }}
        value={items.find(([id]) => id === prefs[key])?.[1] ?? '设备已断开，使用系统默认'}
        selectedOptions={[prefs[key]]}
        onOptionSelect={(_, d) => {
          if (d.optionValue !== undefined) void change(key, d.optionValue)
        }}
      >
        {items.map(([id, name]) => (
          <Option key={id} value={id}>
            {name}
          </Option>
        ))}
      </Dropdown>
    </Field>
  )
  if (category === 'lyrics')
    return (
      <section>
        <h2>歌词</h2>
        {field('桌面歌词字号', 'lyricSize', [
          ['18', '18 px'],
          ['24', '24 px'],
          ['30', '30 px'],
        ])}
        {field('显示行数', 'lyricLayout', [
          ['single', '单行'],
          ['double', '双行'],
        ])}
        {field('桌面歌词语言', 'lyricLanguage', [
          ['original', '原文'],
          ['bilingual', '原文加译文'],
        ])}
        <fieldset
          aria-label="桌面歌词预览"
          className="desktop-lyric-preview"
          style={{ fontSize: Number(prefs.lyricSize) }}
        >
          <div className="lyric-groups">
            {[
              ['Along the shore, I hear the wind.', '沿着海岸，听风吹过。'],
              ['Night falls upon the sea.', '夜色落在海面上。'],
            ]
              .slice(0, prefs.lyricLayout === 'double' ? 2 : 1)
              .map(([original, translation]) => (
                <div className="lyric-group" key={original}>
                  <span className="lyric-original">{original}</span>
                  {prefs.lyricLanguage === 'bilingual' && (
                    <span className="lyric-translation">{translation}</span>
                  )}
                </div>
              ))}
          </div>
        </fieldset>
      </section>
    )
  return (
    <section>
      <h2>播放</h2>
      {field('再次打开 Music 时', 'startup', [
        ['pause', '保持暂停'],
        ['resume', '从上次进度续播'],
        ['beginning', '从上次歌曲开头播放'],
      ])}
      {field('播放输出设备', 'sink', [
        ['', '跟随系统'],
        ...devices
          .filter((d) => d.deviceId && !['default', 'communications'].includes(d.deviceId))
          .map((d, i): [string, string] => [d.deviceId, d.label || '音频输出 ' + (i + 1)]),
      ])}
      <Checkbox
        label="耳机或选定输出设备断开时暂停"
        checked={prefs.unplug === 'pause'}
        onChange={(_, d) => void change('unplug', d.checked ? 'pause' : 'continue')}
      />
    </section>
  )
}
