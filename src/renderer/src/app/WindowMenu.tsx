import type { useEdgeCollapse } from './useEdgeCollapse'
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
  X,
  Plus,
  PanelsTopLeft,
  AudioLines,
  Folder,
  Boxes,
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
      shortcuts(value: unknown): Promise<unknown>
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
  close,
  action,
}: {
  name: string
  icon: ReactElement
  status: string
  checked?: boolean
  close: () => void
  open: () => void
  action: {
    label: string
    icon: ReactElement
    disabled: boolean
    run: () => void
  }
}) {
  const t = useTranslation()
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
      <MenuItem
        aria-label={t('关闭', 'Close ') + name}
        title={t('关闭', 'Close ') + name}
        disabled={!checked}
        icon={<X size={16} />}
        onClick={close}
      />
    </MenuSplitGroup>
  )
}
export function WindowMenu({ collapsed }: { collapsed: ReturnType<typeof useEdgeCollapse> }) {
  const t = useTranslation()
  const music = useMusicHostState()
  const [hasPrompts, setPrompts] = useState(false)
  const promptState = useMusicHostState(window.promptDock)
  const sampleState = useMusicHostState(window.componentHost)
  const workspace = useContext(WorkspaceContext)
  function obscured(id: string) {
    const panel = workspace.api?.getPanel(id)
    return panel && (!panel.group.api.isVisible || panel.group.activePanel !== panel)
  }
  function toggleEye(id: string, toggle?: () => unknown) {
    const panel = workspace.api?.getPanel(id)
    if (panel && obscured(id)) {
      const entry = collapsed.find((item) => item.panels.includes(id))
      if (entry) entry.restore()
      else panel.group.api.setVisible(true)
      panel.api.setActive()
    } else void toggle?.()
  }
  const sampleRunning = sampleState?.phase === 'ready' || sampleState?.phase === 'attaching'
  const sampleHidden =
    sampleState?.presentation === 'background' ||
    Boolean(sampleState?.mode === 'docked' && obscured('component-example'))
  const sampleVisibilityLabel = sampleHidden
    ? t('显示示例组件', 'Show sample')
    : t('隐藏示例组件', 'Hide sample')
  const running = music?.phase === 'ready' || music?.phase === 'attaching'
  const hidden =
    music?.presentation === 'background' ||
    Boolean(music?.mode === 'docked' && obscured('component-music'))
  const visibilityLabel = hidden ? t('显示 Music', 'Show Music') : t('隐藏 Music', 'Hide Music')
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
  function restoreForOpen(id: string) {
    const panel = workspace.api?.getPanel(id)
    if (panel?.group.api.isVisible) return
    const entry = panel ? collapsed.find((item) => item.panels.includes(id)) : collapsed.at(-1)
    entry?.restore()
  }
  async function openComponent(host: Window['componentHost'], id: string) {
    if (!host) return
    try {
      if (workspace.api?.hasMaximizedGroup()) workspace.api.exitMaximizedGroup()
      restoreForOpen(id)
      setMusicError((await host.show(false)).error ?? '')
    } catch (error) {
      setMusicError(String(error))
    }
  }
  const toolkitPanel = workspace.api?.getPanel('component-toolkit')
  const [, refreshVisibility] = useState(0)
  useEffect(() => {
    if (!toolkitPanel) return
    const refresh = () => refreshVisibility((version) => version + 1)
    const panelChange = toolkitPanel.api.onDidVisibilityChange(refresh)
    const groupChange = toolkitPanel.group.api.onDidVisibilityChange(refresh)
    return () => {
      panelChange.dispose()
      groupChange.dispose()
    }
  }, [toolkitPanel, toolkitPanel?.group])
  const toolkitOpen = Boolean(toolkitPanel)
  const toolkitHidden = Boolean(
    toolkitPanel &&
      (!toolkitPanel.group.api.isVisible || toolkitPanel.group.activePanel !== toolkitPanel),
  )
  const promptRunning = promptState?.phase === 'ready' || promptState?.phase === 'attaching'
  const promptHidden =
    promptState?.presentation === 'background' ||
    Boolean(promptState?.mode === 'docked' && obscured('component-prompts'))
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
                open={() => void openComponent(window.musicDock, 'component-music')}
                close={() =>
                  void window.musicDock?.stop().catch((error) => setMusicError(String(error)))
                }
                action={{
                  label: visibilityLabel,
                  icon: hidden ? <EyeOff size={16} /> : <Eye size={16} />,
                  disabled: music?.phase !== 'ready',
                  run: () => toggleEye('component-music', window.musicDock?.toggleVisibility),
                }}
              />
            )}
            {toolkit && (
              <ComponentMenuRow
                name={t('工具集', 'Toolkit')}
                icon={<ToolkitIcon />}
                status={status(toolkitOpen, toolkitHidden)}
                checked={toolkitOpen}
                close={() => {
                  if (toolkitPanel) workspace.api?.removePanel(toolkitPanel)
                }}
                open={() => {
                  if (!workspace.api) return
                  restoreForOpen('component-toolkit')
                  openToolkitPanel(workspace.api, t('工具集', 'Toolkit'))
                }}
                action={{
                  label: toolkitHidden
                    ? t('显示工具集', 'Show toolkit')
                    : t('隐藏工具集', 'Hide toolkit'),
                  icon: toolkitHidden ? <EyeOff size={16} /> : <Eye size={16} />,
                  disabled: !toolkitOpen,
                  run: () => {
                    if (!toolkitPanel) return
                    const group = toolkitPanel.group
                    if (toolkitHidden) {
                      const entry = collapsed.find((item) => item.panels.includes(toolkitPanel.id))
                      if (entry) entry.restore()
                      else group.api.setVisible(true)
                      toolkitPanel.api.setActive()
                    } else {
                      const sibling = group.panels.find((panel) => panel !== toolkitPanel)
                      if (sibling) sibling.api.setActive()
                      else group.api.setVisible(false)
                    }
                  },
                }}
              />
            )}
            {hasPrompts && (
              <ComponentMenuRow
                name={t('提示词库', 'Prompt library')}
                icon={<Folder size={16} />}
                status={status(promptRunning, promptHidden)}
                checked={promptRunning}
                open={() => void openComponent(window.promptDock, 'component-prompts')}
                close={() =>
                  void window.promptDock?.stop().catch((error) => setMusicError(String(error)))
                }
                action={{
                  label: promptHidden
                    ? t('显示提示词库', 'Show prompt library')
                    : t('隐藏提示词库', 'Hide prompt library'),
                  icon: promptHidden ? <EyeOff size={16} /> : <Eye size={16} />,
                  disabled: promptState?.phase !== 'ready',
                  run: () => toggleEye('component-prompts', window.promptDock?.toggleVisibility),
                }}
              />
            )}
            {sample && (
              <ComponentMenuRow
                name={t('示例组件', 'Sample component')}
                icon={<Boxes size={16} />}
                status={status(sampleRunning, sampleHidden)}
                checked={sampleRunning}
                open={() => void openComponent(window.componentHost, 'component-example')}
                close={() =>
                  void window.componentHost?.stop().catch((error) => setMusicError(String(error)))
                }
                action={{
                  label: sampleVisibilityLabel,
                  icon: sampleHidden ? <EyeOff size={16} /> : <Eye size={16} />,
                  disabled: sampleState?.phase !== 'ready',
                  run: () => toggleEye('component-example', window.componentHost?.toggleVisibility),
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
            {collapsed.map((entry) => (
              <MenuItem key={entry.id} onClick={entry.restore}>
                {t('恢复分屏', 'Restore split')} · {entry.names}
              </MenuItem>
            ))}
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
