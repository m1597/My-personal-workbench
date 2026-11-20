import { Button, Tooltip } from '@fluentui/react-components'
import { Download } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { PlaylistTrack } from './LibraryPane'
import { useMusicFeedback } from './musicFeedback'

type DownloadTask = Awaited<ReturnType<typeof window.music.downloadTasks>>[number]

export function PlaylistDownload({
  collection,
  members,
  refresh,
}: {
  collection: string
  members: PlaylistTrack[]
  refresh: () => Promise<void>
}) {
  const feedback = useMusicFeedback()
  const [task, setTask] = useState<DownloadTask>()
  const [message, setMessage] = useState('')
  const [taskId, setTaskId] = useState<string>()
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    async function read() {
      try {
        const list = await window.music.downloadTasks()
        if (!alive) return
        const latest = list.find(
          (item) => item.collection === collection && (!taskId || item.id === taskId),
        )
        setTask(latest)
        if (latest && ['等待中', '下载中'].includes(latest.status)) timer = setTimeout(read, 350)
        else if (latest) await refreshRef.current()
      } catch (error) {
        if (alive) setMessage(String(error))
      }
    }
    void read()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [collection, taskId])
  async function enqueue(ids: string[]) {
    try {
      const result = await window.music.queuePlaylistDownload(ids, collection)
      setMessage(
        feedback.text(
          `入队 ${result.queued} 首 · 跳过 ${result.skipped} 首`,
          `Queued ${result.queued} · Skipped ${result.skipped}`,
        ),
      )
      if (result.taskId) setTaskId(result.taskId)
    } catch (error) {
      setMessage(feedback.error(error))
    }
  }
  const label = feedback.text('下载全部', 'Download all')
  const ids = members.map((member) => member.id)
  const failed = new Set(task?.failedIds)
  const retry = ids.filter((id) => failed.has(id))
  return (
    <>
      <Tooltip content={label} relationship="label">
        <Button
          size="small"
          icon={<Download size={16} />}
          aria-label={label}
          disabled={!ids.length}
          onClick={() => void enqueue(ids)}
        />
      </Tooltip>
      {(message || task) && (
        <small className="playlist-download-status" role="status">
          {message && (
            <span>
              {feedback.text('本次操作', 'This action')} · {message}
            </span>
          )}
          {task && (
            <span>
              {feedback.text('下载任务', 'Download task')} · {task.detail || task.status}
            </span>
          )}
        </small>
      )}
      {!!retry.length && task && !['下载中', '等待中'].includes(task.status) && (
        <Button size="small" onClick={() => void enqueue(retry)}>
          {feedback.text('仅重试失败项', 'Retry failed')}
        </Button>
      )}
    </>
  )
}
