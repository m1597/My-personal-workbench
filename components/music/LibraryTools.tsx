import { useEffect, useState } from 'react'
import { Button, Dropdown, Option } from '@fluentui/react-components'
import { Play } from 'lucide-react'
import type { LocalTrack } from './LibraryPane'
import './library-tools.css'

type HistoryRow = { event: string; track: string; playedAt: number }
type Restore = {
  token: string
  songs: number
  playlists: number
  favorites: number
  events: number
  feedback: number
  hasTaste: boolean
  names: string[]
}
type Move = {
  token: string
  rows: {
    id: string
    title: string
    artist: string
    album: string
    oldFile: string
    options: { id: string; file: string; artist: string; album: string; duration: number }[]
  }[]
}
export type LibraryToolsAPI = {
  recentHistory(cursor?: HistoryRow): Promise<HistoryRow[]>
  setFavorite(id: string, on: boolean): Promise<void>
  exportLibrary(): Promise<boolean>
  previewRestore(): Promise<Restore | null>
  applyRestore(token: string): Promise<void>
  previewRelocation(): Promise<Move | null>
  applyRelocation(token: string, choices: { track: string; candidate: string }[]): Promise<number>
}
const message = (error: unknown) => String(error).split('Error: ').pop() || '操作失败'
export function RecentHistory({
  tracks,
  play,
}: {
  tracks: LocalTrack[]
  play: (id: string, queue?: string[]) => void
}) {
  const [rows, setRows] = useState<HistoryRow[]>([]),
    [more, setMore] = useState(false),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false)
  const count = tracks.reduce((n, t) => n + t.playCount, 0)
  useEffect(() => {
    if (!count) {
      setRows([])
      setMore(false)
      return
    }
    let active = true
    void window.music
      .recentHistory()
      .then((page) => {
        if (active) {
          setRows(page.slice(0, 200))
          setMore(page.length > 200)
          setError('')
        }
      })
      .catch((e) => {
        if (active) setError(message(e))
      })
    return () => {
      active = false
    }
  }, [count])
  const items = new Map(tracks.map((t) => [t.id, t]))
  const queue = [...new Set(rows.map((r) => r.track).filter((id) => items.get(id)?.available))]
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const group = (t: number) =>
    t >= today.getTime() ? '今天' : t >= yesterday.getTime() ? '昨天' : '更早'
  return (
    <section className="local-library music-library-tools" aria-label="最近播放">
      <h2>最近播放</h2>
      {!rows.length && (
        <p>
          {error || '还没有有效播放记录。播放满 30 秒，或完整播完一首短歌后，它就会出现在这里。'}
        </p>
      )}
      {['今天', '昨天', '更早'].map((label) => {
        const part = rows.filter((r) => group(r.playedAt) === label && items.has(r.track))
        return (
          part.length > 0 && (
            <section key={label}>
              <h3>{label}</h3>
              <ul>
                {part.map((r) => {
                  const t = items.get(r.track)
                  return (
                    t && (
                      <li key={r.event}>
                        <Button
                          appearance="subtle"
                          disabled={!t.available}
                          icon={<Play size={15} />}
                          onClick={() => play(r.track, queue)}
                        >
                          {t.title} · {t.artist}
                        </Button>
                        <small>{new Date(r.playedAt).toLocaleString('zh-CN')}</small>
                      </li>
                    )
                  )
                })}
              </ul>
            </section>
          )
        )
      })}
      {more && (
        <Button
          disabled={loading}
          onClick={async () => {
            setLoading(true)
            try {
              const page = await window.music.recentHistory(rows.at(-1))
              setRows((prev) => [...prev, ...page.slice(0, 200)])
              setMore(page.length > 200)
            } catch (e) {
              setError(message(e))
            } finally {
              setLoading(false)
            }
          }}
        >
          更早记录
        </Button>
      )}
      {rows.length > 0 && error && <p role="status">{error}</p>}
    </section>
  )
}
export function LibraryTools({ refresh }: { refresh: () => Promise<void> }) {
  const [backup, setBackup] = useState<Restore | null>(null),
    [move, setMove] = useState<Move | null>(null),
    [choices, setChoices] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState('')
  const action = async (fn: () => Promise<void>) => {
    setStatus('')
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      setStatus(message(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="local-library music-library-tools" aria-label="曲库管理">
      <h2>曲库管理</h2>
      <section>
        <h3>备份与恢复</h3>
        <p>导出歌曲索引、歌单及智能歌单规则、收藏、播放历史和推荐偏好。音频文件需另行备份。</p>
        <div className="library-tool-actions">
          <Button
            disabled={busy}
            onClick={() =>
              void action(async () => {
                if (await window.music.exportLibrary()) setStatus('曲库资料已导出')
              })
            }
          >
            导出备份
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void action(async () => {
                setMove(null)
                setBackup(await window.music.previewRestore())
              })
            }
          >
            选择备份
          </Button>
        </div>
        {backup && (
          <div>
            <h4>恢复预览</h4>
            <p>
              {backup.songs} 首歌曲 · {backup.playlists} 个歌单 · {backup.favorites} 首收藏 ·{' '}
              {backup.events} 条播放记录 · {backup.feedback} 条推荐反馈
            </p>
            {backup.names.length > 0 && <p>歌单：{backup.names.join('、')}</p>}
            <p>
              合并至当前曲库。同名歌单采用备份顺序，已有的其他歌曲追加在后。同名智能歌单规则、推荐草稿和偏好资料采用备份版本。传送资料给模型的授权保持当前设置。
            </p>
            <p>新恢复的条目需在下方选择音频所在目录找回。</p>
            <Button
              appearance="primary"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await window.music.applyRestore(backup.token)
                  setBackup(null)
                  await refresh()
                  setStatus('曲库资料已恢复')
                })
              }
            >
              确认恢复
            </Button>
            <Button disabled={busy} onClick={() => setBackup(null)}>
              取消恢复
            </Button>
          </div>
        )}
      </section>
      <section>
        <h3>换盘找回歌曲</h3>
        <p>选择新目录，核对失联歌曲与候选文件后更新路径。未找到的歌曲会保留在曲库。</p>
        <Button
          disabled={busy}
          onClick={() =>
            void action(async () => {
              setBackup(null)
              setMove(null)
              const info = await window.music.previewRelocation()
              setMove(info)
              const used = new Map<string, number>()
              for (const row of info?.rows ?? [])
                for (const option of row.options)
                  used.set(option.id, (used.get(option.id) ?? 0) + 1)
              setChoices(
                Object.fromEntries(
                  (info?.rows ?? [])
                    .filter((r) => r.options.length === 1 && used.get(r.options[0].id) === 1)
                    .map((r) => [r.id, r.options[0].id]),
                ),
              )
            })
          }
        >
          选择新目录
        </Button>
        {move && (
          <div>
            <h4>路径匹配预览</h4>
            {!move.rows.length && <p>当前没有需要找回的歌曲。</p>}
            {move.rows.map((r) => (
              <div key={r.id} className="library-match">
                <strong>
                  {r.title} · {r.artist}
                </strong>
                <small>{r.oldFile}</small>
                {r.options.length ? (
                  <Dropdown
                    aria-label={'为' + r.title + '选择文件'}
                    inlinePopup
                    listbox={{ className: 'component-popup' }}
                    selectedOptions={[choices[r.id] || '']}
                    value={r.options.find((o) => o.id === choices[r.id])?.file ?? '暂不更新'}
                    disabled={busy}
                    onOptionSelect={(_, d) =>
                      setChoices((prev) => ({ ...prev, [r.id]: d.optionValue || '' }))
                    }
                  >
                    <Option value="">暂不更新</Option>
                    {r.options.map((o) => (
                      <Option key={o.id} value={o.id} text={o.file}>
                        {o.file} · {o.artist} · {o.album} · {Math.round(o.duration)} 秒
                      </Option>
                    ))}
                  </Dropdown>
                ) : (
                  <small>未找到匹配文件</small>
                )}
              </div>
            ))}
            <Button
              appearance="primary"
              disabled={busy || !Object.values(choices).some(Boolean)}
              onClick={() =>
                void action(async () => {
                  const selections = Object.entries(choices)
                    .filter(([, v]) => v)
                    .map(([track, candidate]) => ({ track, candidate }))
                  const n = await window.music.applyRelocation(move.token, selections)
                  setMove(null)
                  await refresh()
                  setStatus('已找回 ' + n + ' 首歌曲')
                })
              }
            >
              确认更新路径
            </Button>
            <Button disabled={busy} onClick={() => setMove(null)}>
              取消匹配
            </Button>
          </div>
        )}
      </section>
      {(busy || status) && <p role="status">{busy ? '处理中…' : status}</p>}
    </section>
  )
}
