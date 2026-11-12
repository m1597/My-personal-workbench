import { useState } from 'react'
import { Button, Checkbox, Input, Tab, TabList } from '@fluentui/react-components'
import { Settings2 } from 'lucide-react'
import { ModelSettings, type ModelInfo } from './ModelSettings'

type Mode = 'artist' | 'style'
type Props = {
  models: ModelInfo
  profile: string
  summary: string[]
  initialDraft: string
  refresh(): Promise<void>
  generated(batch: string): void
}

export function RecommendationComposer({
  models,
  profile,
  summary,
  initialDraft,
  refresh,
  generated,
}: Props) {
  const [mode, setMode] = useState<Mode>('style')
  const [draft, setDraft] = useState(initialDraft)
  const [artist, setArtist] = useState('')
  const [similar, setSimilar] = useState(false)
  const [personal, setPersonal] = useState(false)
  const [settings, setSettings] = useState(false)
  const [consent, setConsent] = useState<{
    summary: string[]
    settings: boolean
    provider: string
  }>()
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const provider = models.providers.find((p) => p.id === models.active)
  const offline = models.active === 'offline'
  const input = mode === 'artist' ? artist : draft

  async function generate(confirmed = false) {
    setError('')
    if (!offline && !provider?.hasKey) {
      setSettings(true)
      return
    }
    if (personal && !offline && !profile && !confirmed) {
      setConsent({ summary: [...summary], settings: false, provider: models.active })
      return
    }
    setBusy(true)
    try {
      let taste = personal && !offline ? profile : ''
      if (confirmed && consent) {
        if (consent.provider !== models.active) throw Error('模型已变更，请重新预览')
        taste = await window.music.generateProfile(description, consent.summary)
        const settingsOnly = consent.settings
        setConsent(undefined)
        setDescription('')
        await refresh()
        if (settingsOnly) return
      }
      generated(
        await window.music.generate(
          personal && !offline ? '' : input.trim(),
          taste,
          mode,
          mode === 'artist' && similar,
        ),
      )
      await refresh()
    } catch (e) {
      setError(String(e).split('Error: ').pop() || '生成失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="music-compose">
      <div className="music-section-head">
        <h2>每日推荐</h2>
        <Button
          size="small"
          icon={<Settings2 size={15} />}
          aria-expanded={settings}
          disabled={busy}
          onClick={() => {
            setConsent(undefined)
            setSettings(!settings)
          }}
        >
          模型设置
        </Button>
      </div>
      {settings && (
        <>
          <ModelSettings
            info={models}
            close={() => {
              setSettings(false)
              setConsent(undefined)
            }}
            save={async (...args) => {
              await window.music.configureModel(...args)
              await refresh()
            }}
          />
          <h3>个人音乐偏好资料</h3>
          <p>{profile || '尚未生成资料'}</p>
          {!offline && (
            <Button
              size="small"
              disabled={busy}
              onClick={() =>
                setConsent({ summary: [...summary], settings: true, provider: models.active })
              }
            >
              {profile ? '更新资料' : '生成资料'}
            </Button>
          )}
        </>
      )}
      <TabList
        aria-label="推荐方式"
        selectedValue={mode}
        disabled={busy}
        onTabSelect={(_, data) => {
          setMode(data.value as Mode)
          setConsent(undefined)
        }}
      >
        <Tab value="artist">按歌手推荐</Tab>
        <Tab value="style">按风格推荐</Tab>
      </TabList>
      {offline ? (
        <small>离线示例使用 FitBay 合成录音，仅用于体验试听流程。</small>
      ) : (
        <Checkbox
          label="使用我的偏好资料"
          disabled={busy}
          checked={personal}
          onChange={(_, d) => {
            setPersonal(d.checked === true)
            setConsent(undefined)
          }}
        />
      )}
      {(!personal || offline) && (
        <Input
          aria-label={mode === 'artist' ? '指定歌手' : '今天想听什么'}
          placeholder={mode === 'artist' ? '输入一位歌手的名字' : '输入音乐风格，如氛围爵士'}
          value={input}
          disabled={busy}
          maxLength={1000}
          onChange={(_, d) => {
            if (mode === 'artist') setArtist(d.value)
            else {
              setDraft(d.value)
              void window.music.draft(d.value).catch((e) => setError(String(e)))
            }
          }}
        />
      )}
      {mode === 'artist' && !offline && (
        <Checkbox
          label="发现相似歌手"
          checked={similar}
          disabled={busy}
          onChange={(_, d) => setSimilar(d.checked === true)}
        />
      )}
      {consent ? (
        <div className="music-summary-content">
          <strong>生成偏好资料</strong>
          <p>
            将向 {provider?.label} 发送以下曲库艺人及曲目数量（最多 50
            位），以及你填写的自述。资料保存在本机，后续推荐只发送资料。
          </p>
          <p>{consent.summary.join('；') || '曲库暂无艺人数据'}</p>
          <Input
            aria-label="长期音乐偏好自述"
            placeholder="可补充喜欢的艺人、风格或声音"
            maxLength={1000}
            value={description}
            disabled={busy}
            onChange={(_, d) => setDescription(d.value)}
          />
          <Button
            disabled={busy || (!description.trim() && !consent.summary.length)}
            appearance="primary"
            onClick={() => void generate(true)}
          >
            {consent.settings ? '同意发送并生成资料' : '同意发送并继续推荐'}
          </Button>
          <Button disabled={busy} onClick={() => setConsent(undefined)}>
            返回
          </Button>
        </div>
      ) : (
        <Button
          appearance="primary"
          disabled={busy || (!(personal && !offline) && !input.trim())}
          onClick={() => void generate()}
        >
          {offline ? '生成离线试听单' : personal ? '按我的偏好推荐' : '生成推荐'}
        </Button>
      )}
      {busy && (
        <Button size="small" onClick={() => void window.music.stopGeneration()}>
          取消生成
        </Button>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
