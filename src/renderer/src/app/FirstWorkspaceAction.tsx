import { Button } from '@fluentui/react-components'
import { useEffect, useState } from 'react'
import { useTranslation } from './preferences'

declare global {
  interface Window {
    firstWorkspace?: {
      musicInstalled(): Promise<boolean>
      installMusic(): Promise<'cancelled' | 'mismatch' | 'finished' | 'failed'>
    }
  }
}

export function FirstWorkspaceAction() {
  const t = useTranslation()
  const [installed, setInstalled] = useState<boolean>()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  useEffect(() => {
    const bridge = window.firstWorkspace
    if (!bridge) return
    let active = true
    let request = 0
    const refresh = async () => {
      const id = ++request
      try {
        const value = await bridge.musicInstalled()
        if (active && id === request) setInstalled(value)
      } catch {
        if (active && id === request) setProblem('failed')
      }
    }
    void refresh()
    window.addEventListener('focus', refresh)
    return () => {
      active = false
      window.removeEventListener('focus', refresh)
    }
  }, [])
  async function activate() {
    const bridge = window.firstWorkspace
    if (!bridge || busy) return
    setBusy(true)
    setProblem('')
    try {
      if (await bridge.musicInstalled()) {
        setInstalled(true)
        const result = await window.musicDock?.open()
        if (!result?.ok) setProblem('open')
      } else {
        setInstalled(false)
        const result = await bridge.installMusic()
        const available = await bridge.musicInstalled()
        setInstalled(available)
        if (!available && result !== 'cancelled') setProblem(result)
      }
    } catch {
      setProblem('failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      {installed !== undefined && (
        <Button appearance="primary" disabled={busy} onClick={activate}>
          {installed ? t('打开 Music', 'Open Music') : t('添加组件', 'Add component')}
        </Button>
      )}
      {problem && (
        <p role="alert">
          {problem === 'mismatch'
            ? t(
                '请选择与工作台同一批发布的 FitBay Music 安装包。',
                'Choose the FitBay Music installer from this workbench release.',
              )
            : problem === 'finished'
              ? t(
                  '尚未检测到 Music，可重新选择安装包。',
                  'Music was not detected. You can select the installer again.',
                )
              : problem === 'open'
                ? t('Music 打开失败，请重试。', 'Music could not open. Try again.')
                : t(
                    '无法连接组件或启动安装程序，请重试。',
                    'Could not connect to the component or start its installer. Try again.',
                  )}
        </p>
      )}
    </>
  )
}
