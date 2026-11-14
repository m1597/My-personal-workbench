import { useEffect, useState } from 'react'
import { defaultCover, requestCover } from './AlbumBrowser'

import './playlist-cover.css'

export function PlaylistCover({
  id,
  latest,
  revision,
}: {
  id: string
  latest?: string
  revision: number
}) {
  const [custom, setCustom] = useState<string | null>()
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let alive = true
    window.music
      .playlistArtwork(id)
      .then((url) => {
        if (alive) setCustom(url)
      })
      .catch(() => {
        if (alive) setCustom(null)
      })
    return () => {
      alive = false
    }
  }, [id, version])
  async function change(reset: boolean) {
    try {
      await window.music.changePlaylistArtwork(id, reset)
      setError('')
      setVersion((n) => n + 1)
    } catch (e) {
      setError(String(e).split('Error: ').pop() || '更换封面失败')
    }
  }
  const [automatic, setAutomatic] = useState<{ id: string; revision: number; url: string }>()
  useEffect(() => {
    if (custom !== null || !latest) return
    let alive = true
    void requestCover(latest, true, revision)
      .then((url) => {
        if (alive && url) setAutomatic({ id: latest, revision, url })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [latest, revision, custom])
  const src =
    custom ||
    (automatic?.id === latest && automatic?.revision === revision && automatic.url) ||
    defaultCover
  return (
    <div className="playlist-artwork">
      <button
        type="button"
        className="playlist-cover"
        onClick={() => void change(false)}
        title="更换歌单封面"
        aria-label="更换歌单封面"
      >
        <img src={src} alt="" />
      </button>
      {custom && (
        <button className="catalog-text-link" type="button" onClick={() => void change(true)}>
          恢复自动封面
        </button>
      )}
      {error && <small role="alert">{error}</small>}
    </div>
  )
}
