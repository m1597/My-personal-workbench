import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('workbench', {
  setTheme: (theme: 'dark' | 'light'): Promise<void> => ipcRenderer.invoke('theme:set', theme)
})
