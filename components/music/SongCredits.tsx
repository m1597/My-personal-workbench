import { createContext, useContext } from 'react'
import { creditClick } from './songRow'
import { knownAlbum, type CatalogLocation } from './LibraryCatalogPage'

export const SongCatalog = createContext<(location: CatalogLocation) => void>(() => {})
export type ArtistCredit = { name: string; id?: string | null }
type Credit = {
  artistCredits?: ArtistCredit[]
  title: string
  artist: string
  album?: string
  recordingAlbum?: string
  albumArtist?: string | null
  track?: string
  candidates?: { id: string; album: string }[]
}
export function songAlbum(song: Credit) {
  return (
    song.album ||
    song.recordingAlbum ||
    song.candidates?.find((c) => c.id === song.track)?.album ||
    ''
  )
}
export const knownArtistName = (name: string) =>
  !['', '未知艺人', '未知歌手', '未知艺术家', 'unknown artist', 'unknown', '—', '-'].includes(
    name.normalize('NFKC').trim().toLowerCase(),
  )
export function artistsOf(song: Pick<Credit, 'artist' | 'artistCredits'>): ArtistCredit[] {
  const entries: ArtistCredit[] = song.artistCredits?.length
    ? song.artistCredits
    : song.artist
        .split(/\s*(?:、|;|；|\s+feat(?:uring)?\.?\s+)\s*/iu)
        .filter(Boolean)
        .map((name) => ({ name }))
  return [...new Map(entries.map((a) => [a.id || a.name, a])).values()]
}
export function hasArtist(
  song: Pick<Credit, 'artist' | 'artistCredits'>,
  name: string,
  id?: string,
) {
  const normalize = (s: string) => s.normalize('NFKC').trim().toLowerCase()
  return artistsOf(song).some((a) =>
    id && a.id ? a.id === id : normalize(a.name) === normalize(name),
  )
}
export function ArtistLinks({ song, open }: { song: Credit; open: (v: CatalogLocation) => void }) {
  return (
    <span className="song-credit-links">
      {artistsOf(song).map((a, i) => (
        <span key={a.id || a.name}>
          {i > 0 && '、'}
          {knownArtistName(a.name) ? (
            <button
              className="catalog-text-link library-artist-link"
              type="button"
              data-song-credit=""
              onClick={(e) =>
                creditClick(e, () =>
                  open({
                    kind: 'artist',
                    name: a.name,
                    artist: a.name,
                    artistId: a.id || undefined,
                    fromSong: song.title,
                  }),
                )
              }
            >
              {a.name}
            </button>
          ) : (
            a.name
          )}
        </span>
      ))}
    </span>
  )
}
export function SongCredits({ song, beforeOpen }: { song: Credit; beforeOpen?(): void }) {
  const open = useContext(SongCatalog)
  const album = songAlbum(song)
  function show(location: CatalogLocation) {
    beforeOpen?.()
    open(location)
  }
  return (
    <span className="song-credit-links">
      <ArtistLinks song={song} open={show} />
      {knownAlbum(album) && (
        <>
          {song.artist && ' · '}
          <button
            className="catalog-text-link"
            type="button"
            data-song-credit=""
            onClick={(e) =>
              creditClick(e, () =>
                show({ kind: 'album', name: album, artist: song.albumArtist || song.artist }),
              )
            }
          >
            {album}
          </button>
        </>
      )}
    </span>
  )
}
