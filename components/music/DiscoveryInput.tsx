import { Button, Input } from '@fluentui/react-components'
import { Sparkles } from 'lucide-react'
import type { Ref } from 'react'

export function DiscoveryInput({
  ai,
  value,
  edit,
  toggle,
  disabled,
  inputRef,
}: {
  ai: boolean
  value: string
  edit(value: string): void
  toggle(): void
  disabled?: boolean
  inputRef?: Ref<HTMLInputElement>
}) {
  return (
    <Input
      id={ai ? 'music-description' : 'music-search-keyword'}
      data-guide-anchor={ai ? 'recommend' : 'online'}
      aria-label={ai ? '想让 AI 推荐什么？（选填）' : '搜索关键词'}
      placeholder={ai ? '描述你想听什么（选填）' : '输入歌名、艺人或关键词'}
      ref={inputRef}
      value={value}
      maxLength={1000}
      input={{ readOnly: disabled }}
      onChange={(_, d) => edit(d.value)}
      contentAfter={
        <Button
          type="button"
          size="small"
          appearance={ai ? 'primary' : 'subtle'}
          aria-label="AI 推荐"
          data-guide-anchor={ai ? undefined : 'ai-toggle'}
          aria-pressed={ai}
          title={ai ? '切换到普通搜索' : '切换到 AI 推荐'}
          icon={<Sparkles size={16} />}
          onClick={toggle}
        />
      }
    />
  )
}
