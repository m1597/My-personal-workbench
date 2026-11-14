import { useEffect, useRef, useState } from 'react'
import { Button } from '@fluentui/react-components'
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
  const changing = useRef(false)
  const [busy, setBusy] = useState(false)
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
  }, [id])
  async function change(reset: boolean) {
    if (changing.current) return
    changing.current = true
    setBusy(true)
    try {
      await window.music.changePlaylistArtwork(id, reset)
      setError('')
      setCustom(await window.music.playlistArtwork(id))
    } catch (e) {
      setError(String(e).split('Error: ').pop() || '更换封面失败')
    } finally {
      changing.current = false
      setBusy(false)
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
      <div className="playlist-cover">
        <img src={src} alt="歌单封面" />
      </div>
      <Button size="small" disabled={busy} onClick={() => void change(false)}>
        更换封面
      </Button>
      {custom && (
        <button
          className="catalog-text-link"
          type="button"
          disabled={busy}
          onClick={() => void change(true)}
        >
          恢复自动封面
        </button>
      )}
      {error && <small role="alert">{error}</small>}
    </div>
  )
}
