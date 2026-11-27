// The sampler receives only generated pixels. No physical desktop or user window is captured.
export async function installScreenFixture(app, png) {
  return app.evaluate(({ screen, desktopCapturer, nativeImage }, data) => {
    const attached = screen.getAllDisplays()
    const primary = screen.getPrimaryDisplay()
    const second = attached.find((d) => d.id !== primary.id)
    const virtual = {
      id: 901,
      size: { width: 900, height: 640 },
      scaleFactor: 1.5,
      bounds: { x: -900, y: -120, width: 900, height: 640 },
      workArea: { x: -900, y: -120, width: 900, height: 600 },
    }
    const d = second ?? virtual
    const point = { x: d.bounds.x + 100, y: d.bounds.y + 100 }
    const nearest = screen.getDisplayNearestPoint.bind(screen)
    screen.getCursorScreenPoint = () => point
    if (!second) {
      screen.getAllDisplays = () => [...attached, d]
      screen.getDisplayNearestPoint = (p) => (p.x === point.x && p.y === point.y ? d : nearest(p))
    }
    const frame = nativeImage.createFromDataURL('data:image/png;base64,' + data)
    desktopCapturer.getSources = async ({ thumbnailSize }) => [
      {
        display_id: String(d.id),
        thumbnail: frame.resize(thumbnailSize),
      },
    ]
    return {
      attached: attached.map(({ id, bounds, scaleFactor }) => ({ id, bounds, scaleFactor })),
      fixture: d,
      secondaryAttached: Boolean(second),
      capture: 'fixture',
    }
  }, png.toString('base64'))
}
