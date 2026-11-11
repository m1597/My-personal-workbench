import type { Theme, WorkbenchBridge } from '../../../shared/theme'
declare global {
  interface Window {
    workbench?: WorkbenchBridge
  }
}

const storageKey = 'workbench.theme'
export function readTheme(): Theme {
  try {
    return localStorage.getItem(storageKey) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function applyTheme(theme: Theme): boolean {
  document.documentElement.dataset.theme = theme
  void window.workbench?.setTheme(theme).catch((error) => console.error('同步窗口主题失败', error))
  try {
    localStorage.setItem(storageKey, theme)
    return true
  } catch {
    return false
  }
}
