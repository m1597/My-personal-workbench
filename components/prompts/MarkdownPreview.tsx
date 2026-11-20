import { Fragment, type ReactNode } from 'react'

// Render common prompt formatting as React text nodes, including untrusted HTML verbatim.
export function MarkdownPreview({ text }: { text: string }) {
  const lines = text.split(/\r?\n/),
    blocks: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const start = i,
      line = lines[i++]
    if (!line.trim()) continue
    if (/^\s*```/.test(line)) {
      const code: string[] = []
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++])
      if (i < lines.length) i++
      blocks.push(
        <pre key={start}>
          <code>{code.join('\n')}</code>
        </pre>,
      )
    } else if (/^#{1,6}\s/.test(line))
      blocks.push(<h3 key={start}>{line.replace(/^#{1,6}\s+/, '')}</h3>)
    else if (/^[-*+]\s/.test(line)) {
      const items = [<li key={start}>{line.slice(2)}</li>]
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
        const key = i
        items.push(<li key={key}>{lines[i++].slice(2)}</li>)
      }
      blocks.push(<ul key={start}>{items}</ul>)
    } else
      blocks.push(
        <Fragment key={start}>
          {line}
          {'\n'}
        </Fragment>,
      )
  }
  return <div className="markdown">{blocks}</div>
}
