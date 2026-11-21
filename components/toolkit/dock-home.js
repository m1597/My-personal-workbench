import { toolkitHome } from './tools-view.js'
import { feedback } from './ui-dom.js'
import catalog from './catalog.json'
export function mountToolkit(root, bridge) {
  toolkitHome(
    { catalog, notice: '' },
    {
      root,
      ...feedback(),
      api: {
        ...bridge.local,
        open: bridge.open,
        capture: (mode) => (mode ? bridge.open(mode) : bridge.capture()),
      },
    },
  )
}
