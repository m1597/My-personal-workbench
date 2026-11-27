import { Button, Input } from '@fluentui/react-components'
import { Search, ClipboardPaste } from 'lucide-react'
import { PromptVisual, type VisualData } from './PromptVisual'
import { ChoiceDropdown } from '../../src/renderer/src/app/SharedDropdown'
import { ShortcutRecorder } from '../../src/renderer/src/app/ShortcutRecorder'
import { BackButton } from '../music/BackButton'
import { SettingsGear, SettingsShell } from '../../src/renderer/src/app/ComponentSettings'
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ComponentTheme, configureBackdrop } from '../../src/renderer/src/app/ComponentTheme'
import './style.css'
import { PromptConnectionSettings, ActionConnection } from './PromptConnections'
import { DiskImage, type Entry, type Listing } from './FileBrowser'
import { MarkdownPreview } from './MarkdownPreview'

type Card = { name: string; title: string; category: string; skill: boolean; match: boolean }
type Doc = { text: string; revision: string }
type Hit = { name: string; folder: string; snippet: string }
type State = {
  favorites: string[]
  paletteRoot: string
  root: string
  defaultRoot: string
  autoVisual: boolean
  shortcutEnabled: boolean
  shortcut: string
  registrationError: string
}
declare global {
  interface Window {
    promptLibrary: {
      visual(
        root: string,
        name: string,
        generate: boolean,
      ): Promise<{ html: string; stale: boolean; svg?: string; data?: VisualData }>
      exportVisual(root: string, name: string): Promise<boolean>
      importText(root: string, name: string, text: string): Promise<string>
      autoVisual(value: boolean): Promise<void>
      identity(root: string, name: string): Promise<string>
      locate(root: string, name: string, identity: string): Promise<Entry | null>
      batch(tool: 'rename' | 'resize', items: { root: string; name: string }[]): Promise<void>
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
      shortcut(value: string, enabled?: boolean): Promise<State>
      organize(root: string, name: string): Promise<string>
      saveOrganized(root: string, text: string): Promise<string>
      catalogue(query: string): Promise<Card[]>
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
configureBackdrop()
const defaultShortcut = 'Control+Alt+Shift+P'
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
    [cards, setCards] = useState<Card[]>([]),
    [lastSelected, setLastSelected] = useState(''),
    [filter, setFilter] = useState(''),
    [purpose, setPurpose] = useState(''),
    [visualVersion, setVisualVersion] = useState(0),
    [organized, setOrganized] = useState(''),
    [importing, setImporting] = useState(false),
    [importName, setImportName] = useState('提示词.md'),
    [importBody, setImportBody] = useState(''),
    [raw, setRaw] = useState(false),
    [hasVisual, setHasVisual] = useState(false),
    [values, setValues] = useState<Record<string, string>>({}),
    [doc, setDoc] = useState<Doc>(),
    [draft, edit] = useState(''),
    [editMode, setEditMode] = useState(false),
    [conflict, setConflict] = useState(false),
    [directoryIssue, setDirectoryIssue] = useState(''),
    [fileIssue, setFileIssue] = useState(''),
    [notice, say] = useState(''),
    [label, setLabel] = useState(''),
    [kind, setKind] = useState<'text' | 'image'>('text'),
    [tick, refresh] = useState(0),
    [shortcutReset, setShortcutReset] = useState(0),
    [dock, setDock] = useState(false),
    [settings, setSettings] = useState(false),
    [category, setCategory] = useState('directory'),
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
  const [settingsSelection, refocusSettings] = useState(0)
  const settingsPage = useRef<HTMLElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: choosing the active category again also returns focus to its first control.
  useEffect(() => {
    const content = settingsPage.current?.querySelector('.fitbay-settings-content')
    if (!settings || !content) return
    function focusControl() {
      const selector =
        category === 'shortcut'
          ? 'input[type=checkbox]'
          : 'button:not(:disabled), input:not(:disabled), select:not(:disabled)'
      const control = content?.querySelector<HTMLElement>(selector)
      control?.focus()
      return !!control
    }
    if (focusControl()) return
    const observer = new MutationObserver(() => {
      if (focusControl()) observer.disconnect()
    })
    observer.observe(content, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [settings, category, settingsSelection])
  async function changeShortcut(key: string, enabled?: boolean) {
    try {
      await api.shortcut(key, enabled)
      setState(await api.state())
      say('快捷键已保存')
      return true
    } catch (e) {
      say(message(e))
      return false
    }
  }
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
        setCategory(
          s.settingsTarget === 'api' || s.settingsTarget === 'shortcut'
            ? s.settingsTarget
            : 'directory',
        )
        setSettings(true)
      }
    }
    let waiting = true
    const off = window.sampleHost.subscribe((state) => {
      waiting = false
      apply(state)
    })
    void window.sampleHost.hello({ protocol: '0.1' }).then((state) => {
      if (waiting) apply(state)
    })
    return () => {
      waiting = false
      off()
    }
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: disk notifications explicitly invalidate the directory snapshot.
  useEffect(() => {
    let valid = true
    void attempt(async () => {
      const s = await api.state()
      if (!valid) return
      setState(s)
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
  const selectionVersion = useRef(0)
  const currentRoot = state?.root
  // biome-ignore lint/correctness/useExhaustiveDependencies: disk and focus events invalidate the catalogue.
  useEffect(() => {
    let active = true
    const selection = selectionVersion.current
    if (currentRoot)
      void api
        .catalogue(filter)
        .then((rows) => {
          if (!active) return
          setDirectoryIssue('')
          setCards(rows)
          if (selection === selectionVersion.current)
            setEntry((old) => (old && !rows.some((c) => c.name === old.name) ? undefined : old))
        })
        .catch(() => {
          if (active) {
            setCards([])
            setDirectoryIssue('目录不可用')
          }
        })
    return () => {
      active = false
    }
  }, [currentRoot, tick, filter])
  const variablePattern = /\{\{([^{}\r\n]+)\}\}/g
  const variables = [...new Set(Array.from(draft.matchAll(variablePattern), (m) => m[1].trim()))]
  const result = draft.replace(variablePattern, (original, key: string) =>
    Object.hasOwn(values, key.trim()) && values[key.trim()] ? values[key.trim()] : original,
  )
  function discard() {
    return !dirty || window.confirm('放弃此文件未保存的修改？')
  }
  function reset(item?: Entry) {
    selectionVersion.current++
    setOrganized('')
    setHasVisual(false)
    setValues({})
    setRaw(false)
    const next = item?.name || ''
    if (item?.type !== 'image' && item?.type !== 'text') enlarge(false)
    localStorage.removeItem(draftKey)
    setFileIssue('')
    setPinOpen(false)
    if (item) setLastSelected(item.name)
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
  async function showVisual() {
    setRaw(false)
    if (!fileRoot || dirty) return
    const selection = selectionVersion.current
    try {
      await api.visual(fileRoot, name, true)
      if (
        selection === selectionVersion.current &&
        live.current.root === fileRoot &&
        live.current.name === name
      )
        setVisualVersion((v) => v + 1)
    } catch (e) {
      if (
        selection !== selectionVersion.current ||
        live.current.root !== fileRoot ||
        live.current.name !== name
      )
        return
      const error = message(e)
      say(error)
      if (error.includes('配置 API')) {
        setCategory('api')
        setSettings(true)
      }
    }
  }
  async function importOne(filename: string, body: string) {
    const root = state?.root
    if (!root) throw Error('请先选择提示词目录')
    if (!discard()) return
    const name = await api.importText(root, filename, body)
    update()
    reset({ root, name, label: name, type: 'text' })
    setImporting(false)
    setImportBody('')
    const selection = selectionVersion.current
    if (state.autoVisual) {
      try {
        await api.visual(root, name, true)
        if (selection !== selectionVersion.current) return
        update()
        setVisualVersion((v) => v + 1)
      } catch (e) {
        if (selection !== selectionVersion.current) return
        const warning = name + ' 已导入，可视化未生成 · ' + message(e)
        say(warning)
        return warning
      }
    }
  }
  async function folder(mode: 'temp' | 'remember' | 'default') {
    if ((mode !== 'remember' || !state?.root) && !discard()) return
    const previous = state?.root
    await (mode === 'default' ? api.default() : api.choose(mode === 'remember'))
    if ((await api.state()).root !== previous) {
      reset()
      setCards([])
    }
    update()
  }
  return (
    <ComponentTheme surface={dock ? 'embedded' : 'window'}>
      {settings && (
        <main ref={settingsPage} className="library prompt-settings">
          <SettingsShell
            title="提示词库设置"
            categories={[
              { id: 'directory', name: '目录' },
              { id: 'shortcut', name: '全局快捷键' },
              { id: 'api', name: 'API 与模型' },
            ]}
            active={category}
            onSelect={(id) => {
              setCategory(id)
              refocusSettings((value) => value + 1)
            }}
            onBack={() => setSettings(false)}
          >
            {category === 'directory' && (
              <>
                <label>
                  <input
                    type="checkbox"
                    checked={state?.autoVisual || false}
                    onChange={(e) =>
                      void attempt(async () => {
                        await api.autoVisual(e.target.checked)
                        update()
                      })
                    }
                  />
                  导入后自动生成可视化
                </label>
                <button
                  type="button"
                  onClick={() =>
                    void attempt(async () => {
                      const r = await window.sampleHost.transfer(dock ? 'detach' : 'attach')
                      if (!r.ok) throw Error(r.error || '工作台不可用')
                    })
                  }
                >
                  {dock ? '独立打开' : '加入工作台'}
                </button>
                <div className="tools">
                  <button
                    type="button"
                    onClick={() => void attempt(() => folder(state?.root ? 'temp' : 'remember'))}
                  >
                    选择提示词目录
                  </button>

                  <button
                    type="button"
                    disabled={!state?.defaultRoot}
                    onClick={() => void attempt(() => folder('default'))}
                  >
                    返回默认目录
                  </button>
                </div>
                <p>默认目录 · {state?.defaultRoot || '尚未设置'}</p>{' '}
                <button type="button" onClick={() => void attempt(() => folder('remember'))}>
                  设置默认目录
                </button>
              </>
            )}
            {category === 'shortcut' && (
              <>
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
                {state && (
                  <>
                    <label>
                      <input
                        type="checkbox"
                        checked={state.shortcutEnabled}
                        onChange={(e) => void changeShortcut(state.shortcut, e.target.checked)}
                      />
                      启用全局快捷键
                    </label>
                    <ShortcutRecorder
                      key={shortcutReset}
                      label="调用提示词"
                      saved={state.shortcut}
                      defaultValue={defaultShortcut}
                      change={(key) => changeShortcut(key.replace(/^Ctrl\+/, 'Control+'))}
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        if (await changeShortcut(defaultShortcut)) setShortcutReset((v) => v + 1)
                      }}
                    >
                      恢复组件全部快捷键
                    </button>
                  </>
                )}
              </>
            )}
            {category === 'api' && <PromptConnectionSettings />}
            {category !== 'api' && (
              <small role="status">{notice || state?.registrationError}</small>
            )}
          </SettingsShell>
        </main>
      )}
      <main
        hidden={settings}
        className="library"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const files = Array.from(e.dataTransfer.files)
          void attempt(async () => {
            const issues: string[] = []
            for (const f of files) {
              try {
                if (!/\.(md|txt)$/i.test(f.name) || f.size > 4 * 1024 * 1024)
                  throw Error('请选择 4 MiB 以内的 TXT 或 Markdown')
                const warning = await importOne(
                  f.name,
                  new TextDecoder('utf-8', { fatal: true }).decode(await f.arrayBuffer()),
                )
                if (warning) issues.push(warning)
              } catch (error) {
                issues.push(f.name + ' · ' + message(error))
              }
            }
            if (issues.length) say(issues.join('；'))
          })
        }}
      >
        <header>
          <h1>提示词库</h1>
          <div className="tools">
            <SettingsGear label="提示词库设置" onClick={() => setSettings(true)} />
          </div>
        </header>
        <div className="prompt-searchbar">
          <Input
            contentBefore={<Search size={16} aria-hidden="true" />}
            aria-label="搜索提示词"
            placeholder="搜索提示词"
            value={filter}
            onChange={(e) => {
              if (entry && window.matchMedia('(max-width:700px)').matches) {
                if (!discard()) return
                reset()
              }
              setFilter(e.target.value)
            }}
          />
          <Button
            appearance="subtle"
            icon={<ClipboardPaste size={16} />}
            disabled={!state?.root}
            onClick={() => setImporting(!importing)}
          >
            粘贴导入
          </Button>
          {!state?.root && (
            <button type="button" onClick={() => void attempt(() => folder('remember'))}>
              选择提示词目录
            </button>
          )}
        </div>
        {importing && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void attempt(() => importOne(importName, importBody))
            }}
          >
            <label>
              文件名
              <input value={importName} onChange={(e) => setImportName(e.target.value)} />
            </label>
            <textarea
              aria-label="粘贴原文"
              value={importBody}
              onChange={(e) => setImportBody(e.target.value)}
            />
            <button type="submit" disabled={!importBody.trim()}>
              导入
            </button>
          </form>
        )}
        {!entry && <small className="drop-hint">可拖入 TXT 或 Markdown 文件</small>}
        <section className={entry ? 'split prompt-split reading' : 'split prompt-split'}>
          <nav aria-label="提示词">
            <button type="button" onClick={() => setPurpose('')}>
              全部用途
            </button>
            {[...new Set(cards.map((c) => c.category))].map((c) => (
              <button
                type="button"
                key={c}
                aria-pressed={purpose === c}
                onClick={() => setPurpose(c)}
              >
                {c}
              </button>
            ))}
            <div className="entries list">
              {cards
                .filter((c) => (!purpose || purpose === c.category) && c.match)
                .map((c) => (
                  <button
                    type="button"
                    key={c.name}
                    aria-current={c.name === lastSelected || undefined}
                    onClick={() => {
                      if (state && discard())
                        reset({ root: state.root, name: c.name, label: c.title, type: 'text' })
                    }}
                  >
                    {c.title}
                    {c.skill ? ' · Skill' : ''}
                  </button>
                ))}
            </div>
          </nav>
          <article className={entry ? 'file-preview active' : 'file-preview'}>
            {enlarged && entry && (
              <dialog
                ref={imageDialog}
                aria-label={entry.type === 'image' ? '图片预览' : '文本预览'}
                onKeyDown={(e) => {
                  if (e.code === 'Space') {
                    e.preventDefault()
                    if (!e.repeat) imageDialog.current?.close()
                  }
                }}
                onClose={() => enlarge(false)}
                className="large-preview"
              >
                <button type="button" onClick={() => imageDialog.current?.close()}>
                  关闭预览
                </button>
                {entry.type === 'image' ? (
                  <DiskImage file={entry} tick={tick} />
                ) : !raw && /\.md$/i.test(name) ? (
                  <MarkdownPreview text={draft} />
                ) : (
                  <pre>{draft}</pre>
                )}
              </dialog>
            )}
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
                  </>
                ) : (
                  <small>此格式可按文件名搜索，暂不支持预览。</small>
                )}
              </>
            )}
            {entry?.type === 'text' && fileRoot && (
              <>
                <div className="reader-heading">
                  <BackButton
                    onClick={() => {
                      if (discard()) reset()
                    }}
                  />
                  <h2>{entry.label}</h2>
                </div>
                <div className="tools reader-tabs">
                  <Button
                    appearance="subtle"
                    type="button"
                    aria-pressed={!raw && hasVisual}
                    disabled={dirty}
                    onClick={() => void showVisual()}
                  >
                    可视化
                  </Button>
                  <Button
                    appearance="subtle"
                    type="button"
                    aria-pressed={raw || !hasVisual}
                    onClick={() => setRaw(true)}
                  >
                    原文
                  </Button>
                </div>
                <div className="reader-content" key={JSON.stringify([fileRoot, name])}>
                  {!editMode && doc && (
                    <PromptVisual
                      key={JSON.stringify([fileRoot, name, doc.revision, visualVersion])}
                      root={fileRoot}
                      name={name}
                      revision={doc.revision}
                      text={doc.text}
                      original={raw}
                      onAvailable={setHasVisual}
                      configure={() => {
                        setCategory('api')
                        setSettings(true)
                      }}
                    />
                  )}
                  {(raw || !hasVisual) && (
                    <details>
                      <summary>整理原文</summary>
                      <button
                        type="button"
                        onClick={() =>
                          void attempt(async () => {
                            if (!(await window.promptConnections.snapshot()).own?.configured) {
                              setCategory('api')
                              setSettings(true)
                              return
                            }
                            const text = await api.organize(fileRoot, name)
                            if (live.current.root === fileRoot && live.current.name === name)
                              setOrganized(text)
                          })
                        }
                      >
                        AI 整理
                      </button>
                      {organized && (
                        <section aria-label="整理预览">
                          <MarkdownPreview text={organized} />
                          <button
                            type="button"
                            onClick={() =>
                              void attempt(async () => {
                                const saved = await api.saveOrganized(fileRoot, organized)
                                setOrganized('')
                                say('已保存 ' + saved)
                              })
                            }
                          >
                            确认保存副本
                          </button>
                          <button type="button" onClick={() => setOrganized('')}>
                            取消整理
                          </button>
                        </section>
                      )}
                    </details>
                  )}
                  {variables.map((key) => (
                    <label key={key}>
                      {key}
                      <input
                        value={Object.hasOwn(values, key) ? values[key] : ''}
                        onChange={(e) => setValues({ ...values, [key]: e.target.value })}
                      />
                    </label>
                  ))}
                  <div className="tools">
                    <button
                      type="button"
                      disabled={/(^|[\\/])SKILL\.md$/i.test(name)}
                      onClick={() => setEditMode(!editMode)}
                    >
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
                              JSON.stringify({
                                revision: saved.revision,
                                text: live.current.draft,
                              }),
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
                          await api.copy(result)
                          say('已复制')
                        })
                      }
                    >
                      复制本次结果
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
                  ) : null}
                  <details
                    key={name}
                    className="reader-more"
                    onToggle={(e) => {
                      if (!e.currentTarget.open) setPinOpen(false)
                    }}
                  >
                    <summary title="更多操作">更多</summary>
                    <button
                      type="button"
                      aria-expanded={pinOpen}
                      onClick={() => setPinOpen(!pinOpen)}
                    >
                      固定为工具集动作
                    </button>
                    {pinOpen && (
                      <>
                        <label>
                          显示名
                          <input value={label} onChange={(e) => setLabel(e.target.value)} />
                        </label>
                        <label htmlFor="prompt-input">
                          输入类型
                          <ChoiceDropdown
                            id="prompt-input"
                            aria-label="输入类型"
                            value={kind}
                            choices={[
                              { value: 'text', label: '文本' },
                              { value: 'image', label: '图片' },
                            ]}
                            onChange={(v) => setKind(v as typeof kind)}
                          />
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
                      </>
                    )}
                  </details>
                </div>
              </>
            )}
          </article>
        </section>

        <small role="status">
          {directoryIssue || fileIssue || notice || state?.registrationError}
        </small>
      </main>
    </ComponentTheme>
  )
}
const palette = new URLSearchParams(location.search).has('palette')
const container = document.getElementById('root')
if (container)
  createRoot(container).render(
    palette ? (
      <ComponentTheme surface="window">
        <Palette />
      </ComponentTheme>
    ) : (
      <Library />
    ),
  )
