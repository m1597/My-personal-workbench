import { useState } from 'react'
import { Button, Input } from '@fluentui/react-components'
import type { ModelInfo } from './ModelSettings'
type Props = {
  models: ModelInfo
  onGenerating(busy: boolean): void
  activeTarget?: number | null
  running: boolean
  initialDraft: string
  refresh(): Promise<void>
  openSettings(): void
}
export function RecommendationComposer({
  models,
  activeTarget,
  running,
  initialDraft,
  refresh,
  openSettings,
  onGenerating,
}: Props) {
  const [description, setDescription] = useState(initialDraft)
  const [stopping, setStopping] = useState(false)
  const [submitting, setBusy] = useState(false)
  const [count, setCount] = useState('5')
  const target = Number(count)
  const validCount = /^\d+$/.test(count) && Number.isSafeInteger(target) && target > 0
  const busy = submitting || running
  const [error, setError] = useState('')
  async function generate() {
    if (!models.providers.find((p) => p.id === models.active)?.hasKey) {
      openSettings()
      return
    }
    onGenerating(true)
    setBusy(true)
    setError('')
    try {
      await window.music.generate(description, 'auto', false, target)
      await refresh()
    } catch (e) {
      setError(String(e).split('Error: ').pop() || '推荐失败')
      await refresh().catch(() => {})
    } finally {
      onGenerating(false)
      setBusy(false)
    }
  }
  return (
    <section className="music-compose">
      <label htmlFor="music-description">描述你想听什么</label>
      <div className="music-input">
        <Input
          data-guide-anchor="recommend"
          id="music-description"
          placeholder="比如：想听点适合夜里散步的歌"
          maxLength={1000}
          disabled={busy}
          value={description}
          onChange={(_, d) => {
            setDescription(d.value)
            void window.music.draft(d.value).catch((e) => setError(String(e)))
          }}
        />
        <label className="music-target-count" htmlFor="music-count">
          推荐首数
          <Input
            id="music-count"
            type="text"
            inputMode="numeric"
            pattern="[0-9]+"
            aria-label="推荐首数"
            value={activeTarget ? String(activeTarget) : count}
            disabled={busy}
            onChange={(_, d) => setCount(d.value)}
          />
        </label>
        {busy ? (
          <Button
            disabled={stopping}
            onClick={async () => {
              setStopping(true)
              try {
                await window.music.stopGeneration()
                await refresh()
              } catch (e) {
                setError(String(e).split('Error: ').pop() || '终止失败')
              } finally {
                setStopping(false)
              }
            }}
          >
            {stopping ? '正在终止…' : '终止本次推荐'}
          </Button>
        ) : (
          <Button disabled={!validCount} appearance="primary" onClick={() => void generate()}>
            生成推荐
          </Button>
        )}
      </div>
      {!validCount && <small>请输入大于零的整数。</small>}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
