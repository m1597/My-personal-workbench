import { mountRecorder } from './recorder.tsx'
import { toolkitHome } from './tools-view.js'
import { feedback } from './ui-dom.js'
import { settingsContents } from './settings-view.js'
import catalog from './catalog.json'
export function mountToolkit(root, bridge) {
  const ui = feedback()
  // Acquire the component's native shortcuts and transfer its tray on first dock.
  void bridge.shortcuts(null).catch((error) => {
    if (root.isConnected) ui.error(error)
  })
  const recorders = []
  toolkitHome(
    { catalog, notice: '' },
    {
      root,
      settingsContents,
      ...ui,
      api: {
        ...bridge.local,
        mountRecorder(node, props) {
          const recorder = mountRecorder(node, props)
          recorders.push(recorder)
          return recorder
        },
        shortcutSettings: () => bridge.shortcuts(null),
        enable: (v) => bridge.shortcuts(v),
        connections: async () => {
          const { rows, choices } = await window.fitbayConnections.snapshot()
          const describe = (v) =>
            v && {
              ...v,
              private: v.owners.length <= 1,
              name: v.owners.join(' / ') + ' — ' + v.model,
              hasKey: v.configured,
            }
          const find = (route) =>
            describe(
              choices.find(
                (c) => c.id === rows.find((r) => r.use === 'toolkit.' + route)?.value?.id,
              ),
            )
          return {
            routes: { translation: find('translation'), vision: find('vision') },
            connections: choices.map(describe),
            migrationPending: [],
          }
        },
        configure: (v) =>
          window.fitbayConnections.write(
            'toolkit.' + v.route,
            ['private', 'edit'].includes(v.connection)
              ? { ...v, separate: v.connection === 'private' }
              : { reuse: v.connection, expectedId: v.expectedId },
          ),
        onConnectionChange: (fn) => {
          const timer = setInterval(() => {
            if (root.isConnected) fn()
            else clearInterval(timer)
          }, 750)
        },
        open: bridge.open,
        capture: (mode) => (mode ? bridge.open(mode) : bridge.capture()),
      },
    },
  )
  return () =>
    queueMicrotask(() => {
      for (const recorder of recorders) recorder.dispose()
    })
}
