export type Appearance = {
  material: 'glass' | 'soft' | 'solid'
  density: 'comfortable' | 'compact'
  accent: 'blue' | 'neutral' | 'violet'
  corners: 'rounded' | 'square'
}
export const defaultAppearance: Appearance = {
  material: 'glass',
  density: 'comfortable',
  accent: 'blue',
  corners: 'rounded',
}
const key = 'workbench.appearance'
export function readAppearance(): Appearance {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (saved?.version !== 1) return { ...defaultAppearance }
    return {
      material: ['glass', 'soft', 'solid'].includes(saved.material) ? saved.material : 'glass',
      density: saved.density === 'compact' ? 'compact' : 'comfortable',
      accent: ['blue', 'neutral', 'violet'].includes(saved.accent) ? saved.accent : 'blue',
      corners: saved.corners === 'square' ? 'square' : 'rounded',
    }
  } catch {
    return { ...defaultAppearance }
  }
}
export function applyAppearance(value: Appearance): boolean {
  Object.assign(document.documentElement.dataset, value)
  try {
    localStorage.setItem(key, JSON.stringify({ version: 1, ...value }))
    return true
  } catch {
    return false
  }
}
