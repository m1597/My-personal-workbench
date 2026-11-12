import { useEffect, useMemo, useState } from 'react'
import { Button, Dropdown, Input, Option } from '@fluentui/react-components'
import type { LocalTrack } from '../../LibraryPane'
import './rules.css'

type Rule = {
  id: string | null
  name: string
  source: 'any' | 'daily' | 'download' | 'local'
  days: number | null
  comparison: 'any' | 'eq' | 'gte' | 'lte'
  plays: number
}
const sources = { any: '全部来源', daily: '每日推荐下载', download: '手动下载', local: '本地导入' }
const comparisons = { any: '不限次数', eq: '等于', gte: '至少', lte: '至多' }
const initial: Rule = { id: null, name: '', source: 'daily', days: 30, comparison: 'eq', plays: 0 }
const plugin = (action: string, ...args: unknown[]) =>
  window.musicPlugins.call('rules', action, ...args)

function Choice<K extends string>({
  id,
  label,
  options,
  selected,
  change,
}: {
  id: string
  label: string
  options: Record<K, string>
  selected: K
  change: (key: K) => void
}) {
  return (
    <label htmlFor={id}>
      {label}
      <Dropdown
        id={id}
        size="small"
        inlinePopup
        listbox={{ className: 'component-popup' }}
        value={options[selected]}
        selectedOptions={[selected]}
        onOptionSelect={(_, data) => {
          if (data.optionValue && Object.hasOwn(options, data.optionValue))
            change(data.optionValue as K)
        }}
      >
        {Object.entries<string>(options).map(([key, name]) => (
          <Option key={key} value={key}>
            {name}
          </Option>
        ))}
      </Dropdown>
    </label>
  )
}

export default function SmartPlaylists({
  tracks,
  play,
}: {
  tracks: LocalTrack[]
  play: (id: string) => void
}) {
  const [saved, setSaved] = useState<Rule[]>([])
  const [rule, setRule] = useState<Rule>(initial)
  const [busy, setBusy] = useState(true)
  const [notice, setNotice] = useState('')
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    let live = true
    void plugin('list')
      .then((value) => {
        if (!live) return
        const rows = value as Rule[]
        setSaved(rows)
        setRule(rows[0] ?? initial)
      })
      .catch((err) => {
        if (live) setNotice(String(err))
      })
      .finally(() => {
        if (live) setBusy(false)
      })
    const timer = setInterval(() => setNow(Date.now()), 60000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [])
  const update = (fields: Partial<Rule>) => {
    setRule((prev) => ({ ...prev, ...fields }))
    setNotice('')
  }
  const matches = useMemo(
    () =>
      tracks.filter((t) => {
        if (!t.listed || (rule.source !== 'any' && t.origin !== rule.source)) return false
        if (rule.days !== null && (!t.observedAt || t.observedAt < now - rule.days * 86400000))
          return false
        if (rule.comparison === 'eq') return t.playCount === rule.plays
        if (rule.comparison === 'gte') return t.playCount >= rule.plays
        if (rule.comparison === 'lte') return t.playCount <= rule.plays
        return true
      }),
    [tracks, rule.source, rule.days, rule.comparison, rule.plays, now],
  )
  async function persist(deleting = false) {
    setBusy(true)
    try {
      const id = deleting ? await plugin('remove', rule.id) : await plugin('save', rule)
      const rows = (await plugin('list')) as Rule[]
      setSaved(rows)
      setRule(rows.find((r) => r.id === id) ?? rows[0] ?? initial)
      setNotice(deleting ? '歌单规则已移除' : '规则已保存')
    } catch (err) {
      setNotice(String(err).split('Error: ').pop() || '保存失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="smart-playlists" aria-label="智能歌单">
      <div className="smart-heading">
        <h2>智能歌单</h2>
        <Button
          size="small"
          disabled={busy}
          onClick={() => {
            setRule(initial)
            setNotice('')
          }}
        >
          新建规则
        </Button>
      </div>
      {saved.length > 0 && (
        <Dropdown
          aria-label="已保存规则"
          inlinePopup
          listbox={{ className: 'component-popup' }}
          selectedOptions={rule.id ? [rule.id] : []}
          value={saved.find((r) => r.id === rule.id)?.name ?? '新规则'}
          disabled={busy}
          onOptionSelect={(_, d) => {
            const picked = saved.find((r) => r.id === d.optionValue)
            if (picked) {
              setRule(picked)
              setNotice('')
            }
          }}
        >
          {saved.map((r) => (
            <Option key={r.id} value={r.id ?? ''}>
              {r.name}
            </Option>
          ))}
        </Dropdown>
      )}
      <div className="smart-fields">
        <label htmlFor="smart-name">
          歌单名称
          <Input
            id="smart-name"
            value={rule.name}
            maxLength={100}
            onChange={(_, d) => update({ name: d.value })}
            placeholder="例如：最近推荐，还没听过"
          />
        </label>
        <Choice
          id="smart-source"
          label="歌曲来源"
          options={sources}
          selected={rule.source}
          change={(source) => update({ source })}
        />
        <label htmlFor="smart-days">
          最近入库（天）
          <Input
            id="smart-days"
            type="number"
            min={1}
            max={36500}
            placeholder="不限"
            value={rule.days === null ? '' : String(rule.days)}
            onChange={(_, d) => update({ days: d.value === '' ? null : Number(d.value) })}
          />
        </label>
        <Choice
          id="smart-compare"
          label="有效播放次数"
          options={comparisons}
          selected={rule.comparison}
          change={(comparison) => update({ comparison })}
        />
        {rule.comparison !== 'any' && (
          <label htmlFor="smart-plays">
            次数
            <Input
              id="smart-plays"
              type="number"
              min={0}
              max={10000000}
              value={String(rule.plays)}
              onChange={(_, d) => update({ plays: Number(d.value) })}
            />
          </label>
        )}
      </div>
      <div className="smart-actions">
        <Button
          size="small"
          appearance="primary"
          disabled={busy || !rule.name.trim()}
          onClick={() => void persist()}
        >
          保存规则
        </Button>
        {rule.id && (
          <Button size="small" disabled={busy} onClick={() => void persist(true)}>
            删除规则
          </Button>
        )}
        {notice && <small role="status">{notice}</small>}
      </div>
      <h3>
        匹配歌曲 <span>{matches.length}</span>
      </h3>
      {matches.length ? (
        <ul>
          {matches.map((track) => (
            <li key={track.id}>
              <div>
                <strong>{track.title}</strong>
                <small>
                  {track.artist} · {track.playCount} 次有效播放
                </small>
              </div>
              <Button
                size="small"
                appearance="subtle"
                disabled={!track.available}
                aria-label={'试听' + track.title}
                onClick={() => play(track.id)}
              >
                试听
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p>暂无符合这些条件的歌曲。</p>
      )}
    </section>
  )
}
