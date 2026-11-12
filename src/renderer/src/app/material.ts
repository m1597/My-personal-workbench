export interface Material {
  transparency: number
  frost: number
  brightness: number
}

export const materialDefaults: Material = { transparency: 100, frost: 100, brightness: 100 }

export function applyMaterial(material: Material) {
  const style = document.documentElement.style
  style.setProperty('--material-opacity', String(1 - material.transparency / 100))
  style.setProperty('--material-frost', String(material.frost / 100))
  style.setProperty('--material-light', String(material.brightness / 100))
}
