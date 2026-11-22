import project from '../../../../package.json'
import { Button } from '@fluentui/react-components'
import { useState } from 'react'
import { useTranslation } from './preferences'

type Status = 'unchecked' | 'available' | 'current' | 'unsupported' | 'failed'
export type UpdateState = {
  lastChecked: string | null
  rows: {
    id: string
    name: string
    version: string
    available: string | null
    status: Status
    installable: boolean
  }[]
}
declare global {
  interface Window {
    fitbayUpdates?: {
      snapshot(): Promise<UpdateState>
      check(id?: string): Promise<UpdateState>
      install(id: string): Promise<void>
      onOpen(fn: () => void): () => void
      onState(fn: (state: UpdateState) => void): () => void
    }
  }
}
export function WorkbenchUpdates({ state }: { state?: UpdateState }) {
  const t = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const api = window.fitbayUpdates
  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch {
      setError(t('操作失败，请重试', 'Action failed. Please retry.'))
    } finally {
      setBusy(false)
    }
  }
  const labels = {
    unchecked: t('尚未检查', 'Not checked'),
    current: t('已是最新', 'Up to date'),
    failed: t('检查失败', 'Check failed'),
    available: t('可更新', 'Update available'),
    unsupported: t('未接入在线更新', 'Online updates unsupported'),
  }
  return (
    <section className="update-page">
      <header id="setting-3-0">
        <p>
          {t('上次检查', 'Last checked')} ·{' '}
          {state?.lastChecked
            ? new Date(state.lastChecked).toLocaleString()
            : t('尚未检查', 'Not checked')}
        </p>{' '}
        <Button disabled={busy || !api} onClick={() => api && void run(() => api.check())}>
          {t('检查全部更新', 'Check all updates')}
        </Button>
      </header>

      {!api && (
        <p>{t('当前启动方式未连接更新服务', 'Update service unavailable in this launch mode')}</p>
      )}
      {(
        state?.rows ??
        (!api
          ? [
              {
                id: 'workbench',
                name: 'FitBay',
                version: project.version,
                available: null,
                status: 'unsupported' as const,
                installable: false,
              },
            ]
          : [])
      ).map((row) => (
        <section className="update-row" key={row.id}>
          <div>
            <h3>{row.name}</h3>
            <p>
              {t('已安装版本', 'Installed version')} {row.version} · {labels[row.status]}
              {row.available && ' · ' + t('可用版本', 'Available version') + ' ' + row.available}
            </p>
          </div>
          <div className="update-actions">
            {api && row.status !== 'unsupported' && (
              <Button disabled={busy} onClick={() => void run(() => api.check(row.id))}>
                {row.status === 'failed' ? t('重试', 'Retry') : t('检查更新', 'Check for updates')}
              </Button>
            )}
            {row.status === 'available' && api && row.installable && (
              <Button disabled={busy} onClick={() => void run(() => api.install(row.id))}>
                {t('更新', 'Update')} {row.name}
              </Button>
            )}
          </div>
        </section>
      ))}
      {state?.rows.some((row) => !row.installable && row.id === 'workbench') && (
        <p>{t('开发构建仅支持检查版本', 'Development builds support version checks only')}</p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
