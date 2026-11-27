import { useRef, useState } from 'react'
import { Button, Input } from '@fluentui/react-components'
import type { ModelInfo } from './ModelSettings'
import { DiscoveryInput } from './DiscoveryInput'
import { guardSearchEnter } from './searchSubmit'
import {
  RecommendationReferences,
  RecommendationWeight,
  recommendationInputs,
  type ReferenceControls,
} from './RecommendationReferences'
type Props = {
  models: ModelInfo
  onGenerating(busy: boolean): void
  activeTarget?: number | null
  running: boolean
  description: string
  edit(value: string): void
  references?: ReferenceControls
  count: string
  setCount(value: string): void
  currentSong?: { title: string; artist: string }
  refresh(): Promise<void>
  openSettings(): void
}
export function RecommendationComposer({
  models,
  activeTarget,
  running,
  description,
  edit,
  references,
  count,
  setCount,
  currentSong,
  refresh,
  openSettings,
  onGenerating,
}: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [submitting, setBusy] = useState(false)
  const { weight: effectiveWeight, usable } = recommendationInputs(description, references)
  const target = Number(count)
  const validCount = /^\d+$/.test(count) && Number.isSafeInteger(target) && target > 0
  const busy = submitting || running
  const [error, setError] = useState('')
  async function generate() {
    if (busy || !validCount || !usable || !references?.result.preview) return
    onGenerating(true)
    setBusy(true)
    setError('')
    try {
      const connection =
        window.fitbayConnections && (await window.fitbayConnections.snapshot()).rows[0]?.value
      if (
        !(
          connection?.configured ??
          models.subscription?.configured ??
          models.providers.find((p) => p.id === models.active)?.hasKey
        )
      ) {
        openSettings()
        return
      }
      await window.music.generate(
        description,
        'auto',
        false,
        target,
        effectiveWeight,
        references?.result.preview.selection,
      )
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
      <form
        id="music-generate-recommendations"
        className="download-search"
        onKeyDownCapture={guardSearchEnter}
        onSubmit={(event) => {
          event.preventDefault()
          void generate()
        }}
      >
        <DiscoveryInput ai value={description} edit={edit} inputRef={input} disabled={busy} />
        <Button
          type="submit"
          disabled={busy || !validCount || !usable || !references?.result.preview}
          appearance="primary"
        >
          {busy ? '生成中…' : '生成推荐'}
        </Button>
      </form>
      <div className="discovery-options">
        <label className="music-target-count" htmlFor="music-count">
          推荐首数
          <Input
            id="music-count"
            input={{ form: 'music-generate-recommendations' }}
            onKeyDownCapture={guardSearchEnter}
            type="text"
            inputMode="numeric"
            pattern="[0-9]+"
            aria-label="推荐首数"
            value={activeTarget ? String(activeTarget) : count}
            disabled={busy}
            onChange={(_, d) => setCount(d.value)}
          />
        </label>
        <Button
          size="small"
          appearance="subtle"
          disabled={busy || !currentSong?.title}
          onClick={() => {
            if (!currentSong) return
            edit([currentSong.title, currentSong.artist].filter(Boolean).join(' · ').slice(0, 1000))
            input.current?.focus()
          }}
        >
          {currentSong?.title ? `以《${currentSong.title}》为参考` : '以当前歌曲为参考'}
        </Button>
        {references && (
          <RecommendationWeight
            description={description}
            references={references}
            busy={busy}
            report={setError}
          />
        )}
      </div>
      {references && (
        <RecommendationReferences
          {...references}
          descriptionOnly={effectiveWeight === 100}
          busy={busy}
        />
      )}
      {!validCount && <small>请输入大于零的整数。</small>}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}

export function StopRecommendation({ refresh }: { refresh(): Promise<void> }) {
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState('')
  return (
    <>
      <Button
        size="small"
        aria-label="终止本次推荐"
        disabled={stopping}
        onClick={async () => {
          setStopping(true)
          setError('')
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
        {stopping ? '正在终止…' : '终止'}
      </Button>
      {error && <span role="alert">{error}</span>}
    </>
  )
}
