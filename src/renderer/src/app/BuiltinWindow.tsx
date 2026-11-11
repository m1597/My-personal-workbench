import { useEffect, useState } from 'react'
import { FluentProvider } from '@fluentui/react-components'
import { fluentTheme } from './fluentTheme'
import { WorkspaceContext } from './WorkspaceContext'
import { BuiltinContent } from './dockviewComponents'
import { type ModuleWindows, type ModuleId, setNavigationQuery } from './builtinSession'

export function BuiltinWindow({ id }: { id: ModuleId }) {
  const [theme] = useState(fluentTheme)
  const [state, setState] = useState<ModuleWindows>()
  const [size, setSize] = useState({ width: innerWidth, height: innerHeight })
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const host = window.builtinWindow
    if (!host) return
    let live = true
    const update = (next: ModuleWindows) =>
      setState((old) => (old && old.revision > next.revision ? old : next))
    const off = host.onState(update)
    void host.status().then((next) => {
      if (!live) return
      if (id === 'module-1') setNavigationQuery(next.query ?? '')
      update(next)
      setReady(true)
    })
    const resize = () => setSize({ width: innerWidth, height: innerHeight })
    window.addEventListener('resize', resize)
    return () => {
      live = false
      off()
      window.removeEventListener('resize', resize)
    }
  }, [id])
  useEffect(() => {
    if (ready) window.builtinWindow?.mounted()
  }, [ready])
  const workspace = state?.workspace
  return (
    <FluentProvider className="fluent-workbench builtin-window" theme={theme}>
      <WorkspaceContext.Provider
        value={{
          active: workspace ? workspace.active : id,
          visible: [...(workspace?.visible ?? []), ...(state?.detached ?? []), id],
          dimensions: workspace ?? size,
        }}
      >
        {ready && <BuiltinContent id={id} />}
      </WorkspaceContext.Provider>
    </FluentProvider>
  )
}
