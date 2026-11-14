import { useContext } from 'react'
import { MusicLanguage } from './BackButton'
import { userMessage } from './playbackError'

export function useMusicFeedback() {
  const language = useContext(MusicLanguage)
  return {
    membership: (name: string, added: boolean) =>
      language === 'en'
        ? (added ? 'Added to ' : 'Already in ') + name
        : (added ? '已加入「' : '已在「') + name + '」',
    text: (zh: string, en: string) => (language === 'en' ? en : zh),
    error: (reason: unknown) => userMessage(String(reason), language),
  }
}
