import { openToolkitPanel, ToolkitIcon } from './ToolkitEntry'
import { useTranslation } from './preferences'
import { useCallback, useContext, useEffect, useRef, useState, type ReactElement } from 'react'
import {
  Button,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuSplitGroup,
  MenuItem,
} from '@fluentui/react-components'
import {
  ChevronDown,
  Check,
  Eye,
  EyeOff,
  Plus,
  PanelsTopLeft,
  AudioLines,
  Folder,
  Boxes,
  X,
} from 'lucide-react'
import { WorkspaceContext } from './WorkspaceContext'
import { modules } from './moduleRegistry'
import { openModule } from './workspace'

import { readPresets, switchLayout, currentLayoutName, selectLayoutName } from './layoutStorage'
import { LayoutDialog } from './LayoutDialog'
import { useMusicHostState } from './componentPrototype'

declare global {
  interface Window {
    fitbayToolkit?: {
      local: Record<string, (input?: unknown) => Promise<unknown>>
      capture(): Promise<boolean>
      available(): Promise<boolean>
      open(tool?: string): Promise<boolean>
    }
  }
}
function ComponentMenuRow({
  name,
  icon,
  status,
  checked,
  open,
  action,
}: {
  name: string
  icon: ReactElement
  status: string
  checked?: boolean
  open: () => void
  action: { label: string; icon: ReactElement; disabled: boolean; run: () => void }
}) {
  return (
    <MenuSplitGroup className="component-menu-row">
      <MenuItem
        role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
        aria-checked={checked}
        aria-label={name}
        onClick={open}
      >
        <span className="component-menu-columns">
          <span aria-hidden="true">{icon}</span>
          <span>{name}</span>
          <small>{status}</small>
        </span>
      </MenuItem>
      <MenuItem
        aria-label={action.label}
        title={action.label}
        disabled={action.disabled}
        icon={action.icon}
        onClick={action.run}
      />
    </MenuSplitGroup>
  )
}
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
  const [toolkit, setToolkit] = useState(false)
  const inspect = useCallback(() => {
    void window.fitbayToolkit
      ?.available()
      .then(setToolkit)
      .catch(() => setToolkit(false))
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
  const toolkitOpen = workspace.visible.includes('component-toolkit')
  const promptRunning = promptState?.phase === 'ready' || promptState?.phase === 'attaching'
  const promptHidden = promptState?.presentation === 'background'
  function status(open: boolean, background: boolean) {
    return open
      ? background
        ? t('后台运行', 'In background')
        : t('显示中', 'Visible')
      : t('未打开', 'Not open')
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
            {installed && (
              <ComponentMenuRow
                name="Music"
                icon={<AudioLines size={16} />}
                status={status(running, hidden)}
                checked={running}
                open={() => void toggleRunning(window.musicDock)}
                action={{
                  label: visibilityLabel,
                  icon: hidden ? <EyeOff size={16} /> : <Eye size={16} />,
                  disabled: music?.phase !== 'ready',
                  run: () => void window.musicDock?.toggleVisibility(),
                }}
              />
            )}
            {toolkit && (
              <ComponentMenuRow
                name={t('工具集', 'Toolkit')}
                icon={<ToolkitIcon />}
                status={toolkitOpen ? t('已打开', 'Open') : t('未打开', 'Not open')}
                open={() =>
                  workspace.api && openToolkitPanel(workspace.api, t('工具集', 'Toolkit'))
                }
                action={{
                  label: t('关闭工具集', 'Close toolkit'),
                  icon: <X size={16} />,
                  disabled: !toolkitOpen,
                  run: () => workspace.api?.getPanel('component-toolkit')?.api.close(),
                }}
              />
            )}
            {hasPrompts && (
              <ComponentMenuRow
                name={t('文件库', 'File library')}
                icon={<Folder size={16} />}
                status={status(promptRunning, promptHidden)}
                checked={promptRunning}
                open={() => void toggleRunning(window.promptDock)}
                action={{
                  label: promptHidden
                    ? t('显示文件库', 'Show file library')
                    : t('隐藏文件库', 'Hide file library'),
                  icon: promptHidden ? <EyeOff size={16} /> : <Eye size={16} />,
                  disabled: promptState?.phase !== 'ready',
                  run: () => void window.promptDock?.toggleVisibility(),
                }}
              />
            )}
            {sample && (
              <ComponentMenuRow
                name={t('示例组件', 'Sample component')}
                icon={<Boxes size={16} />}
                status={status(sampleRunning, sampleHidden)}
                checked={sampleRunning}
                open={() => void toggleRunning(window.componentHost)}
                action={{
                  label: sampleVisibilityLabel,
                  icon: sampleHidden ? <EyeOff size={16} /> : <Eye size={16} />,
                  disabled: sampleState?.phase !== 'ready',
                  run: () => void window.componentHost?.toggleVisibility(),
                }}
              />
            )}
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
            {!modules.length && !toolkit && !installed && !sample && !hasPrompts && (
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
