import { useEffect, useRef, useState } from 'react'
import { Button, Dropdown, Input, Option } from '@fluentui/react-components'
import type { PluginProps } from '../../MusicPlugins'
import { analyze, transitionQueue, type Features } from './analysis'
import './path.css'

export default function SongPath({ tracks, activeId, play }: PluginProps) {
  const local = tracks.filter((t) => t.listed && t.available)
  const byId = new Map(local.map((t) => [t.id, t]))
  const [start, setStart] = useState(activeId ?? '')
  const [end, setEnd] = useState('')
  const [count, setCount] = useState('3')
  const [queue, setQueue] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  useEffect(
    () => () => {
      generation.current++
    },
    [],
  )
  const first = byId.has(start) ? start : local[0]?.id
  const last = byId.has(end) ? end : local.find((t) => t.id !== first)?.id
  const valid = Number.isInteger(Number(count)) && Number(count) >= 1 && Number(count) <= 20
  function reset() {
    generation.current++
    setQueue([])
    setNotice('')
    setBusy(false)
  }
  async function generate() {
    if (!first || !last || first === last || !valid) return
    reset()
    const epoch = generation.current
    setBusy(true)
    const features = new Map<string, Features>()
    try {
      for (const [index, t] of local.entries()) {
        if (epoch !== generation.current) return
        setNotice(`正在分析 ${index + 1}/${local.length} · ${t.title}`)
        const measured = await analyze(t.id).catch(() => undefined)
        if (measured) features.set(t.id, measured)
      }
      if (epoch !== generation.current) return
      const result = transitionQueue(features, first, last, Number(count))
      setQueue(result)
      const skipped = local.length - features.size
      setNotice(
        result.length === 2
          ? '没有可用的中间录音，可直接播放起点和终点。'
          : skipped
            ? `跳过 ${skipped} 首无法分析的录音。`
            : '',
      )
    } catch (error) {
      if (epoch === generation.current)
        setNotice(error instanceof Error ? error.message : '无法生成队列')
    } finally {
      if (epoch === generation.current) setBusy(false)
    }
  }
  function picker(label: string, id: string | undefined, change: (id: string) => void) {
    const track = byId.get(id ?? '')
    return (
      <label htmlFor={`song-path-${label}`}>
        {label}
        <Dropdown
          id={`song-path-${label}`}
          aria-label={label}
          inlinePopup
          listbox={{ className: 'component-popup' }}
          value={track ? `${track.title} · ${track.artist}` : ''}
          selectedOptions={id ? [id] : []}
          onOptionSelect={(_, d) => {
            if (d.optionValue) {
              reset()
              change(d.optionValue)
            }
          }}
        >
          {local.map((t) => (
            <Option key={t.id} value={t.id}>{`${t.title} · ${t.artist}`}</Option>
          ))}
        </Dropdown>
      </label>
    )
  }
  return (
    <section className="song-path" aria-label="歌曲过渡">
      {local.length < 2 ? (
        <p>请先向曲库添加至少两首可用的本地歌曲。</p>
      ) : (
        <>
          <div className="song-path-controls">
            {picker('起点歌曲', first, setStart)}
            {picker('终点歌曲', last, setEnd)}
            <label htmlFor="song-path-count">
              中间曲数
              <Input
                id="song-path-count"
                aria-label="中间曲数"
                type="number"
                min={1}
                max={20}
                value={count}
                onChange={(_, d) => {
                  reset()
                  setCount(d.value)
                }}
              />
            </label>
          </div>
          <div className="settings-buttons">
            <Button
              appearance="primary"
              disabled={!valid || first === last || busy}
              onClick={() => void generate()}
            >
              生成过渡队列
            </Button>
            {busy && <Button onClick={reset}>取消分析</Button>}
          </div>
          {first === last && <p>请选择两首不同的歌曲。</p>}
          {!!notice && <p role="status">{notice}</p>}
          {!!queue.length && (
            <>
              <ol aria-label="过渡队列">
                {queue.map((id) => (
                  <li key={id}>
                    {byId.get(id)?.title ?? '已移除'} · {byId.get(id)?.artist}
                  </li>
                ))}
              </ol>
              <Button
                disabled={queue.some((id) => !byId.has(id))}
                onClick={() => play(queue[0], queue)}
              >
                播放过渡队列
              </Button>
            </>
          )}
        </>
      )}
    </section>
  )
}
