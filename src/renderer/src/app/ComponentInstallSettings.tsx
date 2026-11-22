import { Button } from '@fluentui/react-components'
import { useEffect, useState } from 'react'
import { useTranslation } from './preferences'

type Id = 'music' | 'prompts' | 'toolkit'
type Row = {
  id: Id
  status:
    | 'missing'
    | 'checking'
    | 'downloading'
    | 'installing'
    | 'installed'
    | 'failed'
    | 'uninstalling'
  stage?: string
  canUninstall?: boolean
  busy: boolean
  progress?: number
  version?: string
}
declare global {
  interface Window {
    fitbayComponentSetup?: {
      list(): Promise<Row[]>
      uninstall(id: Id): Promise<void>
      install(id: Id): Promise<void>
    }
  }
}
export function ComponentInstallSettings({ onInstalled }: { onInstalled: () => void }) {
  const t = useTranslation()
  const [rows, setRows] = useState<Row[]>([])
  const [confirm, setConfirm] = useState<Id>()
  const [error, setError] = useState(false)
  const [scan, rescan] = useState(0)
  const api = window.fitbayComponentSetup
  // biome-ignore lint/correctness/useExhaustiveDependencies: A user action requests an immediate new snapshot.
  useEffect(() => {
    if (!api) return
    const bridge = api
    let active = true
    let timer: ReturnType<typeof setTimeout>
    async function read() {
      try {
        const next = await bridge.list()
        if (!active) return
        setRows(next)
        setError(false)
        if (next.some((row) => row.busy)) timer = setTimeout(read, 250)
      } catch {
        if (active) setError(true)
      }
    }
    void read()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [api, scan])
  const names = {
    music: 'Music',
    prompts: t('提示词库', 'Prompt library'),
    toolkit: t('工具集', 'Toolkit'),
  }
  const states = {
    uninstalling: t('正在卸载', 'Uninstalling'),
    installed: t('已安装', 'Installed'),
    missing: t('未安装', 'Not installed'),
    checking: t('检查正式发行包…', 'Checking release…'),
    downloading: t('下载并校验', 'Downloading and verifying'),
    installing: t('正在安装…', 'Installing…'),
    failed: t('安装失败', 'Installation failed'),
  }
  async function install(id: Id, remove = false) {
    if (!api) return
    const result = remove ? api.uninstall(id) : api.install(id)
    rescan((n) => n + 1)
    try {
      await result
      onInstalled()
    } catch {
      setError(true)
    } finally {
      rescan((n) => n + 1)
    }
  }
  return (
    <>
      {rows.map((row) => (
        <div className="component-inventory" key={row.id} data-install-product={row.id}>
          <strong>{names[row.id]}</strong>
          <span role="status">
            {row.stage === 'uninstalling' && row.status === 'failed'
              ? '卸载失败'
              : states[row.status]}{' '}
            {row.status === 'installed'
              ? row.version
              : row.status === 'downloading'
                ? row.progress + '%'
                : row.status === 'failed'
                  ? row.stage === 'uninstalling'
                    ? t(
                        '（请核对安装登记并重试）',
                        '(check the installation registration and retry)',
                      )
                    : row.stage === 'downloading'
                      ? t(
                          '（下载或 SHA-256 校验失败）',
                          '(download or SHA-256 verification failed)',
                        )
                      : row.stage === 'checking'
                        ? t('（无法获取正式发行包）', '(release unavailable)')
                        : t('（安装程序或安装后检测失败）', '(installer or detection failed)')
                  : ''}
          </span>
          {row.status === 'installed' && row.canUninstall === false ? (
            <span>
              {t('此位置未登记，无法卸载', 'Uninstall unavailable at this unregistered location')}
            </span>
          ) : row.status === 'installed' ||
            (row.stage === 'uninstalling' && row.status === 'failed') ? (
            <div>
              {confirm === row.id ? (
                <>
                  <span>保留数据并卸载？</span>
                  <Button
                    onClick={() => {
                      setConfirm(undefined)
                      void install(row.id, true)
                    }}
                  >
                    确认卸载
                  </Button>
                  <Button onClick={() => setConfirm(undefined)}>取消</Button>
                </>
              ) : (
                <Button disabled={row.busy} onClick={() => setConfirm(row.id)}>
                  {row.status === 'failed' ? '重试卸载' : '卸载'} {names[row.id]}
                </Button>
              )}
            </div>
          ) : (
            <Button size="small" disabled={row.busy} onClick={() => void install(row.id)}>
              {(row.status === 'failed' ? t('重试', 'Retry') : t('安装', 'Install')) +
                ' ' +
                names[row.id]}
            </Button>
          )}
        </div>
      ))}
      {error && (
        <Button onClick={() => rescan((n) => n + 1)}>
          {t('读取安装状态失败，重试', 'Could not read install status. Retry')}
        </Button>
      )}
    </>
  )
}
