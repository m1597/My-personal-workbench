import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ComponentTheme } from '../../src/renderer/src/app/ComponentTheme'
import './style.css'
import { PromptConnectionSettings, ActionConnection } from './PromptConnections'
import { FileBrowser, DiskImage, type Entry, type Listing } from './FileBrowser'
import { MarkdownPreview } from './MarkdownPreview'

type Doc = { text: string; revision: string }
type Hit = { name: string; folder: string; snippet: string }
type State = {
  favorites: string[]
  paletteRoot: string
  root: string
  defaultRoot: string
  shortcut: string
  registrationError: string
}
declare global {
  interface Window {
    promptLibrary: {
      identity(root: string, name: string): Promise<string>
      locate(root: string, name: string, identity: string): Promise<Entry | null>
      browse(root: string, dir: string, query: string, all: boolean): Promise<Listing>
      image(root: string, name: string, thumbnail: boolean): Promise<string>
      companion(root: string, name: string): Promise<string>
      favorite(root: string, add: boolean): Promise<void>
      activate(root: string): Promise<void>
      choosePalette(): Promise<void>
      copy(text: string): Promise<void>
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
function Library() {
  const [state, setState] = useState<State>(),
    [entry, setEntry] = useState<Entry>(),
    [enlarged, enlarge] = useState(false),
    [companion, setCompanion] = useState(''),
    [locationVersion, setLocationVersion] = useState(0),
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
  const name = entry?.name || '',
    fileRoot = entry?.root
  const draftKey = JSON.stringify(['draft', fileRoot, name])
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
  const live = useRef({ name, doc, draft, root: fileRoot })
  live.current = { name, doc, draft, root: fileRoot }
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
    })
    return () => {
      valid = false
    }
  }, [tick])
  // biome-ignore lint/correctness/useExhaustiveDependencies: reread the same file after an external change.
  useEffect(() => {
    if (!name || !fileRoot || entry?.type !== 'text') return
    let valid = true
    void api
      .read(fileRoot, name)
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
  }, [name, fileRoot, entry?.type, tick, draftKey])
  useEffect(() => {
    const focus = () => refresh((v) => v + 1)
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: external changes invalidate the companion lookup.
  useEffect(() => {
    let valid = true
    setCompanion('')
    if (entry?.type === 'image')
      void api
        .companion(entry.root, entry.name)
        .then((path) => {
          if (valid) setCompanion(path)
        })
        .catch(() => {})
    return () => {
      valid = false
    }
  }, [entry, tick])
  const imageDialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (enlarged && imageDialog.current && !imageDialog.current.open)
      imageDialog.current.showModal()
  }, [enlarged])
  function discard() {
    return !dirty || window.confirm('放弃此文件未保存的修改？')
  }
  function reset(item?: Entry) {
    const next = item?.name || ''
    if (item?.type !== 'image') enlarge(false)
    localStorage.removeItem(draftKey)
    setFileIssue('')
    setPinOpen(false)
    setEntry(item)
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
      setLocationVersion((v) => v + 1)
    }
    update()
  }
  return (
    <>
      {settings && (
        <main className="library prompt-settings">
          <header>
            <h1>API 与模型</h1>
            <button type="button" onClick={() => setSettings(false)}>
              返回仓库
            </button>
          </header>
          <PromptConnectionSettings />
        </main>
      )}
      <main hidden={settings} className="library">
        <header>
          <h1>文件库</h1>
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
        <small title={state?.root}>{state?.root || '请选择文件夹'}</small>
        <section className="split">
          <FileBrowser
            key={locationVersion}
            root={state?.root || ''}
            favorites={state?.favorites || []}
            defaultRoot={state?.defaultRoot || ''}
            tick={tick}
            current={entry}
            dirty={dirty}
            select={reset}
            allow={discard}
            refresh={update}
            issue={setDirectoryIssue}
            enlarge={() => enlarge(true)}
          />
          <article className={entry ? 'file-preview active' : 'file-preview'}>
            {entry && entry.type !== 'text' && (
              <>
                <h2>{name}</h2>
                {entry.type === 'image' ? (
                  <>
                    <DiskImage file={entry} tick={tick} />
                    <button type="button" onClick={() => enlarge(true)}>
                      放大预览
                    </button>
                    {companion && (
                      <button
                        type="button"
                        onClick={() =>
                          reset({
                            root: entry.root,
                            name: companion,
                            label: companion.split(/[\\/]/).pop() || companion,
                            type: 'text',
                          })
                        }
                      >
                        打开同名 TXT
                      </button>
                    )}
                    {enlarged && (
                      <dialog
                        ref={imageDialog}
                        aria-label="图片预览"
                        onClose={() => enlarge(false)}
                        className="large-preview"
                      >
                        <button type="button" onClick={() => imageDialog.current?.close()}>
                          关闭预览
                        </button>
                        <DiskImage file={entry} tick={tick} />
                      </dialog>
                    )}
                  </>
                ) : (
                  <small>此格式可按文件名搜索，暂不支持预览。</small>
                )}
              </>
            )}
            {entry?.type === 'text' && fileRoot && (
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
                        const saved = await api.save(fileRoot, name, doc.revision, draft)
                        if (live.current.root !== fileRoot || live.current.name !== name) return
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
                  <button
                    type="button"
                    onClick={() =>
                      void attempt(async () => {
                        await api.copy(draft)
                        say('已复制')
                      })
                    }
                  >
                    复制正文
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
                          const next = await api.read(fileRoot, name)
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
                        if (state) await api.pin(fileRoot, name, label, kind)
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
          <div className="tools">
            <small>调用目录 · {state?.paletteRoot || state?.defaultRoot || '尚未设置'}</small>
            <button
              type="button"
              onClick={() =>
                void attempt(async () => {
                  await api.choosePalette()
                  update()
                })
              }
            >
              设置调用目录
            </button>
          </div>
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
    </>
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
