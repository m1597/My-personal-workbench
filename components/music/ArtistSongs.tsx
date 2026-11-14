import { Button } from '@fluentui/react-components'
import { useEffect, useState } from 'react'
import { CatalogSongRow } from './ReleaseCatalog'

export function ArtistSongs({ id, play }: { id: string; play: (key: string) => Promise<void> }) {
  const [offset, setOffset] = useState(0)
  const [retry, setRetry] = useState(0)
  const [page, setPage] = useState<Awaited<ReturnType<typeof window.music.artistSongs>>>()
  const [error, setError] = useState('')
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry requests the current page again.
  useEffect(() => {
    let live = true
    setError('')
    setPage(undefined)
    void window.music
      .artistSongs(id, offset)
      .then((value) => {
        if (live) setPage(value)
      })
      .catch((e) => {
        if (live) setError(String(e).split('Error: ').at(-1) || '无法读取歌曲目录')
      })
    return () => {
      live = false
    }
  }, [id, offset, retry])
  return (
    <section aria-label="全部歌曲">
      <h3>全部歌曲{page && ' · ' + page.total + ' 条录音'}</h3>
      {page?.notice && <small role="status">{page.notice}</small>}
      {error && (
        <p role="alert">
          {error}{' '}
          <Button size="small" onClick={() => setRetry((n) => n + 1)}>
            重试
          </Button>
        </p>
      )}
      {!page && !error && <small role="status">正在读取歌曲目录…</small>}
      {page && (
        <>
          <ol start={offset + 1}>
            {page.songs.map((song) => (
              <CatalogSongRow key={song.id} song={song} play={play} />
            ))}
          </ol>
          {!page.songs.length && <small>目录暂未收录歌曲。</small>}
          {(offset > 0 || page.next !== null) && (
            <div>
              <Button
                size="small"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 30))}
              >
                上一页
              </Button>{' '}
              <Button
                size="small"
                disabled={page.next === null}
                onClick={() => {
                  if (page.next !== null) setOffset(page.next)
                }}
              >
                下一页
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
