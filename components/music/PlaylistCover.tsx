import { useEffect, useState } from 'react'
import { defaultCover, requestCover } from './AlbumBrowser'
import type { LocalTrack, PlaylistTrack } from './LibraryPane'
import './playlist-cover.css'

export function PlaylistCover({
  members,
  tracks,
  revision,
}: {
  members: PlaylistTrack[]
  tracks: LocalTrack[]
  revision: number
}) {
  const localById = new Map(tracks.map((t) => [t.id, t]))
  const albums = new Set<string>()
  const ids: string[] = []
  for (const member of members) {
    const track = member.origin === 'online' ? localById.get(member.localCopy ?? '') : member
    if (!track) continue
    const group = JSON.stringify(
      [track.album, track.albumArtist || track.artist].map((s) =>
        s.trim().normalize().toLowerCase(),
      ),
    )
    if (albums.has(group)) continue
    albums.add(group)
    ids.push(track.id)
  }
  const candidates = JSON.stringify(ids)
  const [result, setResult] = useState<{ candidates: string; revision: number; urls: string[] }>()
  useEffect(() => {
    let alive = true
    async function load() {
      const urls = new Set<string>()
      for (const id of JSON.parse(candidates) as string[]) {
        const cover = await requestCover(id, true, revision).catch(() => null)
        if (!alive) return
        if (cover) urls.add(cover)
        if (urls.size === 4) break
      }
      if (alive) setResult({ candidates, revision, urls: [...urls] })
    }
    void load()
    return () => {
      alive = false
    }
  }, [candidates, revision])
  const covers =
    result?.candidates === candidates && result.revision === revision ? result.urls : []
  const tiles =
    covers.length < 2
      ? [covers[0] ?? defaultCover]
      : Array.from({ length: 4 }, (_, i) => covers[i] ?? defaultCover)
  return (
    <span className="playlist-cover" data-single={tiles.length === 1} aria-hidden="true">
      {tiles.map((src, i) => (
        <img key={src === defaultCover ? 'default-' + i : src} src={src} alt="" />
      ))}
    </span>
  )
}
