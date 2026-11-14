import { useEffect, useState } from 'react'
export function ArtistPortrait({ id }: { id: string }) {
  const [source, setSource] = useState<{ id: string; image: string | null }>()
  useEffect(() => {
    if (!id) return
    let live = true
    void window.music
      .artistPortrait(id)
      .then((image) => {
        if (live) setSource({ id, image })
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [id])
  const image = id && source?.id === id && source.image
  return (
    <span className="catalog-artist-portrait" data-fallback={!image}>
      <img
        alt=""
        src={image || './default-artist.webp'}
        onError={image ? () => setSource({ id, image: null }) : undefined}
      />
    </span>
  )
}
