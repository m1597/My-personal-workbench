import { toolkitHome } from './tools-view.js'
import { feedback } from './ui-dom.js'
import { settingsContents } from './settings-view.js'
import catalog from './catalog.json'
export function mountToolkit(root, bridge) {
  toolkitHome(
    { catalog, notice: '' },
    {
      root,
      settingsContents,
      ...feedback(),
      api: {
        ...bridge.local,
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
}
