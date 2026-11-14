import { useMusicFeedback } from './musicFeedback'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@fluentui/react-components'
import { defaultCover, requestCover } from './AlbumBrowser'

import './playlist-cover.css'

export function PlaylistCover({
  id,
  latest,
  revision,
  heading,
  playAll,
}: {
  id: string
  latest?: string
  heading: ReactNode
  playAll: ReactNode
  revision: number
}) {
  const feedback = useMusicFeedback()
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
    setError('')
    try {
      await window.music.changePlaylistArtwork(id, reset)
      setError('')
      setCustom(await window.music.playlistArtwork(id))
    } catch (e) {
      setError(feedback.error(e))
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
    <>
      <div className="playlist-cover">
        <img src={src} alt="歌单封面" />
      </div>
      {heading}
      <span className="playlist-header-actions">
        <Button size="small" disabled={busy} onClick={() => void change(false)}>
          更换封面
        </Button>
        {playAll}
      </span>
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
    </>
  )
}
