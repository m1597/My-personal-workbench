import { createContext, useContext, type ReactElement } from 'react'
import { Menu, MenuItem, MenuList, MenuPopover, MenuTrigger } from '@fluentui/react-components'

export const RevealTrackContext = createContext<(id: string) => void>(() => {})

export function TrackMenu({
  children,
  play,download,addTo,lists,
  queueable,
  onQueue,
  queueShortcut,
  localId,
  dismissed,
  onDismiss,
}: {
  children: ReactElement
  localId?: string | null
  play?():void
  download?():void
  addTo?(id:string):void
  lists?:{id:string;name:string}[]
  queueable?: boolean
  onQueue?(next: boolean): void
  queueShortcut?: boolean
  dismissed?: boolean
  onDismiss?(): void
}) {
  const reveal = useContext(RevealTrackContext)
  if (!onQueue && !localId && !onDismiss && !play && !download && !addTo) return children
  return (
    <Menu openOnContext>
      <MenuTrigger disableButtonEnhancement>{children}</MenuTrigger>
      <MenuPopover className="component-popup">
        <MenuList>
          {play && <MenuItem disabled={queueable===false} onClick={play}>播放</MenuItem>}
          {download && <MenuItem onClick={download}>下载</MenuItem>}
          {addTo && <Menu><MenuTrigger disableButtonEnhancement><MenuItem>加入歌单</MenuItem></MenuTrigger><MenuPopover className="component-popup"><MenuList>{lists?.length?lists.map(l=><MenuItem key={l.id} onClick={()=>addTo(l.id)}>{l.name}</MenuItem>):<MenuItem disabled>请先新建歌单</MenuItem>}</MenuList></MenuPopover></Menu>}
          {localId && <MenuItem onClick={() => reveal(localId)}>查看文件所在位置</MenuItem>}
          {onQueue && (
            <>
              <MenuItem disabled={!queueable} onClick={() => onQueue(true)}>
                下一首播放
              </MenuItem>
              <MenuItem
                secondaryContent={queueShortcut ? 'Shift+Enter' : undefined}
                disabled={!queueable}
                onClick={() => onQueue(false)}
              >
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
