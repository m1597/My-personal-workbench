import { useContext, useState } from 'react'
import {
  Button,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
  MenuDivider,
} from '@fluentui/react-components'
import { ChevronDown, Check, Plus, RotateCcw, Music } from 'lucide-react'
import { WorkspaceContext } from './WorkspaceContext'
import { modules } from './moduleRegistry'
import { createDefaultLayout, openModule } from './workspace'

export function WindowMenu() {
  const workspace = useContext(WorkspaceContext)
  const [musicError, setMusicError] = useState('')
  return (
    <>
      <Menu positioning={{ position: 'below', align: 'start' }}>
        <MenuTrigger disableButtonEnhancement>
          <Button appearance="subtle" icon={<ChevronDown size={14} />} iconPosition="after">
            窗口
          </Button>
        </MenuTrigger>
        <MenuPopover className="component-popup workbench-menu">
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
            {window.musicDock && (
              <MenuItem
                icon={<Music size={16} />}
                onClick={async () => {
                  workspace.api?.getPanel('component-music')?.api.setActive()
                  setMusicError((await window.musicDock?.open())?.error ?? '')
                }}
              >
                Music
              </MenuItem>
            )}
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
      {musicError && <span role="alert">{musicError}</span>}
    </>
  )
}
