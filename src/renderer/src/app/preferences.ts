import { createContext, useContext } from 'react'

export const languages = ['zh-CN', 'en'] as const
export const fonts = ['default', 'yahei', 'segoe'] as const
export const sizes = ['small', 'standard', 'large'] as const

import { materialDefaults, type Material } from './material'

export interface Preferences extends Material {
  language: (typeof languages)[number]
  font: (typeof fonts)[number]
  size: (typeof sizes)[number]
}
export const preferenceKey = 'workbench.preferences.v1'
const defaults: Preferences = {
  ...materialDefaults,
  language: 'zh-CN',
  font: 'default',
  size: 'standard',
}
function choice<T extends string>(values: readonly T[], input: unknown, fallback: T): T {
  return values.find((value) => value === input) ?? fallback
}
function percent(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(100, Math.max(0, Math.round(value)))
    : fallback
}
export function readPreferences(): Preferences {
  try {
    const data = JSON.parse(localStorage.getItem(preferenceKey) ?? '{}')
    return {
      transparency: percent(data.transparency, defaults.transparency),
      frost: percent(data.frost, defaults.frost),
      brightness: percent(data.brightness, defaults.brightness),
      language: choice(languages, data.language, defaults.language),
      font: choice(fonts, data.font, defaults.font),
      size: choice(sizes, data.size, defaults.size),
    }
  } catch {
    return defaults
  }
}
export const LanguageContext = createContext<Preferences['language']>('zh-CN')
const chinese = (zh: string, _en: string) => zh
const english = (_zh: string, en: string) => en
export function useTranslation() {
  return useContext(LanguageContext) === 'en' ? english : chinese
}
