import { createContext, useContext, type ReactElement } from 'react'
import { Menu, MenuItem, MenuList, MenuPopover, MenuTrigger } from '@fluentui/react-components'

export const RevealTrackContext = createContext<(id: string) => void>(() => {})

export function TrackMenu({
  children,
  queueable,
  onQueue,
  localId,
  dismissed,
  onDismiss,
}: {
  children: ReactElement
  localId?: string | null
  queueable?: boolean
  onQueue?(next: boolean): void
  dismissed?: boolean
  onDismiss?(): void
}) {
  const reveal = useContext(RevealTrackContext)
  if (!onQueue && !localId && !onDismiss) return children
  return (
    <Menu openOnContext>
      <MenuTrigger disableButtonEnhancement>{children}</MenuTrigger>
      <MenuPopover className="component-popup">
        <MenuList>
          {localId && <MenuItem onClick={() => reveal(localId)}>查看文件所在位置</MenuItem>}
          {onQueue && (
            <>
              <MenuItem disabled={!queueable} onClick={() => onQueue(true)}>
                下一首播放
              </MenuItem>
              <MenuItem disabled={!queueable} onClick={() => onQueue(false)}>
                加入队列
              </MenuItem>
            </>
          )}
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
