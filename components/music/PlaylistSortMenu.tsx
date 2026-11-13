import {
  Button,
  Menu,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
  MenuDivider,
} from '@fluentui/react-components'
import { ArrowDownUp } from 'lucide-react'
import type { LocalTrack } from './LibraryPane'

const labels = {
  custom: '自定义顺序',
  added: '加入时间',
  title: '歌名',
  artist: '歌手',
} as const
type Sort = keyof typeof labels
export type Playlist = {
  id: string
  name: string
  tracks: string[]
  system?: boolean
  sort: Sort
  descending: boolean
  additions: [string, number][]
}
export type PlaylistSorting = {
  setPlaylistSort: (id: string, sort: Sort, descending: boolean) => Promise<unknown>
  movePlaylistTrack: (id: string, track: string, target: string, after: boolean) => Promise<unknown>
}
const collator = new Intl.Collator('zh-CN', {
  numeric: true,
  sensitivity: 'base',
})
export function playlistRows(playlist: Playlist, byId: Map<string, LocalTrack>) {
  const ids = playlist.sort === 'added' ? playlist.additions.map(([id]) => id) : playlist.tracks
  const rows = ids.flatMap((id) => byId.get(id) ?? [])
  const key = playlist.sort
  if (key === 'title' || key === 'artist')
    return rows.sort((a, b) => (playlist.descending ? -1 : 1) * collator.compare(a[key], b[key]))
  return key === 'added' && playlist.descending ? rows.reverse() : rows
}
export function PlaylistSortMenu({
  playlist,
  setPlaylistSort,
}: {
  playlist: Playlist
  setPlaylistSort: PlaylistSorting['setPlaylistSort']
}) {
  const direction = playlist.descending ? '降序' : '升序'
  return (
    <Menu checkedValues={{ sort: [playlist.sort], direction: [direction] }}>
      <MenuTrigger disableButtonEnhancement>
        <Button
          size="small"
          icon={<ArrowDownUp size={15} />}
          title={playlist.sort === 'custom' ? '自定义顺序下可上下拖动歌曲' : undefined}
          aria-label="歌单排序"
        >
          {labels[playlist.sort]}
          {playlist.sort !== 'custom' && ' · ' + direction}
        </Button>
      </MenuTrigger>
      <MenuPopover className="component-popup">
        <MenuList>
          {(Object.keys(labels) as Sort[]).map((sort) => (
            <MenuItemRadio
              key={sort}
              name="sort"
              value={sort}
              onClick={() => void setPlaylistSort(playlist.id, sort, playlist.descending)}
            >
              {labels[sort]}
            </MenuItemRadio>
          ))}
          <MenuDivider />
          {['升序', '降序'].map((label) => (
            <MenuItemRadio
              key={label}
              name="direction"
              value={label}
              disabled={playlist.sort === 'custom'}
              onClick={() => void setPlaylistSort(playlist.id, playlist.sort, label === '降序')}
            >
              {label}
            </MenuItemRadio>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  )
}
