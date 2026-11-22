import { WorkspaceContext } from './WorkspaceContext'
import { openToolkitPanel, ToolkitIcon } from './ToolkitEntry'
import { Folder, Music2, Boxes, Plus } from 'lucide-react'
import { Button } from '@fluentui/react-components'
import { useContext, useEffect, useState } from 'react'
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
  const { api } = useContext(WorkspaceContext)
  const [toolkit, setToolkit] = useState(false)
  const [installed, setInstalled] = useState<boolean>()
  const [prompts, setPrompts] = useState(false)
  const [sample, setSample] = useState(false)
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
        const [music, example, library, tools] = await Promise.all([
          window.musicDock?.inventory(),
          window.componentHost?.sampleEnabled ? window.componentHost.inventory() : undefined,
          window.promptDock?.inventory(),
          window.fitbayToolkit?.available(),
        ])
        if (active && id === request) setPrompts(Boolean(library?.installed))
        if (active && id === request) setToolkit(Boolean(tools))
        const value = Boolean(music?.installed)
        if (active && id === request) setSample(Boolean(example?.installed))
        if (active && id === request) setInstalled(value)
      } catch {
        if (active && id === request) setProblem('failed')
      }
    }
    void refresh()
    const timer = window.setInterval(refresh, 3000)
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(timer)
      active = false
      window.removeEventListener('focus', refresh)
    }
  }, [])
  async function activate(which: 'music' | 'sample' | 'install' | 'prompts') {
    const bridge = window.firstWorkspace
    if (!bridge || busy) return
    setBusy(true)
    setProblem('')
    try {
      if (which !== 'install') {
        const result =
          which === 'prompts'
            ? await window.promptDock?.show(false)
            : which === 'music'
              ? await window.musicDock?.show(false)
              : await window.componentHost?.open()
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
      <div className="quick-components">
        {installed && (
          <Button
            className="quick-component"
            icon={<Music2 />}
            disabled={busy}
            onClick={() => void activate('music')}
            aria-label={t('打开 Music', 'Open Music')}
          >
            Music
          </Button>
        )}
        {toolkit && (
          <Button
            className="quick-component"
            icon={<ToolkitIcon />}
            disabled={busy}
            onClick={() => api && openToolkitPanel(api, t('工具集', 'Toolkit'))}
          >
            {t('工具集', 'Toolkit')}
          </Button>
        )}
        {prompts && (
          <Button
            className="quick-component"
            icon={<Folder />}
            disabled={busy}
            onClick={() => void activate('prompts')}
          >
            {t('提示词库', 'Prompt library')}
          </Button>
        )}
        {sample && (
          <Button
            className="quick-component"
            icon={<Boxes />}
            disabled={busy}
            onClick={() => void activate('sample')}
          >
            {t('示例组件', 'Sample component')}
          </Button>
        )}
        {installed === false && (
          <Button icon={<Plus />} disabled={busy} onClick={() => void activate('install')}>
            {t('添加组件', 'Add component')}
          </Button>
        )}
      </div>
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
                ? t('组件打开失败，请重试。', 'Could not open the component. Try again.')
                : t(
                    '无法连接组件或启动安装程序，请重试。',
                    'Could not connect to the component or start its installer. Try again.',
                  )}
        </p>
      )}
    </>
  )
}
