import { useEffect, useState } from 'react'
import { Button, Popover, PopoverSurface, PopoverTrigger } from '@fluentui/react-components'
import { Download } from 'lucide-react'
import './download-tasks.css'

type Batch = { targetCount: number | null; state: string | null; message: string | null }
export function DownloadTasks({ batch, saved }: { batch?: Batch; saved: number }) {
  const [open, setOpen] = useState(false)
  const [tasks, setTasks] = useState<Awaited<ReturnType<typeof window.music.downloadTasks>>>([])
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (!open) return
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try {
        const list = await window.music.downloadTasks()
        if (alive) {
          setTasks(list)
          setError('')
          setLoaded(true)
        }
      } catch {
        if (alive) setError('无法读取下载任务')
      } finally {
        if (alive) timer = setTimeout(refresh, 500)
      }
    }
    void refresh()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [open])
  return (
    <Popover open={open} onOpenChange={(_, data) => setOpen(data.open)} positioning="below-end">
      <PopoverTrigger disableButtonEnhancement>
        <Button
          size="small"
          appearance="subtle"
          aria-label="下载任务"
          data-guide-anchor="tasks"
          title="下载任务"
          icon={<Download size={17} />}
        />
      </PopoverTrigger>
      <PopoverSurface className="component-popup download-tasks" aria-label="下载任务">
        <strong>下载任务</strong>
        {!!batch?.targetCount && (
          <section>
            <b>智能推荐</b>
            <span>
              已下载 {saved}/{batch.targetCount} 首
            </span>
            <small>
              {batch.message ||
                (batch.state === 'running'
                  ? '正在处理推荐'
                  : batch.state === 'completed'
                    ? '已完成'
                    : batch.state === 'cancelled'
                      ? '已终止'
                      : '')}
            </small>
          </section>
        )}
        {tasks.map((task) => (
          <section key={task.id}>
            <b>{task.title}</b>
            <span>{task.status}</span>
            {task.detail && <small>{task.detail}</small>}
            {task.status === '下载中' && (
              <Button
                size="small"
                onClick={() =>
                  void window.music
                    .cancelDownloadTask(task.id)
                    .catch(() => setError('取消下载失败'))
                }
              >
                取消下载
              </Button>
            )}
          </section>
        ))}
        {error ? (
          <p role="alert">{error}</p>
        ) : (
          !batch?.targetCount && !tasks.length && <p>{loaded ? '暂无下载任务' : '正在读取…'}</p>
        )}
      </PopoverSurface>
    </Popover>
  )
}
