import { useEffect, useState } from 'react'
import { Button, Checkbox } from '@fluentui/react-components'
import './recommendation-references.css'

export type ReferenceSelection = {
  folders: string[]
  playlists: string[]
  favorites: boolean
  legacyExclusions?: boolean
}
type ReferenceOption = {
  kind: 'folder' | 'playlist' | 'favorites'
  id: string
  name: string
  count: number
}
export type ReferencePreview = {
  options: ReferenceOption[]
  selection: ReferenceSelection
  count: number
  consented: boolean
}
export function useReferencePreview(selection: ReferenceSelection | undefined, revision?: string) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{
    request?: ReferenceSelection
    attempt: number
    revision: string
    preview?: ReferencePreview
    error?: string
  }>()
  useEffect(() => {
    if (revision === undefined) {
      setResult(undefined)
      return
    }
    let current = true
    void window.music.getRecommendationReferences(selection).then(
      (preview) => {
        if (current) setResult({ request: selection, attempt, revision, preview })
      },
      () => {
        if (current) setResult({ request: selection, attempt, revision, error: '读取参考范围失败' })
      },
    )
    return () => {
      current = false
    }
  }, [selection, attempt, revision])
  const settled =
    revision !== undefined &&
    result?.revision === revision &&
    result?.request === selection &&
    result?.attempt === attempt
  return {
    options: result?.preview?.options ?? [],
    preview: settled ? result?.preview : undefined,
    error: settled ? result?.error : undefined,
    retry: () => setAttempt((value) => value + 1),
  }
}

function includes(selection: ReferenceSelection, option: ReferenceOption) {
  if (option.kind === 'favorites') return selection.favorites
  return selection[option.kind === 'folder' ? 'folders' : 'playlists'].includes(option.id)
}

export type ReferenceControls = {
  result: ReturnType<typeof useReferencePreview>
  selection?: ReferenceSelection
  change(value: ReferenceSelection): void
  openSettings(): void
}
export function RecommendationReferences({
  result,
  selection,
  change,
  busy,
  descriptionOnly,
  openSettings,
}: ReferenceControls & { busy: boolean; descriptionOnly?: boolean }) {
  const { options, preview, error, retry } = result
  const selected = preview?.selection ?? selection
  function toggle(option: ReferenceOption, checked: boolean) {
    if (!selected) return
    const next = {
      folders: selected.folders,
      playlists: selected.playlists,
      favorites: selected.favorites,
    }
    if (option.kind === 'favorites') next.favorites = checked
    else {
      const key = option.kind === 'folder' ? 'folders' : 'playlists'
      next[key] = checked ? [...next[key], option.id] : next[key].filter((id) => id !== option.id)
    }
    change(next)
  }
  return (
    <fieldset className="music-reference-picker" aria-label="本次参考">
      <legend>本次参考</legend>
      {selected && (
        <div className="music-reference-groups">
          {(['folder', 'playlist', 'favorites'] as const).map((kind) => {
            const group = options.filter((option) => option.kind === kind)
            if (!group.length) return null
            return (
              <div key={kind}>
                {kind !== 'favorites' && (
                  <strong>{kind === 'folder' ? '本地文件夹' : '我的歌单'}</strong>
                )}
                {group.map((option) => (
                  <Checkbox
                    key={option.id}
                    aria-label={option.name}
                    label={`${option.name}（${option.count} 首）`}
                    checked={includes(selected, option)}
                    disabled={busy}
                    onChange={(_, data) => toggle(option, data.checked === true)}
                  />
                ))}
              </div>
            )
          })}
        </div>
      )}
      {selected &&
        (selected.folders.length > 0 || selected.playlists.length > 0 || selected.favorites) && (
          <Button
            size="small"
            appearance="subtle"
            disabled={busy}
            onClick={() => change({ folders: [], playlists: [], favorites: false })}
          >
            清空参考
          </Button>
        )}
      <small role="status" aria-label="本次参考范围">
        {preview
          ? `已选 ${preview.selection.folders.length} 个文件夹、${preview.selection.playlists.length} 个歌单${preview.selection.favorites ? '、我的收藏' : ''}，去重后 ${preview.count} 首`
          : error || '正在统计参考歌曲…'}
      </small>
      {error && (
        <Button size="small" onClick={retry}>
          重试读取
        </Button>
      )}
      {descriptionOnly && <small>本次要求权重为 100%，本次推荐只使用描述。</small>}
      {preview && !preview.consented && preview.count > 0 && (
        <div>
          <small>尚未授权，已选歌曲的信息不会发送给模型。</small>
          <Button size="small" appearance="subtle" onClick={openSettings}>
            前往模型设置
          </Button>
        </div>
      )}
    </fieldset>
  )
}
