import { TrackMenu } from './TrackMenu'
import { useState } from 'react'
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Option,
} from '@fluentui/react-components'
import { Play, Pause } from 'lucide-react'
import type { LocalTrack } from './LibraryPane'
import './infrequent.css'

type Props = {
  rows: LocalTrack[]
  days: number
  changeDays: (n: number) => void
  active: string
  playing: boolean
  play: (id: string, queue?: string[]) => void
  remove: (id: string, trash: boolean) => Promise<boolean>
}
const formatBytes = (n: number) => {
  const unit = n >= 1024 ** 3 ? 3 : n >= 1024 ** 2 ? 2 : n >= 1024 ? 1 : 0
  return (
    (n / 1024 ** unit).toLocaleString('zh-CN', { maximumFractionDigits: 1 }) +
    ' ' +
    ['B', 'KiB', 'MiB', 'GiB'][unit]
  )
}
export function InfrequentTracks({ rows, days, changeDays, active, playing, play, remove }: Props) {
  const [selected, setSelected] = useState(new Set<string>())
  const [action, setAction] = useState<'index' | 'trash'>()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const sorted = [...rows].sort(
    (a, b) =>
      (a.lastHeardAt ?? a.observedAt) - (b.lastHeardAt ?? b.observedAt) ||
      a.title.localeCompare(b.title),
  )
  const chosen = sorted.filter((t) => selected.has(t.id))
  const bytes = chosen.reduce((sum, t) => sum + (t.size ?? 0), 0)
  const unknown = chosen.filter((t) => t.size === null).length
  const summary =
    '已选 ' +
    chosen.length +
    ' 首 · ' +
    formatBytes(bytes) +
    (unknown ? '，另有 ' + unknown + ' 首大小未知' : '')
  const execute = async () => {
    if (!action || busy) return
    setBusy(true)
    let completed = 0
    try {
      for (const track of chosen) {
        if (!(await remove(track.id, action === 'trash'))) break
        completed++
      }
      setNotice('已处理 ' + completed + ' / ' + chosen.length + ' 首')
    } finally {
      setBusy(false)
      setAction(undefined)
    }
  }
  return (
    <section className="local-library infrequent" aria-label="重温旧曲歌曲">
      <div className="library-title">
        <div>
          <h2>重温旧曲</h2>
          <small>{rows.length} 首歌曲</small>
        </div>
      </div>
      <div className="infrequent-filters">
        <label htmlFor="infrequent-days">
          未收听时间
          <Dropdown
            id="infrequent-days"
            inlinePopup
            aria-label="未收听时间"
            size="small"
            value={days + ' 天'}
            selectedOptions={[String(days)]}
            listbox={{ className: 'component-popup' }}
            onOptionSelect={(_, d) => {
              if (d.optionValue) {
                changeDays(Number(d.optionValue))
                setSelected(new Set())
                setNotice('')
              }
            }}
          >
            {[30, 90, 180].map((d) => (
              <Option key={d} value={String(d)}>
                {d + ' 天'}
              </Option>
            ))}
          </Dropdown>
        </label>
      </div>
      <p>
        每次播放累计满 30 秒，或完整播完不足 30
        秒的歌曲，记为一次收听。没有收听记录的歌曲从开始观察之日算起。
      </p>
      {sorted.length > 0 ? (
        <>
          <div className="infrequent-tools">
            <Checkbox
              label="全选"
              checked={chosen.length === sorted.length || (chosen.length ? 'mixed' : false)}
              onChange={(_, d) => setSelected(new Set(d.checked ? sorted.map((t) => t.id) : []))}
            />
            <small>{summary}</small>
            <Button size="small" disabled={!chosen.length} onClick={() => setAction('index')}>
              仅移除索引
            </Button>
            <Button size="small" disabled={!chosen.length} onClick={() => setAction('trash')}>
              移至回收站
            </Button>
          </div>
          <ul>
            {sorted.map((t) => (
              <TrackMenu key={t.id} localId={t.id}>
                <li className="infrequent-row">
                  <Checkbox
                    aria-label={'选择' + t.title}
                    checked={selected.has(t.id)}
                    onChange={(_, d) =>
                      setSelected((prev) => {
                        const next = new Set(prev)
                        if (d.checked) next.add(t.id)
                        else next.delete(t.id)
                        return next
                      })
                    }
                  />
                  <Button
                    size="small"
                    appearance="subtle"
                    aria-label={(active === t.id && playing ? '暂停' : '试听') + t.title}
                    disabled={!t.available}
                    icon={active === t.id && playing ? <Pause size={16} /> : <Play size={16} />}
                    onClick={() =>
                      play(
                        t.id,
                        sorted.filter((track) => track.available).map((track) => track.id),
                      )
                    }
                  />
                  <div className="library-name">
                    <strong>{t.title}</strong>
                    <small>{t.artist}</small>
                    <small>
                      {t.lastHeardAt
                        ? '上次收听 ' + new Date(t.lastHeardAt).toLocaleDateString('zh-CN')
                        : '尚无收听记录 · ' +
                          new Date(t.observedAt).toLocaleDateString('zh-CN') +
                          ' 起观察'}
                    </small>
                  </div>
                  <small>{t.size === null ? '大小未知' : formatBytes(t.size)}</small>
                </li>
              </TrackMenu>
            ))}
          </ul>
        </>
      ) : (
        <p>目前没有满 {days} 天未收听的歌曲。</p>
      )}
      {notice && <p role="status">{notice}</p>}
      {action && (
        <Dialog
          open
          onOpenChange={(_, d) => {
            if (!busy && !d.open) setAction(undefined)
          }}
        >
          <DialogSurface className="component-popup">
            <DialogBody>
              <DialogTitle>
                {action === 'index' ? '仅移除曲库索引？' : '将所选歌曲移至系统回收站？'}
              </DialogTitle>
              <DialogContent>
                {summary}。
                {action === 'index'
                  ? '将移除这些歌曲及歌单引用，保留原文件。'
                  : '下一步将逐首核对文件位置。取消时保留尚未处理的歌曲。'}
              </DialogContent>
              <DialogActions>
                <Button disabled={busy} onClick={() => setAction(undefined)}>
                  取消
                </Button>
                <Button appearance="primary" disabled={busy} onClick={() => void execute()}>
                  {busy ? '处理中' : '确认继续'}
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
    </section>
  )
}
