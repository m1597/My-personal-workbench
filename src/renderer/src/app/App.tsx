import { applyMaterial } from './material'
import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { DockviewReact, type DockviewReadyEvent } from 'dockview-react'
import type { ModuleId } from './builtinSession'
import { WorkspaceContext, type WorkspaceState } from './WorkspaceContext'
import { components, HeaderActions, EmptyWorkspace } from './dockviewComponents'
import { ComponentTheme } from './ComponentTheme'
import { WindowMenu } from './WindowMenu'
import { restoreLayout } from './layoutStorage'
import {
  ComponentDropPreview,
  MusicPlayerBar,
  SettingsOpenContext,
  useComponentPrototype,
} from './componentPrototype'

import { WorkbenchSettings } from './WorkbenchSettings'
import { LanguageContext, readPreferences } from './preferences'

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [preferences, setPreferences] = useState(readPreferences)
  useLayoutEffect(() => {
    const root = document.documentElement
    root.lang = preferences.language
    root.dataset.workbenchFont = preferences.font
    root.dataset.workbenchSize = preferences.size
  }, [preferences])
  const { transparency, frost, brightness } = preferences
  useLayoutEffect(() => {
    const material = { transparency, frost, brightness }
    applyMaterial(material)
    window.componentHost?.setMaterial(material)
  }, [transparency, frost, brightness])
  const [theme] = useState(() => ({
    name: 'workbench',
    className: 'dockview-theme-workbench',
    gap: Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--space-8'),
    ),
  }))
  const [workspace, setWorkspace] = useState<WorkspaceState>({ visible: [] })
  const [detached, setDetached] = useState<ModuleId[]>([])
  useComponentPrototype(workspace.api, theme.gap, setDetached)
  useEffect(() => {
    const api = workspace.api
    if (!api) return
    const update = () =>
      setWorkspace({
        api,
        active: api.activePanel?.id,
        visible: api.panels.map((panel) => panel.id),
      })
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
          value={{ ...workspace, visible: [...workspace.visible, ...detached] }}
        >
          <SettingsOpenContext.Provider value={settingsOpen}>
            <div className="workbench">
              <div className="workbench-caption">
                <img src="./fitbay.png" alt="" draggable={false} />
                FitBay
              </div>
              <header className="app-header">
                <WindowMenu />
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
          </SettingsOpenContext.Provider>
        </WorkspaceContext.Provider>
      </ComponentTheme>
    </LanguageContext.Provider>
  )
}
