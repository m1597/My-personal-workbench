// Electron work areas and BrowserWindow bounds are both expressed in device-independent pixels.
export function resultBounds(area, desiredWidth = 550, desiredHeight = 610) {
  const width = Math.min(desiredWidth, area.width),
    height = Math.min(desiredHeight, area.height)
  return {
    x: area.x + Math.floor((area.width - width) / 2),
    y: area.y + Math.floor((area.height - height) / 2),
    width,
    height,
    minWidth: Math.min(280, width),
  }
}
