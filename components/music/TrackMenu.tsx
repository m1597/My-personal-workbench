import type { ReactElement } from 'react'
import { Menu, MenuItem, MenuList, MenuPopover, MenuTrigger } from '@fluentui/react-components'

export function TrackMenu({
  children,
  queueable,
  onQueue,
  dismissed,
  onDismiss,
}: {
  children: ReactElement
  queueable: boolean
  onQueue(next: boolean): void
  dismissed?: boolean
  onDismiss?(): void
}) {
  return (
    <Menu openOnContext>
      <MenuTrigger disableButtonEnhancement>{children}</MenuTrigger>
      <MenuPopover className="component-popup">
        <MenuList>
          <MenuItem disabled={!queueable} onClick={() => onQueue(true)}>
            下一首播放
          </MenuItem>
          <MenuItem disabled={!queueable} onClick={() => onQueue(false)}>
            加入队列
          </MenuItem>
          {onDismiss && (
            <MenuItem disabled={dismissed} onClick={onDismiss}>
              {dismissed ? '已标记不感兴趣' : '不感兴趣'}
            </MenuItem>
          )}
        </MenuList>
      </MenuPopover>
    </Menu>
  )
}
