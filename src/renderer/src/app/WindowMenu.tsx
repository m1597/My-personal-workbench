import { useContext, useRef, useState } from 'react'
import {
  Button,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
  MenuDivider,
} from '@fluentui/react-components'
import { ChevronDown, Check, Plus, PanelsTopLeft, Music } from 'lucide-react'
import { WorkspaceContext } from './WorkspaceContext'
import { modules } from './moduleRegistry'
import { openModule } from './workspace'

import { LayoutDialog } from './LayoutDialog'
import { showMusicSlot } from './componentPrototype'

export function WindowMenu() {
  const workspace = useContext(WorkspaceContext)
  const [musicError, setMusicError] = useState('')
  const [layoutsOpen, setLayoutsOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <>
      <Menu positioning={{ position: modules.length ? 'below' : 'after', align: 'start' }}>
        <MenuTrigger disableButtonEnhancement>
          <Button
            ref={trigger}
            appearance="subtle"
            icon={<ChevronDown size={14} />}
            iconPosition="after"
          >
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
                  const host = window.musicDock
                  const state = await host?.status()
                  if (workspace.api && state?.mode === 'docked' && state.phase === 'ready')
                    showMusicSlot(workspace.api)
                  setMusicError((await window.musicDock?.open())?.error ?? '')
                }}
              >
                Music
              </MenuItem>
            )}
            <MenuDivider />
            <MenuItem icon={<PanelsTopLeft size={16} />} onClick={() => setLayoutsOpen(true)}>
              布局
            </MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
      {layoutsOpen && workspace.api && (
        <LayoutDialog
          api={workspace.api}
          onClose={() => {
            setLayoutsOpen(false)
            trigger.current?.focus()
          }}
        />
      )}
      {musicError && <span role="alert">{musicError}</span>}
    </>
  )
}
