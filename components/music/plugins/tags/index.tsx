import { Button, Checkbox, Input } from '@fluentui/react-components'
import { useEffect, useRef, useState } from 'react'
import type { LocalTrack } from '../../LibraryPane'
import styles from './tags.css?inline'

type Field = 'title' | 'artist' | 'album'
type Labels = Record<Field, string>
const labels: Labels = { title: '歌名', artist: '艺人', album: '专辑' }
const fields = Object.keys(labels) as Field[]
type Bitmap = { width: number; height: number; data: Uint8Array }
type PreviewRow = {
  id: string
  label: string
  current: Labels
  suggested: Labels
  hasCover: boolean
  currentCover: Bitmap | null
  suggestedCover: Bitmap | null
  coverName: string | null
}
type Preview = { token: string; rows: (PreviewRow | { id: string; error: string })[] }
type Edits = Partial<Labels> & { cover?: true }
const api = <T,>(action: string, ...args: unknown[]) =>
  window.musicPlugins.call<T>('tags', action, ...args)
function Cover({ image, label }: { image: Bitmap | null; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const surface = canvas.current?.getContext('2d')
    if (!image || !surface) return
    const pixels = surface.createImageData(image.width, image.height)
    pixels.data.set(image.data)
    surface.putImageData(pixels, 0, 0)
  }, [image])
  return image ? (
    <canvas ref={canvas} width={image.width} height={image.height} role="img" aria-label={label} />
  ) : (
    <small>{label}</small>
  )
}
export default function Tags({
  tracks,
  refresh,
}: {
  tracks: LocalTrack[]
  refresh: () => Promise<void>
}) {
  const [filter, setFilter] = useState('')
  const [ids, setIds] = useState(new Set<string>())
  const [adjacent, setAdjacent] = useState(false)
  const [cover, setCover] = useState<{ token: string; name: string } | null>(null)
  const [preview, setPreview] = useState<Preview>()
  const [edits, setEdits] = useState<Record<string, Edits>>({})
  const [drafts, setDrafts] = useState<Record<string, Partial<Labels>>>({})
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const available = tracks.filter(
    (row) =>
      row.available &&
      row.listed &&
      (row.title + ' ' + row.artist).toLowerCase().includes(filter.toLowerCase()),
  )
  const shown = available.slice(0, 100)
  const count = Object.values(edits).reduce((n, row) => n + Object.keys(row).length, 0)
  function field(id: string, k: keyof Edits, v: string | true | undefined) {
    setEdits((old) => {
      const values = { ...old[id] }
      if (v === undefined) delete values[k]
      else Object.assign(values, { [k]: v })
      return { ...old, [id]: values }
    })
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setStatus('')
    try {
      await fn()
    } catch (e) {
      setStatus(e instanceof Error ? e.message.split('Error: ').pop() || e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }
  async function scan() {
    const data = await api<Preview>('preview', [...ids], cover?.token, adjacent)
    setEdits({})
    setDrafts({})
    setPreview(data)
  }
  async function apply() {
    if (!preview) return
    const changes = Object.entries(edits)
      .filter(([, v]) => Object.keys(v).length)
      .map(([id, values]) => ({ id, values }))
    const result = await api<{ id: string; ok?: boolean; error?: string }[]>(
      'apply',
      preview.token,
      changes,
    )
    const failed = result.filter((r) => !r.ok)
    setStatus(
      [
        '已写入 ' + (result.length - failed.length) + ' 首',
        ...failed.map((r) => (tracks.find((t) => t.id === r.id)?.title || '曲目') + '：' + r.error),
      ].join('；'),
    )
    setPreview(undefined)
    setEdits({})
    await refresh()
  }
  return (
    <section className="tag-editor" aria-label="歌曲标签与封面整理">
      <style>{styles}</style>
      <h2>歌曲标签与封面整理</h2>
      {preview ? (
        <>
          <div className="tag-actions">
            <Button
              disabled={busy}
              onClick={() => {
                setPreview(undefined)
                setStatus('')
              }}
            >
              重新选择歌曲
            </Button>
            <Button
              appearance="primary"
              disabled={
                busy ||
                !count ||
                Object.values(edits).some((e) => fields.some((f) => f in e && !e[f]?.trim()))
              }
              onClick={() => void run(apply)}
            >
              写入所选字段{count ? '（' + count + '）' : ''}
            </Button>
          </div>
          {preview.rows.map((row) =>
            'error' in row ? (
              <p key={row.id}>
                {tracks.find((t) => t.id === row.id)?.title} · {row.error}
              </p>
            ) : (
              <fieldset key={row.id} disabled={busy}>
                <legend>{row.label}</legend>
                <div className="tag-columns" aria-hidden="true">
                  <span>写入字段</span>
                  <span>原资料</span>
                  <span>建议结果</span>
                </div>
                {fields.map((k) => (
                  <div className="tag-columns" key={k}>
                    <Checkbox
                      label={labels[k]}
                      aria-label={row.label + ' 写入' + labels[k]}
                      checked={k in (edits[row.id] || {})}
                      onChange={(_, d) =>
                        field(
                          row.id,
                          k,
                          d.checked ? (drafts[row.id]?.[k] ?? row.suggested[k]) : undefined,
                        )
                      }
                    />
                    <span>{row.current[k] || '未填写'}</span>
                    <Input
                      aria-label={row.label + ' 建议' + labels[k]}
                      maxLength={2048}
                      value={drafts[row.id]?.[k] ?? row.suggested[k]}
                      onChange={(_, d) => {
                        setDrafts((old) => ({ ...old, [row.id]: { ...old[row.id], [k]: d.value } }))
                        if (k in (edits[row.id] || {})) field(row.id, k, d.value)
                      }}
                    />
                  </div>
                ))}
                <div className="tag-columns">
                  <Checkbox
                    label="封面"
                    aria-label={row.label + ' 写入封面'}
                    disabled={!row.coverName}
                    checked={edits[row.id]?.cover === true}
                    onChange={(_, d) => field(row.id, 'cover', d.checked ? true : undefined)}
                  />
                  <Cover image={row.currentCover} label={row.hasCover ? '已有封面' : '无封面'} />
                  <Cover image={row.suggestedCover} label={row.coverName || '无新封面'} />
                </div>
              </fieldset>
            ),
          )}
        </>
      ) : (
        <>
          <p>选择曲目后，按文件名、所在文件夹及封面图片生成建议。预览中可逐项修改和勾选。</p>
          <Input
            aria-label="筛选要整理的歌曲"
            placeholder="搜索歌名或艺人"
            value={filter}
            onChange={(_, d) => setFilter(d.value)}
          />
          <div className="tag-actions">
            <Button
              size="small"
              disabled={busy || !available.length}
              onClick={() => setIds(new Set(available.slice(0, 50).map((r) => r.id)))}
            >
              选择{available.length > 50 ? '前 50 首' : '筛选结果'}
            </Button>
            <Button size="small" disabled={busy || !ids.size} onClick={() => setIds(new Set())}>
              清空选择
            </Button>
            <small>已选 {ids.size} 首</small>
          </div>
          <section className="tag-pick" aria-label="待整理歌曲">
            {shown.length ? (
              shown.map((row) => (
                <Checkbox
                  key={row.id}
                  label={row.title + ' · ' + row.artist}
                  checked={ids.has(row.id)}
                  disabled={busy || (!ids.has(row.id) && ids.size >= 50)}
                  onChange={(_, d) =>
                    setIds((old) => {
                      const next = new Set(old)
                      if (d.checked) next.add(row.id)
                      else next.delete(row.id)
                      return next
                    })
                  }
                />
              ))
            ) : (
              <p>没有符合条件的歌曲</p>
            )}
          </section>
          {available.length > 100 && <small>显示前 100 首，可用搜索缩小范围。</small>}
          <Checkbox
            label="查找歌曲同目录的封面图片"
            disabled={busy || !!cover}
            checked={adjacent}
            onChange={(_, d) => setAdjacent(!!d.checked)}
          />
          <div className="tag-actions">
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const value = await api<{ token: string; name: string } | null>('chooseCover')
                  if (value) setCover(value)
                })
              }
            >
              选择封面图片
            </Button>
            {cover && (
              <>
                <small>{cover.name}</small>
                <Button size="small" disabled={busy} onClick={() => setCover(null)}>
                  清除封面选择
                </Button>
              </>
            )}
            <Button
              appearance="primary"
              disabled={busy || !ids.size}
              onClick={() => void run(scan)}
            >
              预览资料
            </Button>
          </div>
        </>
      )}
      {(busy || status) && <p role="status">{busy ? '正在处理…' : status}</p>}
    </section>
  )
}
