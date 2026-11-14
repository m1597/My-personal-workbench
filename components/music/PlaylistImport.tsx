import { useRef, useState, type DragEvent } from 'react'
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Input,
  Option,
} from '@fluentui/react-components'
import { FileInput } from 'lucide-react'
import type { LocalTrack } from './LibraryPane'
import './playlist-import.css'

type Entry = { entry: string; id: string | null; group: string | null }
type Candidate = { id: string; title: string; artist: string; file: string }
export type ImportPreview = {
  name: string
  entries: Entry[]
  candidates: Record<string, string[]>
  choices: Record<string, Candidate>
}

export function usePlaylistImport(active: boolean) {
  const [preview, setPreview] = useState<ImportPreview>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const reading = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  async function load(files: FileList | null) {
    if (!files?.length || reading.current) return
    setError('')
    if (files.length !== 1 || !/\.m3u8?$/i.test(files[0].name)) {
      setError('请一次选择一个 M3U 或 M3U8 文件')
      return
    }
    reading.current = true
    setLoading(true)
    try {
      setPreview(await window.music.previewPlaylist(files[0]))
    } catch (e) {
      setError(String(e).split('Error: ').pop() || '无法读取歌单')
    } finally {
      reading.current = false
      setLoading(false)
    }
  }
  const isFile = (event: DragEvent) => active && event.dataTransfer.types.includes('Files')
  return {
    preview,
    close: () => setPreview(undefined),
    drop: {
      onDragOverCapture(event: DragEvent) {
        if (!isFile(event)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      },
      onDropCapture(event: DragEvent) {
        if (!isFile(event)) return
        event.preventDefault()
        event.stopPropagation()
        void load(event.dataTransfer.files)
      },
    },
    trigger: (
      <>
        <Button
          appearance="subtle"
          size="small"
          icon={<FileInput size={16} />}
          disabled={loading}
          title="选择或拖入 M3U / M3U8 歌单"
          onClick={() => input.current?.click()}
        >
          {loading ? '读取中…' : '导入歌单'}
        </Button>
        <input
          ref={input}
          type="file"
          accept=".m3u,.m3u8"
          hidden
          onChange={(e) => {
            void load(e.target.files)
            e.target.value = ''
          }}
        />
        {error && <small role="alert">{error}</small>}
      </>
    ),
  }
}

export function PlaylistImportDialog({
  preview,
  tracks,
  create,
  close,
  error,
}: {
  preview: ImportPreview
  tracks: LocalTrack[]
  create: (name: string, tracks: string[]) => Promise<boolean>
  close: () => void
  error: string
}) {
  const [name, setName] = useState(preview.name)
  const [picks, setPicks] = useState<Record<number, string>>({})
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const byId = new Map(tracks.map((t) => [t.id, t]))
  const ordered = new Set<string>()
  const issues: { row: Entry; index: number }[] = []
  const matched: string[] = [],
    duplicates: string[] = []
  preview.entries.forEach((row, index) => {
    if (!row.id) issues.push({ row, index })
    const id = row.id ?? picks[index]
    if (!id) return
    if (ordered.has(id)) duplicates.push(row.entry)
    else {
      ordered.add(id)
      matched.push(row.entry)
    }
  })
  return (
    <Dialog
      open
      onOpenChange={(_, d) => {
        if (!d.open && !saving.current) close()
      }}
    >
      <DialogSurface className="component-popup library-action-dialog">
        <DialogBody>
          <DialogTitle>导入歌单</DialogTitle>
          <DialogContent className="playlist-import-content">
            <Field label="歌单名称">
              <Input value={name} maxLength={80} onChange={(_, d) => setName(d.value)} />
            </Field>
            <p>
              按原顺序导入 {ordered.size} 首，跳过重复 {duplicates.length} 条。未选择的条目将跳过。
            </p>
            {!!matched.length && (
              <details>
                <summary>查看已匹配条目（{matched.length}）</summary>
                <pre>{matched.join('\n')}</pre>
              </details>
            )}
            {!!duplicates.length && (
              <details>
                <summary>查看重复条目（{duplicates.length}）</summary>
                <pre>{duplicates.join('\n')}</pre>
              </details>
            )}
            {issues.slice(page * 20, (page + 1) * 20).map(({ row, index }) => {
              const options = row.group ? preview.candidates[row.group] : []
              return (
                <div key={index} className="playlist-import-row">
                  <span>
                    {index + 1}. {row.entry}
                  </span>
                  {row.group ? (
                    <Dropdown
                      inlinePopup
                      aria-label={'选择第 ' + (index + 1) + ' 条的曲目'}
                      listbox={{ className: 'component-popup' }}
                      value={preview.choices[picks[index]]?.file || '匹配不唯一，选择曲目或跳过'}
                      selectedOptions={[picks[index] || '']}
                      onOptionSelect={(_, d) =>
                        setPicks((prev) => ({ ...prev, [index]: d.optionValue || '' }))
                      }
                    >
                      <Option value="">跳过</Option>
                      {options.map((id) => {
                        const t = preview.choices[id]
                        return (
                          <Option key={id} value={id} text={t.file}>
                            {t.title} · {t.artist} · {t.file}
                          </Option>
                        )
                      })}
                    </Dropdown>
                  ) : (
                    <MissingMatch
                      tracks={tracks}
                      selected={byId.get(picks[index])}
                      change={(id) => setPicks((prev) => ({ ...prev, [index]: id }))}
                    />
                  )}
                </div>
              )
            })}
            {issues.length > 20 && (
              <div className="settings-buttons">
                <Button size="small" disabled={!page} onClick={() => setPage(page - 1)}>
                  上一页
                </Button>
                <span>
                  {page + 1} / {Math.ceil(issues.length / 20)}
                </span>
                <Button
                  size="small"
                  disabled={(page + 1) * 20 >= issues.length}
                  onClick={() => setPage(page + 1)}
                >
                  下一页
                </Button>
              </div>
            )}
            {error && <p role="alert">{error}</p>}
          </DialogContent>
          <DialogActions>
            <Button disabled={busy} onClick={close}>
              取消
            </Button>
            <Button
              appearance="primary"
              disabled={busy || !name.trim() || !ordered.size}
              onClick={async () => {
                if (saving.current) return
                saving.current = true
                setBusy(true)
                try {
                  if (await create(name, [...ordered])) close()
                } finally {
                  saving.current = false
                  setBusy(false)
                }
              }}
            >
              创建歌单
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}

function MissingMatch({
  tracks,
  selected,
  change,
}: {
  tracks: LocalTrack[]
  selected?: LocalTrack
  change: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const term = query.trim().toLowerCase()
  const candidates = term
    ? tracks
        .filter(
          (t) =>
            t.listed &&
            t.available &&
            [t.title, t.artist, t.album].some((s) => s.toLowerCase().includes(term)),
        )
        .slice(0, 50)
    : []
  return (
    <div>
      {selected ? (
        <Button size="small" onClick={() => change('')}>
          {selected.title} · {selected.artist}（取消选择）
        </Button>
      ) : (
        <Input
          placeholder="未匹配，搜索曲库或跳过"
          aria-label="搜索替代曲目"
          value={query}
          onChange={(_, d) => setQuery(d.value)}
        />
      )}
      {!selected && term && (
        <div className="playlist-import-options">
          {candidates.length ? (
            candidates.map((t) => (
              <Button key={t.id} size="small" onClick={() => change(t.id)}>
                {[t.title, t.artist, t.album, t.folder?.name].filter(Boolean).join(' · ')}
              </Button>
            ))
          ) : (
            <small>未找到曲目</small>
          )}
        </div>
      )}
    </div>
  )
}
