import { Button } from '@fluentui/react-components'

export function QuickListenControls({
  status,
  disabled,
  ready,
  favorite,
  start,
  save,
  skip,
  full,
}: {
  status: string
  disabled: boolean
  ready: boolean
  favorite: boolean
  start: () => void
  save: () => void
  skip: () => void
  full: () => void
}) {
  return (
    <>
      <Button size="small" disabled={disabled} onClick={start}>
        快速听这批
      </Button>
      {status && (
        <>
          <small role="status">{status}</small>
          <Button size="small" disabled={!ready || favorite} onClick={save}>
            {favorite ? '已收藏这首' : '收藏这首'}
          </Button>
          <Button size="small" disabled={!ready} onClick={skip}>
            跳过片段
          </Button>
          <Button size="small" disabled={!ready} onClick={full}>
            从头播放
          </Button>
        </>
      )}
    </>
  )
}
