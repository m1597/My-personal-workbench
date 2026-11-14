import { Button } from '@fluentui/react-components'
import { ArrowLeft } from 'lucide-react'
import { createContext, useContext } from 'react'

export const MusicLanguage = createContext<'zh-CN' | 'en'>('zh-CN')
export function BackButton({ onClick, to }: { onClick(): void; to?: 'albums' | 'playlists' }) {
  const english = useContext(MusicLanguage) === 'en'
  const label =
    to === 'albums'
      ? english
        ? 'Back to albums'
        : '返回专辑'
      : to === 'playlists'
        ? english
          ? 'Back to popular playlists'
          : '返回热门歌单'
        : english
          ? 'Back'
          : '返回'
  return (
    <Button
      className="music-detail-back"
      appearance="subtle"
      aria-label={label}
      title={label}
      icon={<ArrowLeft size={22} />}
      onClick={onClick}
    />
  )
}
