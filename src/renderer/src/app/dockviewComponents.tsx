import { useTranslation } from './preferences'
import { FirstWorkspaceAction } from './FirstWorkspaceAction'
import { fixtureWorkspace } from './moduleRegistry'
import { useState, useEffect, useContext } from 'react'
import type { IDockviewHeaderActionsProps, IDockviewPanelProps } from 'dockview-react'
import { Minimize2, Maximize2, PanelsTopLeft } from 'lucide-react'
import { WorkspaceContext } from './WorkspaceContext'
import { readPresets, switchLayout } from './layoutStorage'
import { NavigationPanel } from '../../../../tests/fixtures/workspace/NavigationPanel'
import { CanvasPanel } from '../../../../tests/fixtures/workspace/CanvasPanel'
import { Inspector } from '../../../../tests/fixtures/workspace/Inspector'
import { BottomPanel } from '../../../../tests/fixtures/workspace/BottomPanel'
import { ComponentSlot, useDockedMusicBar } from './componentPrototype'

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
  module: ModulePanel,
  'component-slot': ComponentSlot,
}

export function HeaderActions({ api, containerApi }: IDockviewHeaderActionsProps) {
  const t = useTranslation()
  const [maximized, setMaximized] = useState(api.isMaximized())
  useEffect(() => {
    const subscription = containerApi.onDidMaximizedGroupChange(() =>
      setMaximized(api.isMaximized()),
    )
    return () => subscription.dispose()
  }, [api, containerApi])
  return (
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
  )
}

export function EmptyWorkspace() {
  const t = useTranslation()
  const { api, firstEntry } = useContext(WorkspaceContext)
  const dockedBar = useDockedMusicBar()
  if (!fixtureWorkspace)
    return (
      <div className="empty-workspace">
        <PanelsTopLeft size={40} strokeWidth={1} />
        <h2>
          {dockedBar
            ? t('可在这里打开其他组件', 'Open other components here')
            : t('工作区为空', 'Your workspace is empty')}
        </h2>
        {!dockedBar && firstEntry && window.firstWorkspace ? (
          <FirstWorkspaceAction />
        ) : (
          !dockedBar && (
            <p>
              {window.musicDock
                ? t('从「窗口 → Music」打开音乐组件。', 'Open Music from the Window menu.')
                : t('从桌面工作台打开 Music。', 'Open Music from the desktop workbench.')}
            </p>
          )
        )}
      </div>
    )
  return (
    <div className="empty-workspace">
      <PanelsTopLeft size={40} strokeWidth={1} />
      <h2>{t('留一点空间给新的想法', 'Make room for new ideas')}</h2>
      <p>
        {t(
          '从「窗口」菜单打开模块，或恢复默认布局。',
          'Open a module from the Window menu or restore the default layout.',
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
