import { useMusicFeedback } from './musicFeedback'
import { useContext, useState } from 'react'
import { OnlineSongRow,RowPlay } from './OnlineSongRow'
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
  const feedback = useMusicFeedback()
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState('')
  const navigate = useContext(SongCatalog)
  const localId = song.origin === 'online' ? song.localCopy : song.id
  async function run(action: () => Promise<string>) {
    setBusy(true)
    setStatus('')
    try {
      setStatus(await action())
    } catch (e) {
      setStatus(feedback.error(e))
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
          const receipt = await window.music.setMembership(list, song.id, true)
          return feedback.membership(name, Boolean(receipt && 'added' in receipt && receipt.added))
        })
      }
      download={() =>
        void run(async () => {
          const [r] = await window.music.downloadSelection([song.id])
          if (r?.status === 'failed') throw Error(r.error)
          return r?.status === 'saved' ? feedback.text('已下载并入库', 'Downloaded to library') : feedback.text('已跳过', 'Skipped')
        })
      }
    >
      <RowPlay title={song.title} id={song.id} disabled={!song.available} play={play}/>
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
