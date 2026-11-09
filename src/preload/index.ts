import { contextBridge, ipcRenderer } from 'electron'
import { themeChannel, type Theme, type WorkbenchBridge } from '../shared/theme'

contextBridge.exposeInMainWorld('workbench', {
  setTheme: (theme: Theme): Promise<void> => ipcRenderer.invoke(themeChannel, theme),
} satisfies WorkbenchBridge)
