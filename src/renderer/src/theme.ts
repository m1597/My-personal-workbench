export type Theme = 'dark' | 'light'
declare global {
  interface Window {
    workbench?: { setTheme(theme: Theme): Promise<void> }
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

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(storageKey, theme)
  } catch {
    /* Still usable without storage. */
  }
  void window.workbench?.setTheme(theme).catch((error) => console.error('同步窗口主题失败', error))
}
