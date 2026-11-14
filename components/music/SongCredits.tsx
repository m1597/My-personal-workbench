import { createContext, useContext } from 'react'
import type { MouseEvent } from 'react'
import { knownAlbum, type CatalogLocation } from './LibraryCatalogPage'

export const SongCatalog = createContext<(location: CatalogLocation) => void>(() => {})
export function songRowClick(event: MouseEvent, play: () => void) {
  if (
    event.detail < 2 &&
    event.target instanceof Element &&
    event.currentTarget.contains(event.target) &&
    !event.target.closest('button,a,input,select,label,[role="button"],[role="menuitem"]')
  )
    play()
}
type Credit = {
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
export function SongCredits({ song, beforeOpen }: { song: Credit; beforeOpen?(): void }) {
  const open = useContext(SongCatalog)
  const album = songAlbum(song)
  function show(location: CatalogLocation) {
    beforeOpen?.()
    open(location)
  }
  return (
    <span className="song-credit-links">
      {song.artist && (
        <button
          className="catalog-text-link"
          type="button"
          onClick={() =>
            show({ kind: 'artist', name: song.artist, artist: song.artist, fromSong: song.title })
          }
        >
          {song.artist}
        </button>
      )}
      {knownAlbum(album) && (
        <>
          {song.artist && ' · '}
          <button
            className="catalog-text-link"
            type="button"
            onClick={() =>
              show({ kind: 'album', name: album, artist: song.albumArtist || song.artist })
            }
          >
            {album}
          </button>
        </>
      )}
    </span>
  )
}
