import project from '../../../../package.json'
import { Button } from '@fluentui/react-components'
import { useComponentSetup } from './ComponentInstallSettings'
import { useState, type ReactNode } from 'react'
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
    operation?: { stage: string; progress?: number }
    development?: boolean
    revision?: string
    installable: boolean
  }[]
}
declare global {
  interface Window {
    fitbayUpdates?: {
      snapshot(): Promise<UpdateState>
      check(id?: string): Promise<UpdateState>
      installAll(): Promise<void>
      install(id: string): Promise<void>
      onOpen(fn: () => void): () => void
      onState(fn: (state: UpdateState) => void): () => void
    }
  }
}
export function WorkbenchUpdates({
  state,
  children,
  onInstalled,
}: {
  state?: UpdateState
  children: ReactNode
  onInstalled: () => void
}) {
  const t = useTranslation()
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState('')
  const setup = useComponentSetup(onInstalled)
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
      <header id="setting-2-3">
        <p>
          {t('上次检查', 'Last checked')} ·{' '}
          {state?.lastChecked
            ? new Date(state.lastChecked).toLocaleString()
            : t('尚未检查', 'Not checked')}
        </p>{' '}
        <Button disabled={busy || !api} onClick={() => api && void run(() => api.check())}>
          {t('检查全部更新', 'Check all updates')}
        </Button>
        {state?.rows.some((r) => r.installable) && (
          <Button
            disabled={busy || !state.rows.some((r) => r.installable && r.status === 'available')}
            onClick={() => setConfirm(true)}
          >
            {t('更新全部', 'Update all')}
          </Button>
        )}
      </header>
      {confirm && (
        <fieldset aria-label="确认批量更新">
          <p>
            确认更新{' '}
            {state?.rows
              .filter((r) => r.installable && r.status === 'available')
              .map((r) => r.name)
              .join('、')}
            ？工作台最后更新。
          </p>
          <Button
            onClick={() => {
              setConfirm(false)
              if (api) void run(() => api.installAll())
            }}
          >
            确认更新全部
          </Button>
          <Button onClick={() => setConfirm(false)}>取消</Button>
        </fieldset>
      )}

      {!api && (
        <p>{t('当前启动方式未连接更新服务', 'Update service unavailable in this launch mode')}</p>
      )}
      {(['workbench', 'music', 'prompts', 'toolkit'] as const).map((id) => {
        const row =
          state?.rows.find((r) => r.id === id) ??
          (id === 'workbench' && !api
            ? {
                id,
                name: 'FitBay',
                version: project.version,
                status: 'unsupported' as const,
                development: true,
                revision: undefined,
                operation: undefined,
                available: null,
                installable: false,
              }
            : undefined)
        const name = {
          workbench: 'FitBay',
          music: 'Music',
          prompts: t('提示词库', 'Prompt library'),
          toolkit: t('工具集', 'Toolkit'),
        }[id]
        const actions = setup.actions(id)
        return (
          <section className="update-row" key={id} data-product={id}>
            <div>
              <h3>{name}</h3>
              {row && (
                <p>
                  {row.development
                    ? t('产品开发构建', 'Product development build')
                    : t('已安装版本', 'Installed version')}{' '}
                  {row.version}
                  {row.revision && ` (${row.revision})`} ·{' '}
                  {row.development && (row.status === 'current' || row.status === 'available')
                    ? t('已检查', 'Checked')
                    : labels[row.status]}
                  {row.available &&
                    (row.id === 'workbench' || row.status === 'available') &&
                    ' · ' +
                      (row.id === 'workbench'
                        ? t('最新正式版', 'Latest stable release')
                        : t('可用版本', 'Available version')) +
                      ' ' +
                      row.available}
                </p>
              )}
              {!row && !actions && (
                <p>{state ? t('未安装', 'Not installed') : t('正在读取…', 'Loading…')}</p>
              )}
              {row?.operation && (
                <p role="status">
                  {
                    {
                      downloading: '下载并校验 ' + (row.operation.progress ?? 0) + '%',
                      installing: '正在安装',
                      restarting: '正在退出工作台，重启后核对安装结果',
                      done: '已完成',
                      failed: '更新失败，可单项重试',
                    }[row.operation.stage]
                  }
                </p>
              )}
            </div>
            <div className="update-actions">
              {api && row && row.status !== 'unsupported' && (
                <Button disabled={busy} onClick={() => void run(() => api.check(row.id))}>
                  {row.status === 'failed'
                    ? t('重试', 'Retry')
                    : t('检查更新', 'Check for updates')}
                </Button>
              )}
              {row?.status === 'available' && api && row.installable && (
                <Button disabled={busy} onClick={() => void run(() => api.install(row.id))}>
                  {row.operation?.stage === 'failed'
                    ? t('重试更新', 'Retry update')
                    : t('更新', 'Update')}{' '}
                  {row.name}
                </Button>
              )}
              {actions}
            </div>
            {id === 'music' && children}
          </section>
        )
      })}
      {setup.error && (
        <Button onClick={setup.retry}>
          {t('读取安装状态失败，重试', 'Could not read install status. Retry')}
        </Button>
      )}
      {state?.rows.some((row) => !row.installable && row.id === 'workbench') && (
        <p>{t('开发构建仅支持检查版本', 'Development builds support version checks only')}</p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
