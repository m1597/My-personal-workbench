import { useEffect, useState } from 'react'
import { Button, Input } from '@fluentui/react-components'
import type { ModelInfo } from './ModelSettings'
type Props = {
  models: ModelInfo
  onGenerating(busy: boolean): void
  running: boolean
  initialDraft: string
  refresh(): Promise<void>
  openSettings(): void
}
export function RecommendationComposer({
  models,
  running,
  initialDraft,
  refresh,
  openSettings,
  onGenerating,
}: Props) {
  const [description, setDescription] = useState(initialDraft)
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
            type="number"
            min={1}
            step={1}
            aria-label="推荐首数"
            value={count}
            disabled={busy}
            onChange={(_, d) => setCount(d.value)}
          />
        </label>
        <Button disabled={busy || !validCount} appearance="primary" onClick={() => void generate()}>
          生成推荐
        </Button>
      </div>
      {!validCount && <small>请输入大于零的整数。</small>}
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
export function useRecordingSources(visible: boolean) {
  const [sources, setSources] = useState('')
  useEffect(() => {
    if (!visible) return
    let revision = 0
    const update = async () => {
      const current = ++revision
      try {
        const { configuration } = await window.music.lxSources()
        if (current === revision) setSources(configuration)
      } catch {
        if (current === revision) setSources('')
      }
    }
    void update()
    const off = window.music.onSourcesChanged(update)
    window.addEventListener('focus', update)
    return () => {
      revision++
      off()
      window.removeEventListener('focus', update)
    }
  }, [visible])
  return sources
}

const legacySummaries: Record<string, string> = {
  denied: '当前来源明确禁止保存这首歌',
  preview: '当前来源仅提供试听',
  unknown: '当前来源未声明是否允许保存这首歌',
  mixed: '各来源的结果不同，本次未能保存',
  missing: '当前来源没有找到匹配的录音版本',
  quality: '当前来源没有可下载的完整音质',
  unusable: '当前来源没有返回可保存的完整音频',
  source: '请先在设置中导入音乐源',
  'source-request': '音乐源暂未返回可用结果，可稍后重试',
  storage: '保存文件失败，请检查下载目录和可用空间',
  network: '暂时无法获取平台结果，可稍后重试',
  cancelled: '本次下载已取消',
}
export function RecordingActions({
  id,
  status,
  message,
  summary,
  diagnosis,
  sourceChanged,
  openSources,
  refresh,
}: {
  id: string
  status: string
  message: string
  summary: string
  diagnosis: string
  sourceChanged: boolean
  openSources(): void
  refresh(): Promise<void>
}) {
  const [choices, setChoices] = useState<Choice[]>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const changeSource = [
    'denied',
    'preview',
    'unknown',
    'mixed',
    'missing',
    'quality',
    'unusable',
    'source',
  ].includes(diagnosis)
  const failureSummary = summary || legacySummaries[diagnosis] || '本次下载未完成，可重新尝试'
  const details = [status === '待重试' && message !== failureSummary ? message : '', error]
    .filter(Boolean)
    .join('\n')
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
          <small className="music-failure-summary">{failureSummary}</small>
          {changeSource && (
            <Button size="small" onClick={openSources}>
              {diagnosis === 'source' ? '导入音乐源' : '更换音乐源'}
            </Button>
          )}
          {diagnosis === 'storage' && (
            <Button
              size="small"
              disabled={busy}
              onClick={() =>
                void window.music
                  .chooseMusicDirectory('recommend')
                  .then(refresh)
                  .catch((e) => setError(String(e)))
              }
            >
              选择下载目录
            </Button>
          )}
          {(!changeSource || sourceChanged) && (
            <Button size="small" disabled={busy} onClick={() => void choose()}>
              重试
            </Button>
          )}
        </>
      )}
      {error && status !== '待重试' && <small role="alert">操作未完成，请查看详情</small>}
      {details && (
        <details className="music-failure-details">
          <summary>查看详情</summary>
          <p>{details}</p>
        </details>
      )}
    </div>
  )
}
