import { useEffect, useRef, useState } from 'react'

export type Entry = {
  root: string
  name: string
  label: string
  type: 'dir' | 'image' | 'text' | 'file'
  snippet?: string
}
export type Listing = { rows: Entry[]; tree: Entry[]; unavailable: string[]; truncated: boolean }
type Props = {
  root: string
  favorites: string[]
  defaultRoot: string
  tick: number
  current?: Entry
  dirty: boolean
  select: (item?: Entry) => void
  allow: () => boolean
  refresh: () => void
  issue: (s: string) => void
  enlarge: () => void
}
const id = (entry?: Entry) => entry && JSON.stringify([entry.root, entry.name])
export function DiskImage({
  file,
  tick,
  thumbnail = false,
}: {
  file: Entry
  tick: number
  thumbnail?: boolean
}) {
  const [url, setUrl] = useState(''),
    [error, fail] = useState('')
  const element = useRef<HTMLSpanElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: disk events invalidate image content even for the same filename.
  useEffect(() => {
    let live = true
    setUrl('')
    fail('')
    function load() {
      void window.promptLibrary
        .image(file.root, file.name, thumbnail)
        .then((src) => {
          if (live) setUrl(src)
        })
        .catch(() => {
          if (live) fail('图片暂不可用')
        })
    }
    const observer = new IntersectionObserver((items) => {
      if (items.some((i) => i.isIntersecting)) {
        observer.disconnect()
        load()
      }
    })
    if (element.current) observer.observe(element.current)
    return () => {
      live = false
      observer.disconnect()
    }
  }, [file.root, file.name, tick, thumbnail])
  return (
    <span className={thumbnail ? 'file-thumb' : 'file-image'} ref={element}>
      {url ? <img src={url} alt={file.label} /> : error}
    </span>
  )
}
export function FileBrowser({
  root,
  favorites,
  defaultRoot,
  tick,
  current,
  dirty,
  select,
  allow,
  refresh,
  issue,
  enlarge,
}: Props) {
  const [dir, go] = useState(''),
    [query, search] = useState(''),
    [all, setAll] = useState(false),
    [locations, toggle] = useState(false)
  const [data, setData] = useState<Listing>({
    tree: [],
    rows: [],
    unavailable: [],
    truncated: false,
  })
  const [marked, mark] = useState<string[]>([])
  const anchor = useRef('')
  const selected = data.rows.filter((row) => row.type !== 'dir' && marked.includes(id(row) || ''))
  function isSelected(row: Entry) {
    return marked.length ? marked.includes(id(row) || '') : id(current) === id(row)
  }
  async function send(tool: 'rename' | 'resize') {
    try {
      await window.promptLibrary.batch(
        tool,
        selected.map(({ root, name }) => ({ root, name })),
      )
    } catch (e) {
      issue(String(e).replace(/^.*Error: /, ''))
    }
  }
  const viewKey = JSON.stringify(['file-library-view', root, dir])
  const [view, setView] = useState('list')
  useEffect(() => {
    setView(localStorage.getItem(viewKey) || 'list')
  }, [viewKey])
  const identity = useRef({ key: id(current), value: '' })
  // biome-ignore lint/correctness/useExhaustiveDependencies: an atomic replacement changes the file identity at the same path.
  useEffect(() => {
    let live = true
    const key = id(current)
    if (identity.current.key !== key) identity.current = { key, value: '' }
    if (current)
      void window.promptLibrary
        .identity(current.root, current.name)
        .then((value) => {
          if (live) identity.current = { key, value }
        })
        .catch(() => {})
    return () => {
      live = false
    }
  }, [current, tick])
  const state = useRef({ data, current, dirty, select, issue, refresh })
  state.current = { data, current, dirty, select, issue, refresh }
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh after a disk change while preserving the active search.
  useEffect(() => {
    let live = true
    if (!root) return
    const timer = setTimeout(
      () =>
        void window.promptLibrary
          .browse(root, dir, query, all)
          .then(async (next) => {
            if (!live) return
            const old = state.current
            setData(next)
            mark((previous) => previous.filter((key) => next.rows.some((row) => id(row) === key)))
            old.issue(
              next.unavailable.length
                ? '目录暂时不可用，恢复后会自动刷新 · ' + next.unavailable.join('、')
                : '',
            )
            const index = old.data.rows.findIndex((r) => id(r) === id(old.current))
            if (
              old.current &&
              !next.unavailable.some((folder) => {
                const full = [old.current?.root, old.current?.name]
                  .join('/')
                  .replaceAll('\\', '/')
                  .toLowerCase()
                return full.startsWith(
                  folder.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase() + '/',
                )
              }) &&
              !old.dirty &&
              !next.rows.some((r) => id(r) === id(old.current))
            ) {
              const moved = await window.promptLibrary.locate(
                old.current.root,
                old.current.name,
                identity.current.value,
              )
              if (!live || id(state.current.current) !== id(old.current) || state.current.dirty)
                return
              if (moved) {
                if (id(moved) !== id(old.current)) old.select(moved)
                return
              }
              const files = next.rows.filter((r) => r.type !== 'dir')
              const oldIndex = old.data.rows
                .slice(0, Math.max(0, index))
                .filter((r) => r.type !== 'dir').length
              old.select(files[Math.min(oldIndex, files.length - 1)])
            }
          })
          .catch(() => {
            if (live) state.current.issue('目录不可用，请重新选择位置')
          }),
      query ? 100 : 0,
    )
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [root, dir, query, all, tick])
  function navigate(to: string) {
    if (allow()) {
      select()
      go(to)
      search('')
      toggle(false)
    }
  }
  async function activate(folder: string, to = '') {
    if (!allow()) return
    try {
      await window.promptLibrary.activate(folder)
      select()
      go(to)
      search('')
      toggle(false)
      refresh()
    } catch {
      issue('位置暂不可用')
    }
  }
  const nodes = [...data.tree].sort((a, b) =>
    a.name.localeCompare(b.name, 'zh-CN', { numeric: true }),
  )
  return (
    <>
      <button
        className="location-toggle"
        type="button"
        aria-expanded={locations}
        onClick={() => toggle(!locations)}
      >
        位置与目录
      </button>
      <nav className={locations ? 'locations expanded' : 'locations'} aria-label="位置与目录">
        <h2>常用位置</h2>
        {favorites.map((f) => (
          <div key={f} className="favorite">
            <button
              type="button"
              title={f}
              aria-label={'常用位置 ' + f}
              onClick={() => void activate(f)}
            >
              <strong>{f.split(/[\\/]/).filter(Boolean).pop() || f}</strong>
              <small>{f}</small>
            </button>
            {f !== defaultRoot && (
              <button
                aria-label={'移除 ' + f}
                type="button"
                onClick={() =>
                  void window.promptLibrary
                    .favorite(f, false)
                    .then(refresh)
                    .catch(() => issue('无法保存位置'))
                }
              >
                移除
              </button>
            )}
          </div>
        ))}
        {root && !favorites.includes(root) && (
          <button
            type="button"
            onClick={() =>
              void window.promptLibrary
                .favorite(root, true)
                .then(refresh)
                .catch(() => issue('无法保存位置'))
            }
          >
            添加当前常用位置
          </button>
        )}
        <h2>目录树</h2>
        {root && (
          <button type="button" title={root} onClick={() => navigate('')}>
            {root.split(/[\\/]/).filter(Boolean).pop() || root}
          </button>
        )}
        {nodes.map((r) => (
          <button
            type="button"
            key={r.name}
            title={r.name}
            className={r.name === dir ? 'selected' : ''}
            style={{ paddingInlineStart: Math.min(7, r.name.split(/[\\/]/).length) * 12 }}
            onClick={() => navigate(r.name)}
          >
            {r.label}
          </button>
        ))}
      </nav>
      <section className="file-results" aria-label="文件列表">
        <div className="tools">
          <input
            aria-label="搜索文件"
            type="search"
            placeholder="搜索文件名或提示词正文"
            maxLength={400}
            value={query}
            onChange={(e) => search(e.target.value)}
          />
          <select
            aria-label="搜索范围"
            value={all ? 'all' : 'current'}
            onChange={(e) => setAll(e.target.value === 'all')}
          >
            <option value="current">当前目录</option>
            <option value="all">所有常用位置</option>
          </select>
          <select
            aria-label="目录视图"
            value={view}
            onChange={(e) => {
              localStorage.setItem(viewKey, e.target.value)
              setView(e.target.value)
            }}
          >
            <option value="list">列表</option>
            <option value="grid">缩略图</option>
          </select>
        </div>
        {selected.length > 0 && (
          <div className="tools">
            <small>已选 {selected.length} 项</small>
            <button type="button" onClick={() => void send('rename')}>
              批量重命名
            </button>
            <button
              type="button"
              disabled={!selected.every((row) => row.type === 'image')}
              onClick={() => void send('resize')}
            >
              改尺寸
            </button>
            <button type="button" onClick={() => mark([])}>
              清除多选
            </button>
          </div>
        )}
        {dir && <small>{dir}</small>}
        <div className={'entries ' + view}>
          {data.rows.map((r) => (
            <button
              type="button"
              key={id(r)}
              title={r.root + ' / ' + r.name}
              aria-pressed={isSelected(r)}
              className={isSelected(r) ? 'selected' : ''}
              onClick={(event) => {
                const key = id(r) || ''
                if (r.type !== 'dir' && (event.ctrlKey || event.metaKey || event.shiftKey)) {
                  const prior = anchor.current || id(current) || key
                  const rows = data.rows
                    .filter((row) => row.type !== 'dir')
                    .map((row) => id(row) || '')
                  if (event.shiftKey) {
                    const a = Math.max(0, rows.indexOf(prior)),
                      b = rows.indexOf(key)
                    mark(rows.slice(Math.min(a, b), Math.max(a, b) + 1))
                  } else
                    mark((prev) => {
                      const base = prev.length ? prev : prior !== key ? [prior] : []
                      return base.includes(key) ? base.filter((k) => k !== key) : [...base, key]
                    })
                  anchor.current = key
                  return
                }
                mark([])
                anchor.current = key
                if (r.type === 'dir') {
                  if (r.root === root) navigate(r.name)
                  else void activate(r.root, r.name)
                } else if (id(current) !== id(r) && allow()) select(r)
              }}
              onKeyDown={(e) => {
                if (e.code === 'Space' && (r.type === 'image' || r.type === 'text')) {
                  e.preventDefault()
                  if (e.repeat) return
                  if (id(current) === id(r) || allow()) {
                    if (id(current) !== id(r)) select(r)
                    enlarge()
                  }
                }
              }}
            >
              {view === 'grid' && r.type === 'image' && (
                <DiskImage file={r} tick={tick} thumbnail />
              )}
              <span>
                {r.type === 'dir' ? '▸ ' : ''}
                {r.label}
              </span>
              {query && (
                <small>
                  {r.snippet || r.name}
                  {all ? ' · ' + r.root : ''}
                </small>
              )}
            </button>
          ))}
        </div>
        {!data.rows.length && root && !data.unavailable.length && (
          <small>{query ? '未找到匹配文件' : '目录中没有文件'}</small>
        )}
        {data.truncated && <small>已显示 500 个结果，可缩小搜索范围。</small>}
      </section>
    </>
  )
}
