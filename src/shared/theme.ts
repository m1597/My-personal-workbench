export type Theme = 'dark' | 'light'
export interface WorkbenchBridge {
  setTheme(theme: Theme): Promise<void>
}
export const themeChannel = 'theme:set'
export function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light'
}
