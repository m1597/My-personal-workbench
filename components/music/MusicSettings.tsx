import { type KeyboardEvent, useEffect, useState } from 'react'
import { Button, Checkbox, Dropdown, Field, Input, Option } from '@fluentui/react-components'
import { ModelSettings, type ModelInfo } from './ModelSettings'
import { LibraryTools } from './LibraryTools'
import type { ImportJob } from './LibraryPane'
import { AudioLines, Download, Keyboard, Library, PanelLeft, Plug, Sparkles } from 'lucide-react'
import { MusicSourcesSettings } from './MusicSourcesSettings'
import { PlayerOptionsPane } from './PlayerOptionsPane'
import './settings.css'

const categories = [
  { id: 'library', name: '本地曲库', icon: Library },
  { id: 'sources', name: '音乐源', icon: AudioLines },
  { id: 'mcp', name: 'MCP', icon: Plug },
  { id: 'downloads', name: '下载', icon: Download },
  { id: 'model', name: '模型与推荐', icon: Sparkles },
  { id: 'lyrics', name: '歌词', icon: AudioLines },
  { id: 'playback', name: '播放', icon: AudioLines },
  { id: 'keys', name: '快捷键', icon: Keyboard },
  { id: 'plugins', name: '插件', icon: Plug },
] as const
export type SettingsCategory = (typeof categories)[number]['id']

export type TasteStatus = {
  exclusions?: { kind: 'folder' | 'playlist'; id: string; name: string }[]
  consented: boolean
  status: string
  updatedAt: string
  pending: number
  error: string
}
export type TransportAction = 'toggle' | 'previous' | 'next' | 'volumeUp' | 'volumeDown'
export type PlayerOptions = {
  lyricSize: string
  lyricLayout: string
  lyricLanguage: string
  lrcSave: string
  lrcLanguage: string
  startup: string
  unplug: string
  sink: string
}
export type MusicPreferences = PlayerOptions & {
  previewQuality: string
  shortage: string
  edition: string
  cover: string
  instrumental: string
  volume: number
  muted: boolean
  manualDir: string
  recommendDir: string
  quality: string
  appKeys: boolean
  globalKeys: boolean
  mediaKeys: boolean
  shortcuts: Record<TransportAction, string>
  shortcutFailures: string[]
}
const actions = {
  toggle: '播放 / 暂停',
  previous: '上一首',
  next: '下一首',
  volumeUp: '提高音量',
  volumeDown: '降低音量',
} as const
const qualities = ['128k', '192k', '320k', 'flac', 'flac24bit', 'hires']

