import { useContext } from 'react'
import {
  Button,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
  MenuDivider,
} from '@fluentui/react-components'
import { ChevronDown, Check, Plus, RotateCcw } from 'lucide-react'
import { WorkspaceContext } from './WorkspaceContext'
import { modules } from './moduleRegistry'
import { createDefaultLayout, openModule } from './workspace'

export function WindowMenu() {
  const workspace = useContext(WorkspaceContext)
  return (
    <Menu positioning={{ position: 'below', align: 'start' }}>
      <MenuTrigger disableButtonEnhancement>
        <Button appearance="subtle" icon={<ChevronDown size={14} />} iconPosition="after">
          窗口
        </Button>
      </MenuTrigger>
      <MenuPopover className="workbench-menu">
        <MenuList aria-label="窗口菜单" id="window-menu">
          {modules.map((module) => (
            <MenuItem
              key={module.id}
              icon={
                workspace.visible.includes(module.id) ? <Check size={16} /> : <Plus size={16} />
              }
              onClick={() => workspace.api && openModule(workspace.api, module.id)}
            >
              {module.title}
            </MenuItem>
          ))}
          <MenuDivider />
          <MenuItem
            icon={<RotateCcw size={16} />}
            onClick={() => workspace.api && createDefaultLayout(workspace.api)}
          >
            重置布局
          </MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  )
}
