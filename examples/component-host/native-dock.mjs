// Windows title-bar centre is the explicit docking anchor (all coordinates are DIP).
// Native message hooks are not a generic foreign-window embedding mechanism.
export function watchNativeDock(window, { target, commit, preview }) {
  if (process.platform !== 'win32') return
  let start
  let moving = false
  const hit = () => {
    const rect = window.getBounds()
    const zone = target()
    const x = rect.x + rect.width / 2
    const y = rect.y + 16
    return (
      !!zone && x >= zone.x && x < zone.x + zone.width && y >= zone.y && y < zone.y + zone.height
    )
  }
  window.hookWindowMessage(0x0231, () => {
    start = window.getBounds()
    moving = false
  })
  window.hookWindowMessage(0x0216, () => {
    moving = true
  })
  window.on('move', () => {
    if (moving) preview(hit())
  })
  window.hookWindowMessage(0x0232, () => {
    const end = window.getBounds()
    const shouldDock = moving && start && (end.x !== start.x || end.y !== start.y) && hit()
    start = undefined
    moving = false
    // Let the native modal move loop finish before transferring its view.
    setImmediate(() => {
      preview(false)
      if (shouldDock && !window.isDestroyed()) commit()
    })
  })
}
