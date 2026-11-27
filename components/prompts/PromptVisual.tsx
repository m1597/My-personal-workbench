import { MarkdownPreview } from './MarkdownPreview'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
export type VisualData = {
  kind: 'flow' | 'scene' | 'brief'
  nodes: { quote: string; group: string }[]
  edges: { from: number; to: number; quote: string }[]
}
type View = { html: string; stale: boolean; data?: VisualData; svg?: string }
type VisualState = {
  view?: View
  phase: 'reading' | 'generating' | 'ready' | 'cache-error' | 'error'
  error?: string
}

export function usePromptVisual(
  root: string | undefined,
  name: string,
  revision: string | undefined,
  version: number,
) {
  const [state, setState] = useState<VisualState>({ phase: 'reading' })
  const serial = useRef(0),
    pending = useRef(false)
  const request = useCallback(
    async (generate: boolean) => {
      if (!root || !revision || pending.current) return
      const id = ++serial.current
      pending.current = true
      setState((previous) => ({
        ...previous,
        phase: generate ? 'generating' : 'reading',
        error: undefined,
      }))
      try {
        const view = await window.promptLibrary.visual(root, name, generate)
        if (serial.current === id) setState({ phase: 'ready', view })
      } catch (e) {
        if (serial.current === id)
          setState((previous) => ({
            ...previous,
            phase: generate ? 'error' : 'cache-error',
            error: generate ? String(e).split('Error: ').pop() || '生成失败' : '无法读取可视化缓存',
          }))
      } finally {
        if (serial.current === id) pending.current = false
      }
    },
    [root, name, revision],
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: a completed automatic import can populate this revision's cache.
  useLayoutEffect(() => {
    pending.current = false
    setState({ phase: 'reading' })
    void request(false)
    return () => {
      serial.current++
    }
  }, [request, version])
  return { ...state, busy: state.phase === 'reading' || state.phase === 'generating', request }
}

export function PromptVisual({
  root,
  name,
  text,
  configure,
  original,
  visual,
  onGenerate,
}: {
  text: string
  root: string
  name: string
  original: boolean
  visual: ReturnType<typeof usePromptVisual>
  onGenerate: () => void
  configure: () => void
}) {
  const [zoom, setZoom] = useState(100),
    [quote, locate] = useState(''),
    [exportError, setExportError] = useState('')
  const { view, busy } = visual
  const error = visual.error || exportError
  const offset = quote ? text.indexOf(quote) : -1
  const canvas = useRef<HTMLFieldSetElement>(null)
  useEffect(() => {
    if (original || !view?.svg || !canvas.current) return
    // Only the local Archify compiler produces SVG; the model supplies validated text and indices.
    const svg = new DOMParser().parseFromString(view.svg, 'image/svg+xml').documentElement
    if (svg.localName !== 'svg') return
    canvas.current.replaceChildren(document.importNode(svg, true))
  }, [view?.svg, original])
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
        <button type="button" disabled={busy} onClick={onGenerate}>
          {visual.phase === 'reading'
            ? '正在读取…'
            : visual.phase === 'generating'
              ? '正在生成…'
              : visual.phase === 'cache-error'
                ? '重试读取缓存'
                : visual.phase === 'error'
                  ? '重试生成'
                  : view?.stale
                    ? '更新可视化'
                    : '生成可视化'}
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
                setExportError('导出失败，请检查保存位置')
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
