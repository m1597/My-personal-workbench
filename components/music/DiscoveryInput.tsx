import { Input } from '@fluentui/react-components'
import type { Ref } from 'react'

export function DiscoveryInput({
  ai,
  lists = false,
  value,
  edit,
  disabled,
  inputRef,
}: {
  lists?: boolean
  ai: boolean
  value: string
  edit(value: string): void
  disabled?: boolean
  inputRef?: Ref<HTMLInputElement>
}) {
  return (
    <Input
      id={
        lists
          ? ai
            ? 'music-list-description'
            : 'music-list-keyword'
          : ai
            ? 'music-description'
            : 'music-search-keyword'
      }
      data-guide-anchor={lists ? undefined : ai ? 'recommend' : 'online'}
      aria-label={
        lists
          ? ai
            ? '描述想听的公开歌单'
            : '搜索公开歌单'
          : ai
            ? '想让 AI 推荐什么？（选填）'
            : '搜索关键词'
      }
      placeholder={
        lists
          ? ai
            ? '描述风格或场景'
            : '搜索公开歌单'
          : ai
            ? '描述你想听什么（选填）'
            : '输入歌名、艺人或关键词'
      }
      ref={inputRef}
      value={value}
      maxLength={1000}
      input={{ readOnly: disabled }}
      onChange={(_, d) => edit(d.value)}
    />
  )
}
