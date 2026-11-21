import { ConnectionSettings } from './ConnectionSettings'
import { materialDefaults } from './material'
import { WorkbenchUpdates, type UpdateState } from './WorkbenchUpdates'
import { Download } from 'lucide-react'
import { WorkbenchChoice } from './WorkbenchChoice'
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LayoutDialog } from './LayoutDialog'
import { WorkspaceContext } from './WorkspaceContext'
import {
  selectLayoutName,
  switchLayout,
  readPresets,
  readStartup,
  writeStartup,
} from './layoutStorage'
import { useMusicHostState, type ComponentInventory } from './componentPrototype'
import { Button, Input, Slider, Switch } from '@fluentui/react-components'
import { Settings, ArrowLeft, Menu, Search, Palette, PanelsTopLeft, Boxes } from 'lucide-react'
import {
  fonts,
  languages,
  sizes,
  preferenceKey,
  useTranslation,
  type Preferences,
} from './preferences'

export function WorkbenchSettings({
  value,
  onChange,
  open,
  setOpen,
}: {
  value: Preferences
  open: boolean
  setOpen: (open: boolean) => void
  onChange: (next: Preferences) => void
}) {
  const t = useTranslation()
  const [updates, setUpdates] = useState<UpdateState>()
  useEffect(() => {
    const api = window.fitbayUpdates
    if (!api) return
    const dispose = api.onState(setUpdates)
    const navigate = api.onOpen(() => {
      setCategory(3)
      setQuery('')
      setExpanded(false)
      setOpen(true)
    })
    return () => {
      dispose()
      navigate()
    }
  }, [setOpen])
  // biome-ignore lint/correctness/useExhaustiveDependencies: Rescan installed products whenever settings opens or closes.
  useEffect(() => {
    let active = true
    window.fitbayUpdates
      ?.snapshot()
      .then((state) => {
        if (active) setUpdates(state)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [open])
  const [failed, setFailed] = useState(false)
  const [category, setCategory] = useState(0)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [manage, setManage] = useState(false)
  const [startup, setStartup] = useState(readStartup)
  const [inventory, setInventory] = useState<ComponentInventory>()
  const [promptInfo, setPromptInfo] = useState<ComponentInventory>()
  const [sampleInfo, setSampleInfo] = useState<ComponentInventory>()
  const sampleState = useMusicHostState(window.componentHost)
  const [componentError, setComponentError] = useState('')
  const [revision, refresh] = useState(0)
  const gear = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const [target, setTarget] = useState('')
  const workspace = useContext(WorkspaceContext)
  const music = useMusicHostState()
  const names = [
    t('外观', 'Appearance'),
    t('布局与启动', 'Layout and startup'),
    t('组件管理', 'Components'),
    t('更新', 'Updates'),
    t('API 与模型', 'API and models'),
  ]
  const keepLabel = t('关闭后继续在后台运行', 'Keep running in background after closing')
  const icons = [Palette, PanelsTopLeft, Boxes, Download, Settings]
  const sampleShowLabel = t('在工作台显示示例组件', 'Show sample in workspace')
  const entries = [
    [
      t('界面语言', 'Interface language'),
      t('字体', 'Font'),
      t('字号', 'Font size'),
      t('透明度', 'Transparency'),
      t('磨砂强度', 'Frost strength'),
      t('背景亮度', 'Background brightness'),
      t('恢复背景材质默认值', 'Restore default background material'),
    ],
    [
      t('启动时打开', 'On startup'),
      t('管理命名布局', 'Manage saved layouts'),
      t('切换到空白工作台', 'Switch to blank workspace'),
    ],
    [
      t('在工作台显示 Music', 'Show Music in workspace'),
      t('打开音乐设置', 'Open Music settings'),
      'Music · ' + keepLabel,
      ...(sampleInfo?.installed
        ? [t('示例组件', 'Sample component') + ' · ' + keepLabel, sampleShowLabel]
        : []),
    ],
  ]
  entries.push([t('检查全部更新', 'Check all updates')], [t('组件连接', 'Component connections')])
  const componentMatches = [
    { info: inventory, host: window.musicDock },
    { info: sampleInfo, host: window.componentHost },
    { info: promptInfo, host: window.promptDock },
  ].flatMap(({ info, host }) =>
    info?.installed && host
      ? (info.settingsEntries ?? [])
          .filter((e) => (e.path + ' ' + e.name).toLowerCase().includes(query.trim().toLowerCase()))
          .map((e) => ({ ...e, host }))
      : [],
  )
  const presets = readPresets().items
  const options = ['last', ...presets.map((item) => 'named:' + item.name), 'blank']
  const startupLabel = (key: string) =>
    key === 'last'
      ? t('上次工作区', 'Last workspace')
      : key === 'blank'
        ? t('空白工作台', 'Blank workspace')
        : key.slice(6)
  function close() {
    setOpen(false)
    requestAnimationFrame(() => gear.current?.focus())
  }
  useLayoutEffect(() => {
    if (open) search.current?.focus()
  }, [open])
  useLayoutEffect(() => {
    if (!target) return
    const element = document.getElementById(target)
    element?.scrollIntoView({ block: 'nearest' })
    const control = element?.querySelector<HTMLElement>('button,input')
    if (control?.matches(':disabled') && !inventory) return
    if (!element && !sampleInfo) return
    control?.focus()
    setTarget('')
  }, [target, inventory, sampleInfo])
  // biome-ignore lint/correctness/useExhaustiveDependencies: An explicit refresh repeats the disk scan.
  useEffect(() => {
    if (!open) return
    let active = true
    if (window.componentHost?.sampleEnabled)
      void window.componentHost
        .inventory()
        .then((info) => {
          if (active) setSampleInfo(info)
        })
        .catch((error) => {
          if (active) setComponentError(String(error))
        })
    window.promptDock
      ?.inventory()
      .then((info) => {
        if (active) setPromptInfo(info)
      })
      .catch(() => {
        if (active) setPromptInfo(undefined)
      })
    window.musicDock
      ?.inventory()
      .then((value) => {
        if (active) setInventory(value)
      })
      .catch((error) => {
        if (active) setComponentError(String(error))
      })
    return () => {
      active = false
    }
  }, [open, revision])
  async function showMusic(settings: boolean) {
    try {
      const result = await window.musicDock?.show(settings)
      if (result?.ok) close()
      else setComponentError(result?.error ?? t('组件不可用', 'Component unavailable'))
    } catch (error) {
      setComponentError(String(error))
    }
  }
  function change(next: Preferences) {
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(next))
      onChange(next)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }
  const title = t('工作台设置', 'Workbench settings')
  const fontNames = {
    default: t('默认（HarmonyOS Sans SC）', 'Default (HarmonyOS Sans SC)'),
    yahei: t('微软雅黑 UI', 'Microsoft YaHei UI'),
    segoe: 'Segoe UI Variable',
  }
  const sizeNames = {
    small: t('小', 'Small'),
    standard: t('标准', 'Standard'),
    large: t('大', 'Large'),
  }
  return (
    <>
      <Button
        ref={gear}
        appearance="subtle"
        className="settings-trigger"
        icon={
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <Settings size={19} />
            {updates?.rows.some((row) => row.status === 'available') && (
              <span
                role="img"
                aria-label={t('有可用更新', 'Update available')}
                style={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: '#61acff',
                }}
              />
            )}
          </span>
        }
        aria-label={title}
        title={title}
        aria-expanded={open}
        onClick={() => {
          if (open) close()
          else {
            setCategory(0)
            setQuery('')
            setExpanded(false)
            setOpen(true)
          }
        }}
      />
      {open && (
        <section
          className="workbench-settings-page"
          role="dialog"
          aria-labelledby="workbench-settings-title"
          onKeyDown={(event) => {
            if (
              event.key === 'Escape' &&
              !event.defaultPrevented &&
              !manage &&
              !document.querySelector('[role=listbox]')
            ) {
              event.stopPropagation()
              close()
            }
          }}
        >
          <header className="settings-page-heading">
            <Button
              appearance="subtle"
              icon={<ArrowLeft size={18} />}
              aria-label={t('关闭设置', 'Close settings')}
              onClick={close}
            />
            <h1 id="workbench-settings-title">{title}</h1>
            <Input
              ref={search}
              type="search"
              contentBefore={<Search size={16} />}
              aria-label={t('搜索设置', 'Search settings')}
              placeholder={t('搜索设置', 'Search settings')}
              value={query}
              onChange={(_, v) => setQuery(v.value)}
            />
          </header>
          <div className="settings-body">
            <nav aria-label={t('设置分类', 'Settings categories')} data-expanded={expanded}>
              <Button
                className="category-toggle"
                appearance="subtle"
                icon={<Menu size={17} />}
                aria-expanded={expanded}
                onClick={() => setExpanded(!expanded)}
              >
                {names[category]}
              </Button>
              {names.map((name, i) => {
                const Icon = icons[i]
                return (
                  <Button
                    className="category-link"
                    appearance="subtle"
                    key={name}
                    aria-current={i === category ? 'page' : undefined}
                    icon={<Icon size={17} />}
                    onClick={() => {
                      setCategory(i)
                      setQuery('')
                      setExpanded(false)
                    }}
                  >
                    {name}
                  </Button>
                )
              })}
            </nav>
            <article className="settings-content">
              {query.trim() ? (
                <>
                  <h2>{t('搜索结果', 'Search results')}</h2>
                  {entries
                    .flatMap((group, i) => group.map((name, j) => ({ name, i, j })))
                    .filter(({ name, i }) =>
                      (names[i] + name).toLowerCase().includes(query.trim().toLowerCase()),
                    )
                    .map(({ name, i, j }) => (
                      <Button
                        key={i + '-' + j}
                        appearance="subtle"
                        onClick={() => {
                          setTarget('setting-' + i + '-' + j)
                          setCategory(i)
                          setQuery('')
                          setExpanded(false)
                        }}
                      >
                        {names[i]} › {name}
                      </Button>
                    ))}
                  {componentMatches.map((e) => (
                    <Button
                      key={e.path}
                      appearance="subtle"
                      onClick={async () => {
                        try {
                          const result = await e.host.show(true, e.target)
                          if (result.ok) close()
                          else {
                            setComponentError(result.error ?? '设置项已不可用')
                            refresh((n) => n + 1)
                          }
                        } catch (error) {
                          setComponentError(String(error))
                        }
                      }}
                    >
                      {e.path.replaceAll(' → ', ' › ')}
                    </Button>
                  ))}
                  {componentError && <p role="alert">{componentError}</p>}
                  {!componentMatches.length &&
                    !entries.some((group, i) =>
                      group.some((name) =>
                        (names[i] + name).toLowerCase().includes(query.trim().toLowerCase()),
                      ),
                    ) && <p>{t('没有匹配的设置', 'No matching settings')}</p>}
                </>
              ) : (
                <>
                  <h2>{names[category]}</h2>
                  {category === 4 && <ConnectionSettings />}
                  {category === 3 && <WorkbenchUpdates state={updates} />}
                  {category === 0 && (
                    <>
                      <p>
                        {t(
                          '语言、字体和字号作用于工作台。',
                          'Language, font and size apply to the workbench.',
                        )}
                      </p>
                      <div id="setting-0-0">
                        {' '}
                        <WorkbenchChoice
                          label={t('界面语言', 'Interface language')}
                          values={languages}
                          value={value.language}
                          text={(key) => (key === 'en' ? 'English' : '简体中文')}
                          onChange={(language) => change({ ...value, language })}
                        />
                      </div>
                      <div id="setting-0-1">
                        {' '}
                        <WorkbenchChoice
                          label={t('字体', 'Font')}
                          values={fonts}
                          value={value.font}
                          text={(key) => fontNames[key]}
                          onChange={(font) => change({ ...value, font })}
                        />
                      </div>
                      <div id="setting-0-2">
                        {' '}
                        <WorkbenchChoice
                          label={t('字号', 'Font size')}
                          values={sizes}
                          value={value.size}
                          text={(key) => sizeNames[key]}
                          onChange={(size) => change({ ...value, size })}
                        />
                      </div>
                      <fieldset className="settings-material" id="setting-0-6">
                        <legend>{t('背景材质', 'Background material')}</legend>
                        <Button
                          size="small"
                          appearance="subtle"
                          className="reset-material"
                          onClick={() => change({ ...value, ...materialDefaults })}
                        >
                          {t('恢复默认', 'Restore defaults')}
                        </Button>
                        {(
                          [
                            ['transparency', t('透明度', 'Transparency')],
                            ['frost', t('磨砂强度', 'Frost strength')],
                            ['brightness', t('背景亮度', 'Background brightness')],
                          ] as const
                        ).map(([key, label], index) => (
                          <div
                            className="material-control"
                            id={'setting-0-' + (index + 3)}
                            key={key}
                          >
                            <label htmlFor={'material-' + key}>{label}</label>
                            <span aria-hidden="true">{value[key]}%</span>
                            <Slider
                              id={'material-' + key}
                              min={0}
                              max={100}
                              value={value[key]}
                              aria-valuetext={value[key] + '%'}
                              onChange={(_, data) => change({ ...value, [key]: data.value })}
                            />
                          </div>
                        ))}
                      </fieldset>
                    </>
                  )}
                  {category === 1 && (
                    <>
                      <div id="setting-1-0">
                        <WorkbenchChoice
                          label={entries[1][0]}
                          values={options}
                          value={options.includes(startup) ? startup : 'last'}
                          text={startupLabel}
                          onChange={(next) => {
                            try {
                              writeStartup(next)
                              setStartup(next)
                              setFailed(false)
                            } catch {
                              setFailed(true)
                            }
                          }}
                        />
                      </div>
                      <div id="setting-1-1">
                        <Button disabled={!workspace.api} onClick={() => setManage(true)}>
                          {entries[1][1]}
                        </Button>
                      </div>
                      <div id="setting-1-2">
                        <Button
                          disabled={!workspace.api}
                          onClick={() => {
                            if (workspace.api) {
                              switchLayout(workspace.api, undefined, true)
                              selectLayoutName('')
                              close()
                            }
                          }}
                        >
                          {entries[1][2]}
                        </Button>
                      </div>
                      {manage && workspace.api && (
                        <LayoutDialog api={workspace.api} onClose={() => setManage(false)} />
                      )}
                    </>
                  )}
                  {category === 2 && (
                    <>
                      <div className="component-inventory">
                        <h3>Music</h3>
                        <Button
                          size="small"
                          onClick={() => {
                            setComponentError('')
                            refresh(revision + 1)
                          }}
                        >
                          {t('刷新', 'Refresh')}
                        </Button>
                      </div>
                      <p>
                        {inventory?.installed
                          ? [
                              inventory.version,
                              music?.phase === 'ready'
                                ? music.presentation === 'background'
                                  ? t('后台运行', 'Running in background')
                                  : music.mode === 'standalone'
                                    ? t('独立窗口运行中', 'Running independently')
                                    : t('工作台内运行中', 'Running in workspace')
                                : t('未运行', 'Stopped'),
                            ]
                              .filter(Boolean)
                              .join(' · ')
                          : !window.musicDock || inventory
                            ? t('未安装', 'Not installed')
                            : t('正在检测…', 'Checking…')}
                      </p>
                      {entries[2].slice(0, 2).map((label, i) => (
                        <div key={label} id={'setting-2-' + i}>
                          <Button
                            disabled={!inventory?.installed}
                            onClick={() => void showMusic(i === 1)}
                          >
                            {label}
                          </Button>
                        </div>
                      ))}
                      {inventory?.installed && (
                        <div id="setting-2-2">
                          <Switch
                            label={keepLabel}
                            aria-label={entries[2][2]}
                            checked={music?.keepRunning ?? false}
                            onChange={(_, data) =>
                              void window.musicDock
                                ?.keepRunning(data.checked)
                                .catch((error) => setComponentError(String(error)))
                            }
                          />
                        </div>
                      )}
                      {sampleInfo?.installed && (
                        <>
                          <h3>{t('示例组件', 'Sample component')}</h3>
                          <div id="setting-2-3">
                            <Switch
                              label={keepLabel}
                              aria-label={entries[2][3]}
                              checked={sampleState?.keepRunning ?? false}
                              onChange={(_, data) =>
                                void window.componentHost
                                  ?.keepRunning(data.checked)
                                  .catch((error) => setComponentError(String(error)))
                              }
                            />
                          </div>
                          <p>
                            {sampleInfo.version} ·{' '}
                            {sampleState?.phase === 'ready'
                              ? sampleState.presentation === 'background'
                                ? t('后台运行', 'Running in background')
                                : t('运行中', 'Running')
                              : t('未运行', 'Stopped')}
                          </p>
                          <div id="setting-2-4">
                            <Button
                              onClick={async () => {
                                try {
                                  const result = await window.componentHost?.open()
                                  if (result?.ok) close()
                                  else setComponentError(result?.error ?? '')
                                } catch (error) {
                                  setComponentError(String(error))
                                }
                              }}
                            >
                              {sampleShowLabel}
                            </Button>
                          </div>
                        </>
                      )}
                      {componentError && <p role="alert">{componentError}</p>}
                    </>
                  )}
                </>
              )}
              {failed && (
                <span role="alert">
                  {t(
                    '保存失败，请检查应用存储空间后重试。',
                    'Could not save. Check the available storage and try again.',
                  )}
                </span>
              )}
            </article>
          </div>
        </section>
      )}
    </>
  )
}
