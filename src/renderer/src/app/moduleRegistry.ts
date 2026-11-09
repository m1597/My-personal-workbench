import { PanelLeft, SquareDashed, PanelRight, PanelBottom } from 'lucide-react'
export const icons = [PanelLeft, SquareDashed, PanelRight, PanelBottom]
export const modules = [
  { id: 'module-1', title: '模块 1', description: '模块导航' },
  { id: 'module-2', title: '模块 2', description: '主工作区' },
  { id: 'module-3', title: '模块 3', description: '辅助面板' },
  { id: 'module-4', title: '模块 4', description: '底部面板' },
] as const
