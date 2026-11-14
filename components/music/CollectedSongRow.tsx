import { useContext, useState } from 'react'
import { Button } from '@fluentui/react-components'
import { Play } from 'lucide-react'
import { OnlineSongRow } from './OnlineSongRow'
import { ArtistLinks, SongCatalog } from './SongCredits'
import { formatTime, type PlaylistTrack } from './LibraryPane'
import type { CatalogLocation } from './LibraryCatalogPage'

export function CollectedSongRow({
  song,
  active,
  play,
  open,
}: {
  song: PlaylistTrack
  active?: boolean
  play(): void
  open?: (v: CatalogLocation) => void
}) {
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState('')
  const navigate = useContext(SongCatalog)
  const localId = song.origin === 'online' ? song.localCopy : song.id
  async function run(action: () => Promise<string>) {
    setBusy(true)
    try {
      setStatus(await action())
    } catch (e) {
      setStatus(String(e).split('Error: ').at(-1) || '操作失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <OnlineSongRow
      active={active}
      className="catalog-recording"
      busy={busy}
      canPlay={!!song.available}
      localId={localId || undefined}
      play={play}
      add={(list, name) =>
        void run(async () => {
          await window.music.setMembership(list, song.id, true)
          return '已加入「' + name + '」'
        })
      }
      download={() =>
        void run(async () => {
          const [r] = await window.music.downloadSelection([song.id])
          if (r?.status === 'failed') throw Error(r.error)
          return r?.status === 'saved' ? '已下载并入库' : '已跳过'
        })
      }
    >
      <Button
        size="small"
        appearance="subtle"
        disabled={!song.available}
        aria-label={'播放' + song.title}
        icon={<Play size={15} />}
        onClick={play}
      />
      <div className="library-name">
        <strong>{song.title}</strong>
        <small>
          <ArtistLinks song={song} open={open || navigate} />
        </small>
        {status && <small role="status">{status}</small>}
      </div>
      <small>
        {localId ? '本地' : '在线'} · {formatTime(song.duration)}
      </small>
    </OnlineSongRow>
  )
}
