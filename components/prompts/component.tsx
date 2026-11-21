import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ComponentTheme } from '../../src/renderer/src/app/ComponentTheme'
import './style.css'
import { PromptConnectionSettings, ActionConnection } from './PromptConnections'
import { MarkdownPreview } from './MarkdownPreview'

type Doc = { text: string; revision: string }
type Hit = { name: string; folder: string; snippet: string }
type State = { root: string; defaultRoot: string; shortcut: string; registrationError: string }
declare global {
  interface Window {
    promptLibrary: {
      state(): Promise<State>
      choose(remember: boolean): Promise<void>
      default(): Promise<void>
      shortcut(value: string): Promise<void>
      files(): Promise<string[]>
      read(root: string, name: string): Promise<Doc>
      save(root: string, name: string, revision: string, text: string): Promise<Doc>
      pin(root: string, name: string, label: string, input: 'text' | 'image'): Promise<void>
      search(query: string): Promise<Hit[]>
      use(folder: string, name: string, insert: boolean): Promise<string>
      dismiss(): Promise<void>
      onChange(fn: () => void): () => void
      onFocus(fn: () => void): () => void
    }
  }
}
const api = window.promptLibrary
const message = (e: unknown) => String(e).replace(/^.*Error: /, '')
function Palette() {
  const [q, setQ] = useState(''),
    [hits, setHits] = useState<Hit[]>([]),
    [index, select] = useState(0),
    [notice, say] = useState(''),
    [cycle, refresh] = useState(0)
  const field = useRef<HTMLInputElement>(null)
  useEffect(
    () =>
      api.onFocus(() => {
        setQ('')
        setHits([])
        say('')
        refresh((v) => v + 1)
        field.current?.focus()
      }),
    [],
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: reopening the palette refreshes unchanged queries.
  useEffect(() => {
    let live = true
    const timer = setTimeout(
      () =>
        void api
          .search(q)
          .then((rows) => {
            if (live) {
              setHits(rows)
              select(0)
            }
          })
          .catch((e) => {
            if (live) say(message(e))
          }),
      80,
    )
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [q, cycle])
  async function use(hit: Hit | undefined, insert: boolean) {
    if (hit)
      try {
        say(await api.use(hit.folder, hit.name, insert))
      } catch (e) {
        say(message(e))
      }
  }
  return (
    <main className="palette">
      <label>
        搜索提示词
        <input
          ref={field}
          value={q}
          placeholder="文件名或正文"
          onChange={(e) => {
            setHits([])
            setQ(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter') {
              e.preventDefault()
              void use(hits[index], true)
            }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              select((i) =>
                Math.max(0, Math.min(hits.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))),
              )
            }
            if (e.key === 'Escape') void api.dismiss()
          }}
        />
      </label>
      <section className="hits">
        {hits.map((h, i) => (
          <button
            type="button"
            className={i === index ? 'selected' : ''}
            key={h.name}
            onFocus={() => select(i)}
            onClick={() => void use(h, true)}
          >
            <strong>{h.name}</strong>
            <span>{h.snippet}</span>
          </button>
        ))}
      </section>
      <footer>
        <button type="button" disabled={!hits[index]} onClick={() => void use(hits[index], false)}>
          复制
        </button>
        <small role="status">
          {notice || (hits.length ? '↑ ↓ 选择 · Enter 插入' : '未找到提示词')}
        </small>
      </footer>
    </main>
  )
}
function FileTree({
  names,
  current,
  open,
}: {
  names: string[]
  current: string
  open: (name: string) => void
}) {
  function branch(items: string[], prefix: string): React.ReactNode {
    const groups = new Map<string, string[]>(),
      leaves: string[] = []
    for (const name of items) {
      const rest = name.slice(prefix.length)
      const cut = rest.search(/[\\/]/)
      if (cut < 0) leaves.push(name)
      else {
        const key = prefix + rest.slice(0, cut + 1)
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)?.push(name)
      }
    }
    return (
      <>
        {Array.from(groups, ([key, children]) => (
          <details key={key} open>
            <summary>{key.slice(prefix.length, -1)}</summary>
            {branch(children, key)}
          </details>
        ))}
        {leaves.map((name) => (
          <button
            type="button"
            className={name === current ? 'selected' : ''}
            key={name}
            onClick={() => open(name)}
          >
            {name.slice(prefix.length)}
          </button>
        ))}
      </>
    )
  }
  return <nav aria-label="目录树">{branch(names, '')}</nav>
}
function Library() {
  const [state, setState] = useState<State>(),
    [names, setNames] = useState<string[]>([]),
    [name, setName] = useState(''),
    [doc, setDoc] = useState<Doc>(),
    [draft, edit] = useState(''),
    [editMode, setEditMode] = useState(false),
    [conflict, setConflict] = useState(false),
    [directoryIssue, setDirectoryIssue] = useState(''),
    [fileIssue, setFileIssue] = useState(''),
    [notice, say] = useState(''),
    [hot, setHot] = useState(''),
    [label, setLabel] = useState(''),
    [kind, setKind] = useState<'text' | 'image'>('text'),
    [tick, refresh] = useState(0),
    [dock, setDock] = useState(false),
    [settings, setSettings] = useState(false),
    [pinOpen, setPinOpen] = useState(false)
  const draftKey = JSON.stringify(['draft', state?.root, name])
  function changeDraft(text: string) {
    edit(text)
    try {
      if (doc && text !== doc.text)
        localStorage.setItem(draftKey, JSON.stringify({ revision: doc.revision, text }))
      else localStorage.removeItem(draftKey)
    } catch {
      say('草稿暂存空间已满，请先保存或复制正文')
    }
  }
  const dirty = !!doc && draft !== doc.text
  const live = useRef({ name, doc, draft, root: state?.root })
  live.current = { name, doc, draft, root: state?.root }
  const update = () => refresh((n) => n + 1)
  const attempt = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch (e) {
      say(message(e))
    }
  }
  useEffect(() => api.onChange(() => refresh((n) => n + 1)), [])
  useEffect(() => {
    let request = 0
    const apply = (s: { mode: string; settingsRequest?: number; settingsTarget?: string }) => {
      setDock(s.mode === 'docked')
      if ((s.settingsRequest ?? 0) > request) {
        request = s.settingsRequest ?? 0
        if (!s.settingsTarget || s.settingsTarget === 'api') setSettings(true)
      }
    }
    const off = window.sampleHost.subscribe(apply)
    void window.sampleHost.hello({ protocol: '0.1' }).then(apply)
    return off
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: disk notifications explicitly invalidate the directory snapshot.
  useEffect(() => {
    let valid = true
    void attempt(async () => {
      const s = await api.state()
      if (!valid) return
      setState(s)
      setHot((previous) => previous || s.shortcut)
      try {
        const list = await api.files()
        if (valid) {
          setNames(list)
          setDirectoryIssue('')
        }
      } catch {
        if (valid) {
          setNames([])
          setDirectoryIssue('目录暂时不可用，恢复后会自动刷新')
        }
      }
    })
    return () => {
      valid = false
    }
  }, [tick])
  // biome-ignore lint/correctness/useExhaustiveDependencies: reread the same file after an external change.
  useEffect(() => {
    if (!name || !state?.root) return
    let valid = true
    void api
      .read(state.root, name)
      .then((next) => {
        if (!valid) return
        setFileIssue('')
        const old = live.current
        if (old.doc && old.draft !== old.doc.text) {
          setConflict(old.doc.revision !== next.revision)
          return
        }
        const stored = localStorage.getItem(draftKey)
        if (stored && !old.doc) {
          const backup = JSON.parse(stored)
          if (typeof backup.text === 'string' && backup.text !== next.text) {
            setDoc({ ...next, revision: backup.revision })
            edit(backup.text)
            setEditMode(true)
            setConflict(backup.revision !== next.revision)
            say('已恢复上次未保存的草稿')
            return
          }
        }
        setDoc(next)
        edit(next.text)
        setConflict(false)
      })
      .catch((e) => {
        if (valid) {
          setConflict(true)
          setFileIssue(message(e))
        }
      })
    return () => {
      valid = false
    }
  }, [name, state?.root, tick, draftKey])
  function discard() {
    return !dirty || window.confirm('放弃此文件未保存的修改？')
  }
  function reset(next = '') {
    localStorage.removeItem(draftKey)
    setFileIssue('')
    setPinOpen(false)
    setName(next)
    setDoc(undefined)
    edit('')
    setEditMode(false)
    setConflict(false)
    say('')
    setLabel(
      next
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.(md|txt)$/i, '') || '',
    )
  }
  async function folder(mode: 'temp' | 'remember' | 'default') {
    if (!discard()) return
    const previous = state?.root
    await (mode === 'default' ? api.default() : api.choose(mode === 'remember'))
    if ((await api.state()).root !== previous) {
      reset()
      setNames([])
    }
    update()
  }
  if (settings)
    return (
      <main className="library prompt-settings">
        <header>
          <h1>API 与模型</h1>
          <button type="button" onClick={() => setSettings(false)}>
            返回仓库
          </button>
        </header>
        <PromptConnectionSettings />
      </main>
    )
  return (
    <main className="library">
      <header>
        <h1>提示词仓库</h1>
        <div className="tools">
          <button type="button" onClick={() => setSettings(true)}>
            API 与模型
          </button>
          <button
            type="button"
            onClick={() =>
              void attempt(async () => {
                const r = await window.sampleHost.transfer(dock ? 'detach' : 'attach')
                if (!r.ok) say(r.error || '工作台不可用')
              })
            }
          >
            {dock ? '独立打开' : '加入工作台'}
          </button>
        </div>
      </header>
      <div className="tools">
        <button type="button" onClick={() => void attempt(() => folder('temp'))}>
          打开文件夹
        </button>
        <button type="button" onClick={() => void attempt(() => folder('remember'))}>
          设置默认目录
        </button>
        <button
          type="button"
          disabled={!state?.defaultRoot}
          onClick={() => void attempt(() => folder('default'))}
        >
          返回默认目录
        </button>
      </div>
      <small title={state?.root}>{state?.root || '请选择提示词文件夹'}</small>
      <section className="split">
        <FileTree
          names={names}
          current={name}
          open={(next) => {
            if (next !== name && discard()) reset(next)
          }}
        />
        <article>
          {name && (
            <>
              <h2>{name}</h2>
              <div className="tools">
                <button type="button" onClick={() => setEditMode(!editMode)}>
                  {editMode ? '预览' : '编辑'}
                </button>
                <button
                  type="button"
                  disabled={!dirty || conflict}
                  onClick={() =>
                    void attempt(async () => {
                      if (!doc || !state) return
                      const saved = await api.save(state.root, name, doc.revision, draft)
                      if (live.current.root !== state.root || live.current.name !== name) return
                      if (live.current.draft === draft) localStorage.removeItem(draftKey)
                      else
                        localStorage.setItem(
                          draftKey,
                          JSON.stringify({ revision: saved.revision, text: live.current.draft }),
                        )
                      setDoc(saved)
                      say('已保存')
                    })
                  }
                >
                  保存
                </button>
              </div>
              {conflict && (
                <aside>
                  磁盘文件已变更或不可用。可复制草稿后重新加载。
                  <button
                    type="button"
                    onClick={() =>
                      void attempt(async () => {
                        if (!state || !discard()) return
                        const next = await api.read(state.root, name)
                        localStorage.removeItem(draftKey)
                        setDoc(next)
                        edit(next.text)
                        setConflict(false)
                        say('已重新加载')
                      })
                    }
                  >
                    重新加载
                  </button>
                </aside>
              )}
              {editMode ? (
                <textarea
                  aria-label="提示词正文"
                  value={draft}
                  onChange={(e) => changeDraft(e.target.value)}
                />
              ) : /\.md$/i.test(name) ? (
                <MarkdownPreview text={draft} />
              ) : (
                <pre>{draft}</pre>
              )}
              <details open={pinOpen} onToggle={(event) => setPinOpen(event.currentTarget.open)}>
                <summary>固定为工具集动作</summary>
                <label>
                  显示名
                  <input value={label} onChange={(e) => setLabel(e.target.value)} />
                </label>
                <label>
                  输入类型
                  <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                    <option value="text">文本</option>
                    <option value="image">图片</option>
                  </select>
                </label>
                {pinOpen && <ActionConnection kind={kind} />}
                <button
                  type="button"
                  disabled={!doc || dirty || conflict}
                  onClick={() =>
                    void attempt(async () => {
                      if (state) await api.pin(state.root, name, label, kind)
                      say('已固定，工具集下次执行时读取磁盘内容')
                    })
                  }
                >
                  固定动作
                </button>
              </details>
            </>
          )}
        </article>
      </section>
      <details>
        <summary>全局快捷键 · {state?.shortcut}</summary>
        <label>
          快捷键
          <input value={hot} onChange={(e) => setHot(e.target.value)} />
        </label>
        <button
          type="button"
          onClick={() =>
            void attempt(async () => {
              await api.shortcut(hot)
              update()
              say('快捷键已保存')
            })
          }
        >
          应用快捷键
        </button>
      </details>
      <small role="status">
        {directoryIssue || fileIssue || notice || state?.registrationError}
      </small>
    </main>
  )
}
const palette = new URLSearchParams(location.search).has('palette')
const container = document.getElementById('root')
if (container)
  createRoot(container).render(
    <ComponentTheme surface={palette ? 'window' : 'embedded'}>
      {palette ? <Palette /> : <Library />}
    </ComponentTheme>,
  )
