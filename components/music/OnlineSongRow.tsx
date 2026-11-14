import './song-row.css'
import { songRow } from './songRow'
import { createContext, useContext, type ReactNode } from 'react'
import {
  Button,
  Menu,
  MenuList,
  MenuItem,
  MenuPopover,
  MenuTrigger,
} from '@fluentui/react-components'
import { Download, FolderOpen, ListPlus,Play,Pause } from 'lucide-react'
import { RevealTrackContext } from './TrackMenu'

export const RowPlayback=createContext({id:'',paused:true,toggle:()=>{}})
export function RowPlay({id,title,play,disabled=false}:{id?:string;title:string;play():void;disabled?:boolean}){
  const playback=useContext(RowPlayback), active=!!id && playback.id===id, playing=active && !playback.paused
  return <Button className="row-play" size="small" appearance="subtle" icon={playing?<Pause size={16}/>:<Play size={16}/>} aria-label={(playing?'暂停':'播放')+title} title={playing?'暂停':'播放'} disabled={disabled} onClick={active?playback.toggle:play}/>
}
export const RecordingLists = createContext<{ id: string; name: string }[]>([])
export function OnlineSongRow({
  children,
  active,
  className,
  localId,
  busy,
  canPlay = true,
  canDownload = true,
  play,
  download,
  add,
}: {
  active?: boolean
  children: ReactNode
  className?: string
  localId?: string
  busy: boolean
  canPlay?: boolean
  canDownload?: boolean
  play(): void
  download(): void
  add(id: string, name: string): void
}) {
  const lists = useContext(RecordingLists),
    reveal = useContext(RevealTrackContext)
  function addMenu(context: boolean) {
    return (
      <Menu>
        <MenuTrigger disableButtonEnhancement>
          {context ? (
            <MenuItem disabled={busy}>加入歌单</MenuItem>
          ) : (
            <Button
              size="small"
              appearance="subtle"
              aria-label="加入歌单"
              title="加入歌单"
              icon={<ListPlus size={16} />}
              disabled={busy}
            />
          )}
        </MenuTrigger>
        <MenuPopover className="component-popup">
          <MenuList>
            {lists.length ? (
              lists.map((list) => (
                <MenuItem key={list.id} onClick={() => add(list.id, list.name)}>
                  {list.name}
                </MenuItem>
              ))
            ) : (
              <MenuItem disabled>请先新建歌单</MenuItem>
            )}
          </MenuList>
        </MenuPopover>
      </Menu>
    )
  }
  return (
    <Menu openOnContext>
      <MenuTrigger disableButtonEnhancement>
        <li
          {...songRow(() => {
            if (!busy && canPlay) play()
          })}
          data-active={active}
          className={className}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Enter provides keyboard playback for the double-clickable recording row.
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.target === e.currentTarget && e.key === 'Enter' && !busy && canPlay) {
              e.preventDefault()
              play()
            }
          }}
        >
          {children}
          <div className="search-result-actions">
            <Button
              size="small"
              appearance="subtle"
              disabled={busy || (!localId && !canDownload)}
              aria-label={localId ? '查看文件所在位置' : '下载'}
              title={localId ? '查看文件所在位置' : '下载'}
              icon={localId ? <FolderOpen size={16} /> : <Download size={16} />}
              onClick={localId ? () => reveal(localId) : download}
            />
            {addMenu(false)}
          </div>
        </li>
      </MenuTrigger>
      <MenuPopover className="component-popup">
        <MenuList>
          <MenuItem disabled={busy || !canPlay} onClick={play}>
            播放
          </MenuItem>
          {!localId && (
            <MenuItem disabled={busy || !canDownload} onClick={download}>
              下载
            </MenuItem>
          )}
          {addMenu(true)}
          {localId && <MenuItem onClick={() => reveal(localId)}>查看文件所在位置</MenuItem>}
        </MenuList>
      </MenuPopover>
    </Menu>
  )
}
