import { createElement, useId, useMemo, type ReactNode } from 'react'

// Only local fragment links become interactive. Imported markup stays text.
function renderMarkdown(text: string, prefix: string) {
  const lines = text.split(/\r?\n/)
  const blocks: ReactNode[] = []
  const slugs = new Map<string, number>()
  const item = /^( *)([-+*]|\d+[.)])\s+(.+)$/
  const inline = (source: string) => {
    let offset = 0
    return source.split(/(\[[^\]\n]+\]\(#[^\s)]+\)|`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((part) => {
      const key = offset
      offset += part.length
      const link = /^\[([^\]]+)\]\(#([^\s)]+)\)$/.exec(part)
      if (link)
        return (
          <a
            key={key}
            href={'#' + prefix + link[2]}
            onClick={(e) => {
              e.preventDefault()
              const target = document.getElementById(prefix + link[2])
              target?.scrollIntoView({ block: 'start' })
              target?.focus({ preventScroll: true })
            }}
          >
            {link[1]}
          </a>
        )
      if (part.startsWith('`') && part.endsWith('`'))
        return <code key={key}>{part.slice(1, -1)}</code>
      if (part.startsWith('**') && part.endsWith('**'))
        return <strong key={key}>{part.slice(2, -2)}</strong>
      return part
    })
  }
  let i = 0
  function list(indent: number, ordered: boolean): ReactNode {
    const start = i,
      items: ReactNode[] = []
    while (i < lines.length) {
      const m = item.exec(lines[i])
      if (!m || m[1].length !== indent || /^\d/.test(m[2]) !== ordered) break
      const key = i++,
        children: ReactNode[] = []
      while (i < lines.length) {
        const next = item.exec(lines[i])
        if (!next || next[1].length <= indent) break
        children.push(list(next[1].length, /^\d/.test(next[2])))
      }
      items.push(
        <li key={key}>
          {inline(m[3])}
          {children}
        </li>,
      )
    }
    return createElement(ordered ? 'ol' : 'ul', { key: start }, items)
  }
  while (i < lines.length) {
    const start = i,
      line = lines[i]
    const match = item.exec(line)
    if (match) {
      blocks.push(list(match[1].length, /^\d/.test(match[2])))
      continue
    }
    i++
    if (!line.trim()) continue
    const fence = /^\s*(`{3,}|~{3,})/.exec(line)
    if (fence) {
      const code: string[] = []
      while (i < lines.length && !lines[i].trimStart().startsWith(fence[1])) code.push(lines[i++])
      if (i < lines.length) i++
      blocks.push(
        <pre key={start}>
          <code>{code.join('\n')}</code>
        </pre>,
      )
      continue
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) {
      const slug = heading[2]
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s_-]/gu, '')
        .trim()
        .replace(/\s+/g, '-')
      const count = slugs.get(slug) || 0
      slugs.set(slug, count + 1)
      blocks.push(
        createElement(
          'h' + Math.min(6, heading[1].length + 1),
          { key: start, id: prefix + slug + (count ? '-' + count : ''), tabIndex: -1 },
          inline(heading[2]),
        ),
      )
    } else blocks.push(<p key={start}>{inline(line)}</p>)
  }
  return blocks
}
export function MarkdownPreview({ text }: { text: string }) {
  const prefix = useId()
  const blocks = useMemo(() => renderMarkdown(text, prefix), [text, prefix])
  return <div className="markdown">{blocks}</div>
}
