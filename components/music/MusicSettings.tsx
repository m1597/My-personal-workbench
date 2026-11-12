import { useEffect, useState } from 'react'
import { Button, Checkbox, Dropdown, Field, Input, Option } from '@fluentui/react-components'
import { ModelSettings, type ModelInfo } from './ModelSettings'
import type { ImportJob } from './LibraryPane'
import { AudioLines, Download, Keyboard, Library, PanelLeft, Sparkles } from 'lucide-react'
import { MusicSourcesSettings } from './MusicSourcesSettings'
import './settings.css'

const categories = [
  { id: 'library', name: '本地曲库', icon: Library },
  { id: 'sources', name: '音乐源', icon: AudioLines },
  { id: 'downloads', name: '下载', icon: Download },
  { id: 'model', name: '模型与推荐', icon: Sparkles },
  { id: 'keys', name: '全局快捷键', icon: Keyboard },
] as const
export type SettingsCategory = (typeof categories)[number]['id']

export type TasteStatus = {
  consented: boolean
  status: string
  updatedAt: string
  pending: number
  error: string
}
export type TransportAction = 'toggle' | 'previous' | 'next'
export type MusicPreferences = {
  manualDir: string
  recommendDir: string
  quality: string
  mediaKeys: boolean
  shortcuts: Record<TransportAction, string>
  shortcutFailures: string[]
}
const actions = { toggle: '播放 / 暂停', previous: '上一首', next: '下一首' } as const
const qualities = ['128k', '192k', '320k', 'flac', 'flac24bit', 'hires']

function ShortcutField({
  action,
  saved,
  change,
}: {
  action: TransportAction
  saved: string
  change(key: string): Promise<boolean>
}) {
  const [value, setValue] = useState(saved)
  const normalKey = (part: string) => {
    const aliases: Record<string, string> = {
      ctrl: 'Ctrl',
      control: 'Ctrl',
      alt: 'Alt',
      shift: 'Shift',
      super: 'Super',
      win: 'Super',
      space: 'Space',
      up: 'Up',
      down: 'Down',
      left: 'Left',
      right: 'Right',
      home: 'Home',
      end: 'End',
      pageup: 'PageUp',
      pagedown: 'PageDown',
      insert: 'Insert',
      delete: 'Delete',
    }
    return aliases[part.toLowerCase()] ?? part.toUpperCase()
  }
  return (
    <form
      className="settings-shortcut"
      onSubmit={async (e) => {
        e.preventDefault()
        const key = value.trim()
          ? value
              .split('+')
              .map((p) => normalKey(p.trim()))
              .join('+')
          : ''
        if (await change(key)) setValue(key)
      }}
    >
      <Field label={actions[action]}>
        <Input
          value={value}
          maxLength={60}
          placeholder="例如 Ctrl+Alt+P"
          onChange={(_, d) => setValue(d.value)}
        />
      </Field>
      <Button
        type="submit"
        size="small"
        disabled={value === saved}
        aria-label={'保存' + actions[action] + '快捷键'}
      >
        保存
      </Button>
    </form>
  )
}

