import { ToolkitPanel } from './ToolkitPanel'
import { useTranslation } from './preferences'
import { FirstWorkspaceAction } from './FirstWorkspaceAction'
import { fixtureWorkspace } from './moduleRegistry'
import { useState, useEffect, useContext } from 'react'
import type {
  IDockviewHeaderActionsProps,
  IDockviewPanelProps,
  IWatermarkPanelProps,
} from 'dockview-react'
import { Minimize2, Maximize2, PanelsTopLeft, X } from 'lucide-react'
import { WorkspaceContext } from './WorkspaceContext'
import { readPresets, switchLayout } from './layoutStorage'
import { NavigationPanel } from '../../../../tests/fixtures/workspace/NavigationPanel'
import { CanvasPanel } from '../../../../tests/fixtures/workspace/CanvasPanel'
import { Inspector } from '../../../../tests/fixtures/workspace/Inspector'
import { BottomPanel } from '../../../../tests/fixtures/workspace/BottomPanel'
import { ComponentSlot } from './componentPrototype'

function ModulePanel({ api }: IDockviewPanelProps) {
  return <BuiltinContent id={api.id} />
}
export function BuiltinContent({ id }: { id: string }) {
  switch (id) {
    case 'module-1':
      return <NavigationPanel />
    case 'module-2':
      return <CanvasPanel />
    case 'module-3':
      return <Inspector />
    case 'module-4':
      return <BottomPanel />
    default:
      return null
  }
}
export const components = {
  toolkit: ToolkitPanel,
  module: ModulePanel,
  'component-slot': ComponentSlot,
}

export function HeaderActions({ api, containerApi, group, panels }: IDockviewHeaderActionsProps) {
  const t = useTranslation()
  const [maximized, setMaximized] = useState(api.isMaximized())
  useEffect(() => {
    const subscription = containerApi.onDidMaximizedGroupChange(() =>
      setMaximized(api.isMaximized()),
    )
    return () => subscription.dispose()
  }, [api, containerApi])
  return (
    <>
      <button
        type="button"
        className="icon-button header-action"
        aria-label={maximized ? t('还原面板', 'Restore panel') : t('最大化面板', 'Maximize panel')}
        title={maximized ? t('还原面板', 'Restore panel') : t('最大化面板', 'Maximize panel')}
        onClick={() => {
          if (api.isMaximized()) api.exitMaximized()
          else api.maximize()
          setMaximized(api.isMaximized())
        }}
      >
        {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
      </button>
      {!panels.length && (
        <button
          type="button"
          className="icon-button header-action"
          title={t('关闭快速开始', 'Close quick start')}
          aria-label={t('关闭快速开始', 'Close quick start')}
          onClick={() => containerApi.removeGroup(group)}
        >
          <X size={13} />
        </button>
      )}
    </>
  )
}

export function EmptyWorkspace({ group }: IWatermarkPanelProps) {
  const t = useTranslation()
  const { api } = useContext(WorkspaceContext)
  if (!fixtureWorkspace && !group) return null
  if (!fixtureWorkspace)
    return (
      <section className="empty-workspace quick-start">
        <h2>{t('快速开始', 'Quick start')}</h2>
        <FirstWorkspaceAction />
      </section>
    )
  return (
    <div className="empty-workspace">
      <PanelsTopLeft size={40} strokeWidth={1} />
      <h2>{t('留一点空间给新的想法', 'Make room for new ideas')}</h2>
      <p>
        {t(
          '从「组件」菜单打开模块，或恢复默认布局。',
          'Open a module from the Components menu or restore the default layout.',
        )}
      </p>
      <button
        type="button"
        className="primary-button"
        onClick={() => {
          const presets = readPresets()
          if (api)
            switchLayout(
              api,
              presets.items.find((item) => item.name === presets.defaultName)?.layout,
            )
        }}
      >
        {t('恢复默认布局', 'Restore default layout')}
      </button>
    </div>
  )
}
