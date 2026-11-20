import { useTranslation } from './preferences'
import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import {
  Button,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuSplitGroup,
  MenuItem,
} from '@fluentui/react-components'
import { ChevronDown, Check, Eye, EyeOff, Plus, PanelsTopLeft } from 'lucide-react'
import { WorkspaceContext } from './WorkspaceContext'
import { modules } from './moduleRegistry'
import { openModule } from './workspace'

import { readPresets, switchLayout, currentLayoutName, selectLayoutName } from './layoutStorage'
import { LayoutDialog } from './LayoutDialog'
import { useMusicHostState } from './componentPrototype'

export function WindowMenu() {
  const t = useTranslation()
  const music = useMusicHostState()
  const [hasPrompts, setPrompts] = useState(false)
  const promptState = useMusicHostState(window.promptDock)
  const sampleState = useMusicHostState(window.componentHost)
  const sampleRunning = sampleState?.phase === 'ready' || sampleState?.phase === 'attaching'
  const sampleHidden = sampleState?.presentation === 'background'
  const sampleVisibilityLabel = sampleHidden
    ? t('显示示例组件', 'Show sample')
    : t('隐藏示例组件', 'Hide sample')
  const running = music?.phase === 'ready' || music?.phase === 'attaching'
  const hidden = music?.presentation === 'background'
  const visibilityLabel = hidden ? t('显示 Music', 'Show Music') : t('隐藏 Music', 'Hide Music')
  const workspace = useContext(WorkspaceContext)
  const [musicError, setMusicError] = useState('')
  const [layoutsOpen, setLayoutsOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const [installed, setInstalled] = useState(false)
  const [sample, setSample] = useState(false)
  const [activeName, setActiveName] = useState(currentLayoutName)
  const layoutTrigger = useRef<HTMLButtonElement>(null)
  const panels = workspace.api?.panels ?? []
  const inspect = useCallback(() => {
    void window.promptDock
      ?.inventory()
      .then((r) => setPrompts(r.installed))
      .catch(() => setPrompts(false))
    void window.musicDock
      ?.inventory()
      .then((info) => setInstalled(info.installed))
      .catch(() => setInstalled(false))
    if (window.componentHost?.sampleEnabled)
      void window.componentHost
        .inventory()
        .then((info) => setSample(info.installed))
        .catch(() => setSample(false))
  }, [])
  useEffect(() => {
    inspect()
    const sync = () => setActiveName(currentLayoutName())
    window.addEventListener('fitbay-layout-name', sync)
    return () => window.removeEventListener('fitbay-layout-name', sync)
  }, [inspect])
  async function toggleRunning(host: Window['componentHost']) {
    if (!host) return
    try {
      const state = await host.status()
      if (state.phase === 'ready' || state.phase === 'attaching') {
        await host.stop()
        setMusicError('')
      } else setMusicError((await host.open()).error ?? '')
    } catch (error) {
      setMusicError(String(error))
    }
  }
  function arrange(position: 'right' | 'bottom') {
    if (panels.length !== 2) return
    panels[1].api.moveTo({ group: panels[0].group, position })
    selectLayoutName('')
  }
  return (
    <>
      <Menu
        onOpenChange={(_, data) => {
          if (data.open) inspect()
        }}
        positioning={{
          position: 'below',
          align: 'start',
        }}
      >
        <MenuTrigger disableButtonEnhancement>
          <Button
            ref={trigger}
            appearance="subtle"
            icon={<ChevronDown size={14} />}
            iconPosition="after"
          >
            {t('组件', 'Components')}
          </Button>
        </MenuTrigger>
        <MenuPopover className="component-popup workbench-menu">
          <MenuList aria-label={t('组件菜单', 'Components menu')} id="window-menu">
            {modules.map((module) => (
              <MenuItem
                key={module.id}
                icon={
                  workspace.visible.includes(module.id) ? <Check size={16} /> : <Plus size={16} />
                }
                onClick={() => workspace.api && openModule(workspace.api, module.id)}
              >
                {module.title}
              </MenuItem>
            ))}
            {hasPrompts && (
              <MenuItem
                role="menuitemcheckbox"
                aria-checked={promptState?.phase === 'ready'}
                onClick={() => void toggleRunning(window.promptDock)}
              >
                {t('提示词仓库', 'Prompt library')}
              </MenuItem>
            )}
            {sample && (
              <MenuSplitGroup>
                <MenuItem
                  role="menuitemcheckbox"
                  aria-checked={sampleRunning}
                  icon={sampleRunning ? <Check size={16} /> : <Plus size={16} />}
                  aria-label={t('示例组件', 'Sample component')}
                  onClick={() => void toggleRunning(window.componentHost)}
                >
                  {t('示例组件', 'Sample component')}
                  <small>
                    {sampleState?.phase === 'ready'
                      ? sampleHidden
                        ? t('后台运行', 'In background')
                        : t('显示中', 'Visible')
                      : t('未打开', 'Not open')}
                  </small>
                </MenuItem>
                <MenuItem
                  disabled={sampleState?.phase !== 'ready'}
                  aria-label={sampleVisibilityLabel}
                  title={sampleVisibilityLabel}
                  icon={sampleHidden ? <EyeOff size={16} /> : <Eye size={16} />}
                  onClick={() => void window.componentHost?.toggleVisibility()}
                />
              </MenuSplitGroup>
            )}
            {installed && (
              <MenuSplitGroup>
                <MenuItem
                  role="menuitemcheckbox"
                  aria-label="Music"
                  aria-checked={running}
                  icon={running ? <Check size={16} /> : <Plus size={16} />}
                  onClick={() => void toggleRunning(window.musicDock)}
                >
                  <span>Music</span>
                  <small>
                    {running
                      ? hidden
                        ? t('后台运行', 'In background')
                        : t('显示中', 'Visible')
                      : t('未打开', 'Not open')}
                  </small>
                </MenuItem>
                <MenuItem
                  className="music-menu-reveal"
                  aria-label={visibilityLabel}
                  title={visibilityLabel}
                  disabled={music?.phase !== 'ready'}
                  icon={hidden ? <EyeOff size={16} /> : <Eye size={16} />}
                  onClick={() => void window.musicDock?.toggleVisibility()}
                />
              </MenuSplitGroup>
            )}
            {!modules.length && !installed && !sample && !hasPrompts && (
              <MenuItem disabled>{t('未检测到已安装组件', 'No installed components')}</MenuItem>
            )}
          </MenuList>
        </MenuPopover>
      </Menu>
      <Menu positioning={{ position: 'below', align: 'start' }}>
        <MenuTrigger disableButtonEnhancement>
          <Button
            ref={layoutTrigger}
            appearance="subtle"
            icon={<ChevronDown size={14} />}
            iconPosition="after"
          >
            {t('布局', 'Layouts')}
          </Button>
        </MenuTrigger>
        <MenuPopover className="component-popup workbench-menu">
          <MenuList>
            {panels.length === 2 && (
              <>
                <MenuItem onClick={() => arrange('right')}>
                  {t('左右并排', 'Side by side')}
                </MenuItem>
                <MenuItem onClick={() => arrange('bottom')}>
                  {t('上下并排', 'Stack vertically')}
                </MenuItem>
              </>
            )}
            {readPresets().items.map((item) => (
              <MenuItem
                key={item.name}
                onClick={() => {
                  if (workspace.api) {
                    switchLayout(workspace.api, item.layout)
                    selectLayoutName(item.name)
                  }
                }}
              >
                {item.name}
              </MenuItem>
            ))}
            <MenuItem icon={<PanelsTopLeft size={16} />} onClick={() => setLayoutsOpen(true)}>
              {t('管理布局', 'Manage layouts')}
            </MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
      {activeName && <span className="toolbar-layout-name">{activeName}</span>}
      {layoutsOpen && workspace.api && (
        <LayoutDialog
          api={workspace.api}
          onClose={() => {
            setLayoutsOpen(false)
            layoutTrigger.current?.focus()
          }}
        />
      )}
      {musicError && <span role="alert">{musicError}</span>}
    </>
  )
}