function recordedKey(e: KeyboardEvent<HTMLInputElement>) {
  const modifiers = [
    e.ctrlKey && 'Ctrl',
    e.altKey && 'Alt',
    e.shiftKey && 'Shift',
    e.metaKey && 'Super',
  ].filter(Boolean)
  const physical = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(e.code)
  const key = physical?.[1] ?? physical?.[2] ?? e.key.replace(/^Arrow/, '').replace(/^ $/, 'Space')
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(key)) return [...modifiers, key].join('+')
  if (
    modifiers.length &&
    /^(?:[A-Z0-9]|Space|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert|Delete)$/.test(key)
  )
    return [...modifiers, key].join('+')
  return undefined
}

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
  const [recording, setRecording] = useState(false)
  const [hint, setHint] = useState('')
  function begin() {
    setHint('')
    setRecording(true)
  }
  return (
    <form
      className="settings-shortcut"
      onSubmit={async (e) => {
        e.preventDefault()
        await change(value)
      }}
    >
      <Field label={actions[action]} hint={hint || undefined}>
        <Input
          value={recording ? '' : value}
          readOnly
          placeholder={recording ? '请按组合键' : '点击录制'}
          onFocus={begin}
          onClick={begin}
          onBlur={() => setRecording(false)}
          onKeyDown={(e) => {
            if (e.key === 'Tab') return
            if (!recording && e.key === 'Enter') {
              e.preventDefault()
              begin()
              return
            }
            if (!recording) return
            e.preventDefault()
            e.stopPropagation()
            if (e.repeat) return
            if (e.key === 'Escape') {
              setRecording(false)
              setHint('')
              return
            }
            if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return
            const clear =
              e.key === 'Backspace' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey
            const key = clear ? '' : recordedKey(e)
            if (key === undefined) {
              setHint('请按修饰键与字母、数字或导航键的组合，或直接按功能键')
              return
            }
            setValue(key)
            setHint('')
            setRecording(false)
          }}
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
  plugins,
  category,
  selectCategory,
  script,
  guideTarget,
  prefs,
  models,
  job,
  refresh,
}: {
  plugins: React.ReactNode
  script: string
  guideTarget?: string
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
  function editModel(open: boolean) {
    if (guideTarget === 'model') selectCategory('model')
    setEditing(open)
  }
  function preference(
    key: 'previewQuality' | 'shortage' | 'edition' | 'cover' | 'instrumental',
    label: string,
    options: Record<string, string>,
  ) {
    const value = prefs[key] || Object.keys(options)[0]
    return (
      <Field label={label}>
        <Dropdown
          inlinePopup
          listbox={{ className: 'component-popup' }}
          value={options[value]}
          selectedOptions={[value]}
          onOptionSelect={(_, d) => {
            const selected = d.optionValue
            if (selected) void update(() => window.music.setListeningPreference(key, selected))
          }}
        >
          {Object.entries(options).map(([id, name]) => (
            <Option key={id} value={id}>
              {name}
            </Option>
          ))}
        </Dropdown>
      </Field>
    )
  }
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
        {category === 'plugins' && plugins}
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
        {category === 'library' && <LibraryTools refresh={refresh} />}
        {category === 'sources' && <MusicSourcesSettings />}
        {category === 'mcp' && (
          <section className="music-mcp-connection">
            <h2>MCP</h2>
            <p>
              打开 Music 并保持运行。在支持 stdio 的本机 Agent 中新增 MCP 服务，使用以下启动命令。
            </p>
            <code>node "{script}"</code>
            <div className="settings-buttons">
              <Button
                size="small"
                data-guide-anchor="mcp"
                disabled={!script}
                onClick={async () => {
                  try {
                    await window.music.copyMcpCommand()
                    setFeedback({ category, text: '已复制启动命令' })
                  } catch {
                    setFeedback({ category, text: '复制失败，请选中上方命令后按 Ctrl+C' })
                  }
                }}
              >
                复制启动命令
              </Button>
            </div>
            <h3>连接后可以问 Agent</h3>
            <ul>
              <li>列出我已安装的音源。</li>
              <li>当前音源支持哪些平台和音质？</li>
              <li>从音源目录导入我选中的音源。</li>
              <li>切换到另一个已安装的音源。</li>
            </ul>
            <p>
              要整理本地歌曲，请在你自己的 Agent
              中授权音乐文件夹，先让它列出移动和重命名前后的路径。
              核对方案后再让它执行。外部移动或改名后，FitBay 中的旧条目可能需要「重新定位」。
            </p>
          </section>
        )}
        {(category === 'lyrics' || category === 'playback') && (
          <PlayerOptionsPane
            category={category}
            prefs={prefs}
            change={(key, value) => update(() => window.music.setPlayerOption(key, value), '')}
          />
        )}
        {category === 'downloads' && (
          <section>
            <h2>下载</h2>
            {preference('previewQuality', '试听音质', {
              fast: '快速试听（最低可用音质）',
              ...Object.fromEntries(qualities.map((q) => [q, q])),
            })}
            <Field label="下载音质">
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
            <Checkbox
              label="同时保存同名 LRC 歌词文件"
              checked={prefs.lrcSave === 'on'}
              onChange={(_, d) =>
                void update(() => window.music.setPlayerOption('lrcSave', d.checked ? 'on' : 'off'))
              }
            />
            <Checkbox
              label="有译文时同时保存译文"
              disabled={prefs.lrcSave !== 'on'}
              checked={prefs.lrcLanguage === 'bilingual'}
              onChange={(_, d) =>
                void update(() =>
                  window.music.setPlayerOption('lrcLanguage', d.checked ? 'bilingual' : 'original'),
                )
              }
            />
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
            {preference('shortage', '直接相关歌曲不足时', {
              ask: '保留已有歌曲并询问',
              similar: '自动补充相近歌曲',
            })}
            {preference('edition', '录音版本', {
              any: '都可以',
              studio: '优先录音室',
              live: '优先现场',
            })}
            {preference('cover', '翻唱', {
              any: '都可以',
              prefer: '优先翻唱',
              avoid: '尽量避开翻唱',
            })}
            {preference('instrumental', '伴奏', {
              requested: '仅在明确要求时推荐',
              any: '都可以',
              prefer: '优先伴奏',
            })}
            <div className="settings-buttons">
              <span>{models.providers.find((p) => p.id === models.active)?.label}</span>
              <Button
                size="small"
                aria-expanded={editing || guideTarget === 'model'}
                onClick={() => editModel(!(editing || guideTarget === 'model'))}
              >
                模型设置
              </Button>
            </div>
            {(editing || guideTarget === 'model') && (
              <ModelSettings
                info={models}
                close={() => editModel(false)}
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
            <h3>不参与智能推荐</h3>
            <p>右键文件夹或歌单可将其中歌曲排除出推荐偏好。主动收藏的歌曲仍会计入。</p>
            {taste?.exclusions?.map(({ kind, id, name }) => (
              <div className="settings-buttons" key={id}>
                <span>
                  {kind === 'folder' ? '文件夹' : '歌单'} · {name}
                </span>
                <Button
                  size="small"
                  disabled={busy}
                  aria-label={`恢复参与智能推荐：${name}`}
                  onClick={() =>
                    void update(async () => {
                      await window.music.setTasteExcluded(kind, id, false)
                      setTaste(await window.music.getTasteStatus())
                    })
                  }
                >
                  恢复参与
                </Button>
              </div>
            ))}
          </section>
        )}
        {category === 'keys' && (
          <section>
            <h2>快捷键</h2>
            <Checkbox
              label="启用应用内快捷键"
              checked={prefs.appKeys}
              onChange={(_, d) =>
                void update(() => window.music.setShortcutEnabled('app', !!d.checked))
              }
            />
            <p>空格播放或暂停，左右方向键切歌，上下方向键调节音量。</p>
            <Checkbox
              label="启用全局快捷键"
              checked={prefs.globalKeys}
              onChange={(_, d) =>
                void update(() => window.music.setShortcutEnabled('global', !!d.checked))
              }
            />
            <Checkbox
              label="启用键盘媒体键"
              disabled={!prefs.globalKeys}
              checked={prefs.mediaKeys}
              onChange={(_, d) =>
                void update(() => window.music.setMusicMediaKeys(d.checked === true))
              }
            />
            <p>点击输入框后按组合键或功能键，再点击保存。Esc 取消录制，退格键清空绑定。</p>
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
