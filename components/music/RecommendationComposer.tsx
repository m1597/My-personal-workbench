import { useState } from 'react'
import { Button, Checkbox, Input, Tab, TabList } from '@fluentui/react-components'
import type { ModelInfo } from './ModelSettings'
type Props = {
  models: ModelInfo
  initialDraft: string
  refresh(): Promise<void>
  generated(batch: string): void
  openSettings(): void
}
export function RecommendationComposer({
  models,
  initialDraft,
  refresh,
  generated,
  openSettings,
}: Props) {
  const [mode, setMode] = useState<'artist' | 'style'>('style')
  const [artist, setArtist] = useState('')
  const [style, setStyle] = useState(initialDraft)
  const [similar, setSimilar] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const offline = models.active === 'offline'
  async function generate() {
    if (!offline && !models.providers.find((p) => p.id === models.active)?.hasKey) {
      openSettings()
      return
    }
    setBusy(true)
    setError('')
    try {
      generated(
        await window.music.generate(
          mode === 'artist' ? artist : style,
          mode,
          mode === 'artist' && similar,
        ),
      )
      await refresh()
    } catch (e) {
      setError(String(e).split('Error: ').pop() || '推荐失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="music-compose">
      <TabList
        aria-label="推荐方式"
        selectedValue={mode}
        disabled={busy}
        onTabSelect={(_, d) => setMode(d.value as 'artist' | 'style')}
      >
        <Tab value="artist">按歌手推荐</Tab>
        <Tab value="style">按风格推荐</Tab>
      </TabList>
      <div className="music-input">
        <Input
          data-guide-anchor="recommend"
          aria-label={mode === 'artist' ? '指定歌手' : '今天想听什么'}
          placeholder={mode === 'artist' ? '指定歌手（可选）' : '指定风格（可选）'}
          maxLength={1000}
          disabled={busy}
          value={mode === 'artist' ? artist : style}
          onChange={(_, d) => {
            if (mode === 'artist') setArtist(d.value)
            else {
              setStyle(d.value)
              void window.music.draft(d.value).catch((e) => setError(String(e)))
            }
          }}
        />
        <Button disabled={busy} appearance="primary" onClick={() => void generate()}>
          {offline ? '生成离线试听单' : '生成推荐'}
        </Button>
      </div>
      {mode === 'artist' && !offline && (
        <Checkbox
          checked={similar}
          label="发现相似歌手"
          onChange={(_, d) => setSimilar(d.checked === true)}
        />
      )}
      {offline && <small>离线示例使用 FitBay 合成录音。</small>}
      {busy && (
        <Button size="small" onClick={() => void window.music.stopGeneration()}>
          取消生成
        </Button>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}

type Choice = { key: string; title: string; artist: string; album: string }
export function RecordingActions({
  id,
  status,
  message,
  diagnosis,
  openSources,
  refresh,
}: {
  id: string
  status: string
  message: string
  diagnosis: string
  openSources(): void
  refresh(): Promise<void>
}) {
  const [choices, setChoices] = useState<Choice[]>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function choose(key?: string) {
    setBusy(true)
    setError('')
    try {
      await window.music.prepareRecommendation(id, key)
      setChoices(undefined)
      await refresh()
    } catch (e) {
      setError(String(e).split('Error: ').pop() || '保存失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="music-versions">
      {status === '待选录音' && (
        <Button
          size="small"
          aria-expanded={!!choices}
          disabled={busy}
          onClick={() => {
            if (choices) setChoices(undefined)
            else
              void window.music
                .recommendationChoices(id)
                .then(setChoices)
                .catch((e) => setError(String(e)))
          }}
        >
          选择录音版本
        </Button>
      )}
      {choices?.map((v) => (
        <Button key={v.key} size="small" disabled={busy} onClick={() => void choose(v.key)}>
          {[v.title, v.artist, v.album].filter(Boolean).join(' · ')}
        </Button>
      ))}
      {status === '待重试' && (
        <>
          <small>{message}</small>
          {['denied', 'preview', 'unknown', 'mixed', 'missing', 'source'].includes(diagnosis) && (
            <Button size="small" onClick={openSources}>
              更换音乐源
            </Button>
          )}
          <Button size="small" disabled={busy} onClick={() => void choose()}>
            重试
          </Button>
        </>
      )}
      {error && <small role="alert">{error}</small>}
    </div>
  )
}