export function MusicSettings({
  category,
  selectCategory,
  prefs,
  models,
  job,
  refresh,
}: {
  category: SettingsCategory
  selectCategory: (category: SettingsCategory) => void
  prefs: MusicPreferences
  models: ModelInfo
  job: ImportJob
  refresh: () => Promise<void>
}) {
  const [navOpen, setNavOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [feedback, setFeedback] = useState<{ category: SettingsCategory; text: string }>()
  const [busy, setBusy] = useState(false)
  const [taste, setTaste] = useState<Awaited<ReturnType<typeof window.music.getTasteStatus>>>()
  useEffect(() => {
    if (category !== 'model') return
    let alive = true
    void window.music
      .getTasteStatus()
      .then((info) => {
        if (alive) setTaste(info)
      })
      .catch((e) => {
        if (alive) setFeedback({ category, text: String(e) })
      })
    return () => {
      alive = false
    }
  }, [category])
  useEffect(() => {
    if (category !== 'model' || !taste?.consented) return
    let mounted = true
    const timer = setInterval(() => {
      void window.music
        .getTasteStatus()
        .then((info) => {
          if (mounted) setTaste(info)
        })
        .catch(() => {})
    }, 2500)
    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [category, taste?.consented])
  async function update(action: () => Promise<unknown>, message = '已保存') {
    setBusy(true)
    setFeedback(undefined)
    try {
      await action()
      await refresh()
      setFeedback({ category, text: message })
      return true
    } catch (e) {
      setFeedback({ category, text: String(e).split('Error: ').pop() || '操作失败' })
      return false
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="library-layout settings-layout">
      <Button
        className="library-nav-toggle"
        size="small"
        appearance="subtle"
        icon={<PanelLeft size={15} />}
        aria-expanded={navOpen}
        aria-controls="settings-categories"
        onClick={() => setNavOpen(!navOpen)}
      >
        设置分类
      </Button>
      <nav
        className="library-sidebar"
        id="settings-categories"
        aria-label="设置分类"
        data-open={navOpen}
      >
        {categories.map(({ id, name, icon: Icon }) => (
          <Button
            key={id}
            appearance="subtle"
            icon={<Icon size={16} />}
            aria-pressed={category === id}
            onClick={() => {
              selectCategory(id)
              setNavOpen(false)
              setFeedback(undefined)
            }}
          >
            {name}
          </Button>
        ))}
      </nav>
      <div className="music-settings">
        {category === 'library' && (
          <section>
            <h2>本地曲库</h2>
            <div className="settings-buttons">
              <Button
                disabled={job.running || busy}
                onClick={() => void update(() => window.music.importLocal('files'), '')}
              >
                添加文件
              </Button>
              <Button
                disabled={job.running || busy}
                onClick={() => void update(() => window.music.importLocal('folder'), '')}
              >
                添加文件夹
              </Button>
            </div>
            {job.started && (
              <div className="settings-buttons">
                <span>
                  {job.running ? '正在导入' : job.cancelled ? '导入已取消' : '导入完成'} · 新增{' '}
                  {job.added} · 重复 {job.duplicates} · 失败 {job.failed}
                </span>
                {job.running && (
                  <Button
                    size="small"
                    onClick={() => void update(() => window.music.cancelImport(), '')}
                  >
                    取消导入
                  </Button>
                )}
              </div>
            )}
          </section>
        )}
        {category === 'sources' && <MusicSourcesSettings />}
        {category === 'downloads' && (
          <section>
            <h2>下载</h2>
            <Field label="首选音质">
              <Dropdown
                inlinePopup
                listbox={{ className: 'component-popup' }}
                value={prefs.quality}
                selectedOptions={[prefs.quality]}
                onOptionSelect={(_, d) => {
                  const value = d.optionValue
                  if (value) void update(() => window.music.setMusicQuality(value))
                }}
              >
                {qualities.map((q) => (
                  <Option key={q} value={q}>
                    {q}
                  </Option>
                ))}
              </Dropdown>
            </Field>
            {(['manual', 'recommend'] as const).map((kind) => {
              const title = kind === 'manual' ? '手动下载目录' : '推荐下载目录'
              const dir = kind === 'manual' ? prefs.manualDir : prefs.recommendDir
              return (
                <div className="settings-directory" key={kind}>
                  <div>
                    <strong>{title}</strong>
                    <span title={dir}>{dir || '未选择'}</span>
                  </div>
                  <Button
                    size="small"
                    disabled={busy}
                    aria-label={'选择' + title}
                    onClick={() => void update(() => window.music.chooseMusicDirectory(kind), '')}
                  >
                    选择目录
                  </Button>
                </div>
              )
            })}
          </section>
        )}
        {category === 'model' && (
          <section>
            <h2>模型与推荐</h2>
            <div className="settings-buttons">
              <span>{models.providers.find((p) => p.id === models.active)?.label}</span>
              <Button size="small" aria-expanded={editing} onClick={() => setEditing(!editing)}>
                模型设置
              </Button>
            </div>
            {editing && (
              <ModelSettings
                info={models}
                close={() => setEditing(false)}
                save={async (...args) => {
                  await window.music.configureModel(...args)
                  await refresh()
                }}
              />
            )}
            <Checkbox
              label="允许使用曲库摘要生成推荐偏好"
              checked={taste?.consented ?? false}
              disabled={!taste || busy}
              onChange={(_, d) =>
                void update(async () => {
                  await window.music.setTasteConsent(d.checked === true)
                  setTaste(await window.music.getTasteStatus())
                }, '')
              }
            />
            <p>
              同意后向所选模型发送歌名、艺人、专辑和你主动加入歌单的偏好信号。关闭后停止后续发送。
            </p>
            {taste?.status && (
              <span>
                {taste.status}
                {taste.updatedAt ? ' · ' + new Date(taste.updatedAt).toLocaleString() : ''}
                {taste.error ? ' · ' + taste.error : ''}
              </span>
            )}
          </section>
        )}
        {category === 'keys' && (
          <section>
            <h2>全局快捷键</h2>
            <Checkbox
              label="启用键盘媒体键"
              checked={prefs.mediaKeys}
              onChange={(_, d) =>
                void update(() => window.music.setMusicMediaKeys(d.checked === true))
              }
            />
            <p>自定义组合可使用 Ctrl、Alt、Shift、Win 或功能键。清空并保存可解除绑定。</p>
            {Object.entries(actions).map(([id]) => {
              const action = id as TransportAction
              return (
                <ShortcutField
                  key={action}
                  action={action}
                  saved={prefs.shortcuts[action]}
                  change={(key) => update(() => window.music.setMusicShortcut(action, key))}
                />
              )
            })}
            {prefs.shortcutFailures.length > 0 && (
              <span role="alert">
                系统未允许注册或快捷键已被占用：{prefs.shortcutFailures.join('、')}
              </span>
            )}
          </section>
        )}
        {feedback?.category === category && feedback.text && (
          <div className="settings-message" role="status">
            {feedback.text}
          </div>
        )}
      </div>
    </div>
  )
}
