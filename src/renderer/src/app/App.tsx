import { applyMaterial } from './material'
import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { DockviewReact, type DockviewReadyEvent } from 'dockview-react'
import type { ModuleId } from './builtinSession'
import { WorkspaceContext, type WorkspaceState } from './WorkspaceContext'
import { components, HeaderActions, EmptyWorkspace } from './dockviewComponents'
import { ComponentTheme } from './ComponentTheme'
import { WindowMenu } from './WindowMenu'
import { finishFirstEntry, firstEntryPending, restoreLayout } from './layoutStorage'
import {
  ComponentDropPreview,
  MusicPlayerBar,
  useComponentPrototype,
  useMusicHostState,
} from './componentPrototype'

import { WorkbenchSettings } from './WorkbenchSettings'
import { LanguageContext, readPreferences } from './preferences'

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [preferences, setPreferences] = useState(readPreferences)
  useLayoutEffect(() => {
    const root = document.documentElement
    root.lang = preferences.language
    window.componentHost?.setLanguage?.(preferences.language)
    root.dataset.workbenchFont = preferences.font
    root.dataset.workbenchSize = preferences.size
  }, [preferences])
  const { transparency, frost, brightness } = preferences
  useLayoutEffect(() => {
    const material = { transparency, frost, brightness }
    applyMaterial(material)
    window.componentHost?.setMaterial?.(material)
  }, [transparency, frost, brightness])
  const [theme] = useState(() => ({
    name: 'workbench',
    className: 'dockview-theme-workbench',
    gap: Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--space-8'),
    ),
  }))
  const [workspace, setWorkspace] = useState<WorkspaceState>({ visible: [] })
  const [firstEntry, setFirstEntry] = useState(firstEntryPending)
  const [detached, setDetached] = useState<ModuleId[]>([])
  const music = useMusicHostState()
  useEffect(() => {
    if (firstEntry && music?.mode === 'docked' && music.phase === 'ready') {
      finishFirstEntry()
      setFirstEntry(false)
    }
  }, [firstEntry, music?.mode, music?.phase])
  useComponentPrototype(workspace.api, theme.gap, setDetached)
  useEffect(() => {
    const api = workspace.api
    if (!api) return
    const update = () => {
      if (api.panels.some((panel) => panel.id !== 'component-music')) {
        finishFirstEntry()
        setFirstEntry(false)
      }
      setWorkspace({
        api,
        active: api.activePanel?.id,
        visible: api.panels.map((panel) => panel.id),
      })
    }
    const subscriptions = [
      api.onDidAddPanel(update),
      api.onDidRemovePanel(update),
      api.onDidActivePanelChange(update),
    ]
    update()
    return () =>
      subscriptions.forEach((item) => {
        item.dispose()
      })
  }, [workspace.api])
  const onReady = useCallback(
    ({ api }: DockviewReadyEvent) => {
      restoreLayout(api, theme.gap)
      setWorkspace({
        api,
        active: api.activePanel?.id,
        visible: api.panels.map((panel) => panel.id),
      })
    },
    [theme],
  )

  return (
    <LanguageContext.Provider value={preferences.language}>
      <ComponentTheme surface="workspace">
        <WorkspaceContext.Provider
          value={{ ...workspace, firstEntry, visible: [...workspace.visible, ...detached] }}
        >
          <div className="workbench">
            <header className="app-header">
              <div className="workbench-caption">
                <img src="./fitbay.png" alt="" draggable={false} />
                <span className="fitbay-brand">FitBay</span>
              </div>
              {!settingsOpen && <WindowMenu />}
              <WorkbenchSettings
                value={preferences}
                onChange={setPreferences}
                open={settingsOpen}
                setOpen={setSettingsOpen}
              />
              <ComponentDropPreview />
            </header>
            <main
              className="docking-area"
              inert={settingsOpen}
              style={settingsOpen ? { visibility: 'hidden', opacity: 0 } : undefined}
              aria-label={
                preferences.language === 'en' ? 'Adjustable workspace' : '可调整的模块工作区'
              }
            >
              <DockviewReact
                components={components}
                onReady={onReady}
                theme={theme}
                dndStrategy={window.componentHost ? 'pointer' : 'auto'}
                disableFloatingGroups
                rightHeaderActionsComponent={HeaderActions}
                watermarkComponent={EmptyWorkspace}
              />
            </main>
            <MusicPlayerBar />
          </div>
        </WorkspaceContext.Provider>
      </ComponentTheme>
    </LanguageContext.Provider>
  )
}
