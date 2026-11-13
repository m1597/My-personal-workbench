import { useTranslation } from './preferences'
import { useContext, useRef, useState } from 'react'
import {
  Button,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuSplitGroup,
  MenuItem,
  MenuDivider,
} from '@fluentui/react-components'
import { ChevronDown, Check, Eye, EyeOff, Plus, PanelsTopLeft } from 'lucide-react'
import { WorkspaceContext } from './WorkspaceContext'
import { modules } from './moduleRegistry'
import { openModule } from './workspace'

import { LayoutDialog } from './LayoutDialog'
import { useMusicHostState } from './componentPrototype'

export function WindowMenu() {
  const t = useTranslation()
  const music = useMusicHostState()
  const running = music?.phase === 'ready' || music?.phase === 'attaching'
  const hidden = music?.presentation === 'background'
  const visibilityLabel = hidden ? t('显示 Music', 'Show Music') : t('隐藏 Music', 'Hide Music')
  const workspace = useContext(WorkspaceContext)
  const [musicError, setMusicError] = useState('')
  const [layoutsOpen, setLayoutsOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <>
      <Menu
        positioning={{
          position: modules.length ? 'below' : 'after',
          align: 'start',
        }}
      >
        <MenuTrigger disableButtonEnhancement>
          <Button
            ref={trigger}
            appearance="subtle"
            icon={<ChevronDown size={14} />}
            iconPosition="after"
          >
            {t('窗口', 'Window')}
          </Button>
        </MenuTrigger>
        <MenuPopover className="component-popup workbench-menu">
          <MenuList aria-label={t('窗口菜单', 'Window menu')} id="window-menu">
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
              <MenuSplitGroup>
                <MenuItem
                  role="menuitemcheckbox"
                  aria-checked={running}
                  icon={running ? <Check size={16} /> : <Plus size={16} />}
                  onClick={async () => {
                    const host = window.musicDock
                    if (!host) return
                    const state = await host.status()
                    if (state.phase === 'ready' || state.phase === 'attaching') {
                      await host.close?.()
                      setMusicError('')
                    } else setMusicError((await host.open()).error ?? '')
                  }}
                >
                  Music
                </MenuItem>
                <MenuItem
                  className="music-menu-reveal"
                  aria-label={visibilityLabel}
                  title={visibilityLabel}
                  disabled={music?.phase !== 'ready'}
                  icon={hidden ? <EyeOff size={16} /> : <Eye size={16} />}
                  onClick={() => void window.musicDock?.toggleVisibility()}
                />
              </MenuSplitGroup>
            )}
            <MenuDivider />
            <MenuItem icon={<PanelsTopLeft size={16} />} onClick={() => setLayoutsOpen(true)}>
              {t('布局', 'Layouts')}
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
