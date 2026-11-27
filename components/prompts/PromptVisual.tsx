import { MarkdownPreview } from './MarkdownPreview'
import { useEffect, useRef, useState } from 'react'
export type VisualData = {
  kind: 'flow' | 'scene' | 'brief'
  nodes: { quote: string; group: string }[]
  edges: { from: number; to: number; quote: string }[]
}
type View = { html: string; stale: boolean; data?: VisualData; svg?: string }
export function PromptVisual({
  root,
  name,
  revision,
  text,
  configure,
  original,
  onAvailable,
}: {
  text: string
  root: string
  name: string
  revision: string
  original: boolean
  onAvailable: (available: boolean) => void
  configure: () => void
}) {
  const [zoom, setZoom] = useState(100),
    [quote, locate] = useState('')
  const offset = quote ? text.indexOf(quote) : -1
  const [view, setView] = useState<View>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new disk revision invalidates a cached rendering.
  useEffect(() => {
    let live = true
    window.promptLibrary
      .visual(root, name, false)
      .then((v) => {
        if (live) setView(v)
      })
      .catch(() => {
        if (live) setError('无法读取可视化缓存')
      })
    return () => {
      live = false
    }
  }, [root, name, revision])
  useEffect(() => {
    onAvailable(Boolean(view?.html))
  }, [view?.html, onAvailable])
  const canvas = useRef<HTMLFieldSetElement>(null)
  useEffect(() => {
    if (original || !view?.svg || !canvas.current) return
    // Only the local Archify compiler produces SVG; the model supplies validated text and indices.
    const svg = new DOMParser().parseFromString(view.svg, 'image/svg+xml').documentElement
    if (svg.localName !== 'svg') return
    canvas.current.replaceChildren(document.importNode(svg, true))
  }, [view?.svg, original])
  async function generate() {
    setBusy(true)
    setError('')
    try {
      setView(await window.promptLibrary.visual(root, name, true))
    } catch (e) {
      setError(String(e).split('Error: ').pop() || '生成失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label="提示词可视化">
      {error && (
        <p role="status">
          {error}
          {error.includes('配置 API') && (
            <button type="button" onClick={configure}>
              配置 API 与模型
            </button>
          )}
        </p>
      )}
      {view?.stale && <p>原文已修改，可视化待更新。</p>}
      {(!view?.html || view.stale) && (
        <button type="button" disabled={busy || !view} onClick={() => void generate()}>
          {busy ? '正在生成…' : view?.stale ? '更新可视化' : '生成可视化'}
        </button>
      )}
      {view?.stale && view.html && <small>上次生成的图</small>}
      {(original || !view?.html) &&
        (/\.md$/i.test(name) ? (
          <>
            <MarkdownPreview text={text} />
            <details>
              <summary>Markdown 源码</summary>
              <pre>{text}</pre>
            </details>
          </>
        ) : (
          <pre>{text}</pre>
        ))}
      {view?.html && !original ? (
        <>
          <label>
            缩放{' '}
            <input
              type="range"
              min={50}
              max={200}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
          </label>
          <div className="visual-reader">
            <div style={{ zoom: zoom / 100 }}>
              {view.svg && (
                <fieldset
                  ref={canvas}
                  onClick={(e) => {
                    const id = (e.target as Element)
                      .closest('[data-node-id]')
                      ?.getAttribute('data-node-id')
                    const node = id && view.data?.nodes[Number(id.slice(1))]
                    if (node) locate(node.quote)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter')
                      (e.target as HTMLElement).dispatchEvent(
                        new MouseEvent('click', { bubbles: true }),
                      )
                  }}
                  aria-label="流程图"
                />
              )}
              {view.data?.kind === 'flow'
                ? view.data.edges.map((edge) => (
                    <button
                      type="button"
                      key={JSON.stringify(edge)}
                      onClick={() => locate(edge.quote)}
                    >
                      {edge.from + 1} → {edge.to + 1} · {edge.quote}
                    </button>
                  ))
                : [...new Set(view.data?.nodes.map((n) => n.group))].map((group) => (
                    <section key={group}>
                      {view.data?.kind === 'scene' && <h3>{group}</h3>}
                      {view.data?.nodes
                        .filter((n) => n.group === group)
                        .map((n) => (
                          <button type="button" key={n.quote} onClick={() => locate(n.quote)}>
                            {n.quote}
                          </button>
                        ))}
                    </section>
                  ))}
            </div>
          </div>
          {view.stale && quote && (
            <blockquote>
              <mark>{quote}</mark>
            </blockquote>
          )}
          {!view.stale && offset >= 0 && (
            <blockquote>
              {text.slice(Math.max(0, offset - 40), offset)}
              <mark>{quote}</mark>
              {text.slice(offset + quote.length, offset + quote.length + 40)}
            </blockquote>
          )}
          <button
            type="button"
            disabled={view.stale}
            onClick={async () => {
              try {
                await window.promptLibrary.exportVisual(root, name)
              } catch {
                setError('导出失败，请检查保存位置')
              }
            }}
          >
            导出 HTML
          </button>
        </>
      ) : null}
    </section>
  )
}
