import { useState } from 'react'
import { Button, Checkbox, Radio, RadioGroup } from '@fluentui/react-components'
type Copy = {
  id: string
  file: string
  title: string
  artist: string
  bytes: number
  favorite: boolean
}
type Rename = { id: string; file: string; to: string; reason?: string }
type Preview = { token: string; groups?: Copy[][]; unreadable?: string[]; items?: Rename[] }
export interface CleanupAPI {
  previewCleanup(mode: 'duplicates' | 'rename'): Promise<Preview>
  applyCleanup(
    token: string,
    action: 'forget' | 'trash' | 'rename',
    selections: string[],
  ): Promise<{ changed: number; skipped: string[] }>
}
export function LibraryCleanup({ refresh }: { refresh: () => Promise<void> }) {
  const [preview, setPreview] = useState<Preview>(),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState('')
  async function scan(mode: 'duplicates' | 'rename') {
    setBusy(true)
    setStatus('')
    setPreview(undefined)
    try {
      const plan = await window.music.previewCleanup(mode)
      setPreview(plan)
      setSelected(
        plan.groups
          ? plan.groups.map((g) => g[0].id)
          : (plan.items?.filter((r) => !r.reason).map((r) => r.id) ?? []),
      )
    } catch (e) {
      setStatus(String(e).split('Error: ').at(-1) || '扫描失败')
    } finally {
      setBusy(false)
    }
  }
  async function apply(action: 'forget' | 'trash' | 'rename') {
    if (!preview) return
    setBusy(true)
    try {
      const { changed, skipped } = await window.music.applyCleanup(preview.token, action, selected)
      setStatus(
        '已处理 ' + changed + ' 项' + (skipped.length ? '，已跳过 ' + skipped.join('；') : ''),
      )
      setPreview(undefined)
      await refresh()
    } catch (e) {
      setStatus(String(e).split('Error: ').at(-1) || '整理失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="library-cleanup" aria-label="曲库整理">
      <h2>曲库整理</h2>
      <div className="settings-buttons">
        <Button disabled={busy} onClick={() => void scan('duplicates')}>
          按录音内容查重
        </Button>
        <Button disabled={busy} onClick={() => void scan('rename')}>
          预览移除文件名曲序号
        </Button>
      </div>
      {busy && <p role="status">正在处理曲库文件…</p>}
      {preview?.groups && (
        <>
          {preview.groups.length ? (
            <>
              <p>每组选择要保留的文件。仅移除索引会保留磁盘上的重复文件。</p>
              {preview.groups.map((group, i) => (
                <fieldset key={group[0].id}>
                  <legend>保留「{group[0].title}」的一份录音</legend>
                  <RadioGroup
                    value={selected[i]}
                    onChange={(_, d) =>
                      setSelected((ids) => ids.map((v, n) => (i === n ? d.value : v)))
                    }
                  >
                    {group.map((copy) => (
                      <Radio
                        key={copy.id}
                        value={copy.id}
                        label={copy.file + (copy.favorite ? ' · 已收藏' : '')}
                      />
                    ))}
                  </RadioGroup>
                </fieldset>
              ))}
              <div className="settings-buttons">
                <Button disabled={busy} onClick={() => void apply('forget')}>
                  仅移除其他索引
                </Button>
                <Button disabled={busy} onClick={() => void apply('trash')}>
                  将其他文件移至回收站…
                </Button>
              </div>
            </>
          ) : (
            <p>没有找到重复录音。</p>
          )}
          {!!preview.unreadable?.length && (
            <details>
              <summary>无法检查 {preview.unreadable.length} 个文件</summary>
              {preview.unreadable.map((f) => (
                <p key={f}>{f}</p>
              ))}
            </details>
          )}
        </>
      )}
      {preview?.items && (
        <>
          {preview.items.length ? (
            <>
              <p>同名歌词随音频改名。保留收藏、歌单和曲目 ID。</p>
              {preview.items.map((r) => (
                <Checkbox
                  key={r.id}
                  disabled={!!r.reason || busy}
                  checked={selected.includes(r.id)}
                  label={r.file + ' → ' + r.to + (r.reason ? '（跳过：' + r.reason + '）' : '')}
                  onChange={(_, d) =>
                    setSelected((ids) =>
                      d.checked ? [...ids, r.id] : ids.filter((id) => id !== r.id),
                    )
                  }
                />
              ))}
              <div>
                <Button disabled={busy || !selected.length} onClick={() => void apply('rename')}>
                  确认改名 {selected.length} 项
                </Button>
              </div>
            </>
          ) : (
            <p>没有可移除曲序号的文件。</p>
          )}
        </>
      )}
      {!busy && status && <p role="status">{status}</p>}
    </section>
  )
}
