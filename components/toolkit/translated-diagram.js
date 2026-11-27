import { el } from './ui-dom.js'
const ns = 'http://www.w3.org/2000/svg'
function svg(tag, attrs) {
  const node = document.createElementNS(ns, tag)
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value))
  return node
}
function background(ctx, word, width, height) {
  const x = Math.max(0, Math.floor(word.x) - 1),
    y = Math.max(0, Math.floor(word.y) - 1)
  const w = Math.min(width - x, Math.ceil(word.w) + 2),
    h = Math.min(height - y, Math.ceil(word.h) + 2)
  const data = ctx.getImageData(x, y, w, h).data,
    counts = new Map()
  let best = 0,
    color = 0xffffff
  for (let i = 0; i < data.length; i += 4) {
    const rgb = data[i] * 65536 + data[i + 1] * 256 + data[i + 2],
      count = 1 + (counts.get(rgb) || 0)
    counts.set(rgb, count)
    if (count > best) {
      best = count
      color = rgb
    }
  }
  return '#' + color.toString(16).padStart(6, '0')
}
// OCR can miss an edge glyph where a connector meets a label. Extend the
// mask only over isolated, text-sized ink components on the same baseline.
function edgeInk(ctx, word, fill, side) {
  const height = word.h
  if (height < 4 || height > 80) return ''
  const edge = side < 0 ? Math.floor(word.x) : Math.ceil(word.x + word.w)
  const reach = Math.ceil(height * 2)
  const x = Math.max(0, side < 0 ? edge - reach : edge)
  const right = Math.min(ctx.canvas.width, side < 0 ? edge : edge + reach)
  const y = Math.max(0, Math.floor(word.y))
  const bottom = Math.min(ctx.canvas.height, Math.ceil(word.y + height) + 1)
  const w = right - x,
    h = bottom - y
  if (w < 2 || h < 3) return ''
  const data = ctx.getImageData(x, y, w, h).data
  const bg = [1, 3, 5].map((i) => parseInt(fill.slice(i, i + 2), 16))
  const ink = new Uint8Array(w * h)
  for (let k = 0; k < ink.length; k++) {
    const delta = bg.map((v, c) => v - data[k * 4 + c])
    if (Math.max(...delta) - Math.min(...delta) < 32 && Math.abs(delta[0]) > 16) ink[k] = 1
  }
  const glyphs = []
  for (let k = 0; k < ink.length; k++) {
    if (!ink[k]) continue
    const pixels = [k]
    ink[k] = 0
    let left = w,
      top = h,
      lastX = 0,
      lastY = 0
    for (let i = 0; i < pixels.length; i++) {
      const q = pixels[i],
        px = q % w,
        py = Math.floor(q / w)
      left = Math.min(left, px)
      lastX = Math.max(lastX, px)
      top = Math.min(top, py)
      lastY = Math.max(lastY, py)
      for (const n of [px > 0 ? q - 1 : -1, px + 1 < w ? q + 1 : -1, q - w, q + w]) {
        if (ink[n]) {
          ink[n] = 0
          pixels.push(n)
        }
      }
    }
    if (
      (top === 0 && lastY === h - 1) ||
      ((top === 0 || lastY === h - 1) && lastX - left < height * 0.28) ||
      lastY - top < height * 0.42 ||
      lastX - left > height * 1.25
    )
      continue
    glyphs.push({ left: x + left, right: x + lastX + 1, pixels })
  }
  glyphs.sort((a, b) => (side < 0 ? b.right - a.right : a.left - b.left))
  let cursor = edge,
    path = ''
  for (const glyph of glyphs) {
    const gap = side < 0 ? cursor - glyph.right : glyph.left - cursor
    if (gap > height * 0.53) break
    for (const q of glyph.pixels)
      if (Math.floor(q / w) > 0)
        path += 'M' + (x + (q % w)) + ' ' + (y + Math.floor(q / w)) + 'h1v1h-1z'
    cursor = side < 0 ? glyph.left : glyph.right
  }
  return path
}
function label(group, text, x, y, w, h, ink, measure) {
  const chars = Array.from(text)
  let size = Math.min(32, h * 0.92),
    lines
  for (;;) {
    measure.font = size + 'px "Microsoft YaHei UI", sans-serif'
    lines = ['']
    let lineWidth = 0
    for (const char of chars) {
      const advance = measure.measureText(char).width
      const last = lines.length - 1
      if (lines[last] && lineWidth + advance > w) {
        lines.push(char)
        lineWidth = advance
      } else {
        lines[last] += char
        lineWidth += advance
      }
    }
    if (lines.length * size <= h || size <= 1) break
    size *= 0.8
  }
  const step = h / lines.length
  lines.forEach((str, i) => {
    const node = svg('text', {
      x: x + w / 2,
      y: y + step * (i + 0.5),
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-size': Math.min(size, step * 0.92),
      fill: ink,
    })
    node.textContent = str
    group.append(node)
  })
}
export async function layoutTranslation(source, blocks) {
  const img = new Image()
  img.src = source
  await img.decode()
  const w = img.naturalWidth,
    h = img.naturalHeight,
    canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const angle = blocks[0].angle || 0
  ctx.translate(w / 2, h / 2)
  ctx.rotate((-angle * Math.PI) / 180)
  ctx.translate(-w / 2, -h / 2)
  ctx.drawImage(img, 0, 0)
  const container = el('section', '', 'translated-diagram'),
    toolbar = el('div', '', 'row'),
    port = el('div', '', 'diagram-scroll'),
    details = el('output', '', 'block-detail')
  const drawing = svg('svg', { viewBox: '0 0 ' + w + ' ' + h, 'aria-label': '选区翻译图' })
  const base = svg('image', { href: source, width: w, height: h })
  drawing.append(base)
  const compactBlocks = []
  function adjustLabels() {
    const scale = drawing.getBoundingClientRect().width / w
    if (!scale) return
    for (const { content, marker, size } of compactBlocks) {
      const compact = size * scale < 8
      content.style.display = compact ? 'none' : ''
      marker.style.display = compact ? '' : 'none'
    }
  }
  const layers = {}
  const buttons = {}
  function mode(name) {
    for (const [key, g] of Object.entries(layers)) g.style.display = key === name ? '' : 'none'
    for (const [key, b] of Object.entries(buttons))
      b.setAttribute('aria-pressed', String(key === name))
    details.textContent = ''
  }
  for (const name of ['原图', '仅中文', '双语']) {
    const b = el('button', name)
    buttons[name] = b
    b.onclick = () => mode(name)
    toolbar.append(b)
  }
  const zoom = el('input')
  zoom.type = 'range'
  zoom.min = '1'
  zoom.max = '8'
  zoom.step = '.25'
  zoom.value = '1'
  zoom.setAttribute('aria-label', '图像缩放')
  zoom.oninput = () => {
    drawing.style.width = Number(zoom.value) * 100 + '%'
  }
  toolbar.append(zoom)
  for (const name of ['仅中文', '双语']) {
    const layer = svg('g', {
      'data-mode': name,
      transform: 'rotate(' + angle + ' ' + w / 2 + ' ' + h / 2 + ')',
    })
    layers[name] = layer
    drawing.append(layer)
    for (const block of blocks) {
      const box = svg('g', {
        tabindex: 0,
        role: 'button',
        'aria-label': block.text + '：' + block.zh,
      })
      const show = () => {
        details.textContent = block.text + '\n' + block.zh
      }
      box.onclick = show
      box.onfocus = show
      box.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          show()
        }
      }
      const title = svg('title', {})
      title.textContent = block.text + ' → ' + block.zh
      box.append(title)
      const x = Math.min(...block.words.map((r) => r.x)),
        y = Math.min(...block.words.map((r) => r.y))
      const width = Math.max(...block.words.map((r) => r.x + r.w)) - x,
        height = Math.max(...block.words.map((r) => r.y + r.h)) - y
      const content = svg('g', {})
      box.append(content)
      let fill
      for (const word of block.words) {
        fill = background(ctx, word, w, h)
        content.append(
          svg('rect', {
            x: word.x - 0.5,
            y: word.y - 0.5,
            width: word.w + 1,
            height: word.h + 1,
            fill,
          }),
        )
      }
      for (const [word, side] of [
        [block.words[0], -1],
        [block.words.at(-1), 1],
      ]) {
        const color = background(ctx, word, w, h)
        const d = edgeInk(ctx, word, color, side)
        if (d) content.append(svg('path', { d, fill: color, 'data-edge-ink': '' }))
      }
      const rgb = parseInt(fill.slice(1), 16),
        light = 0.299 * (rgb >> 16) + 0.587 * ((rgb >> 8) & 255) + 0.114 * (rgb & 255)
      const ink = light > 128 ? '#17212a' : '#ffffff'
      if (name === '双语') {
        label(content, block.text, x, y, width, height * 0.46, ink, ctx)
        label(content, block.zh, x, y + height * 0.46, width, height * 0.54, ink, ctx)
        const marker = svg('rect', {
          x,
          y,
          width,
          height,
          rx: 1,
          fill: 'transparent',
          'data-compact-label': '',
          stroke: ink,
          'stroke-width': 1,
          'stroke-dasharray': '2 2',
        })
        box.append(marker)
        compactBlocks.push({
          content,
          marker,
          size: Math.min(
            ...Array.from(content.querySelectorAll('text'), (n) =>
              Number(n.getAttribute('font-size')),
            ),
          ),
        })
      } else label(content, block.zh, x, y, width, height, ink, ctx)
      layer.append(box)
    }
  }
  mode('仅中文')
  port.append(drawing)
  container.append(toolbar, port, details)
  // Re-evaluate at the actual pane width and whenever the user zooms.
  const observer = new ResizeObserver(adjustLabels)
  observer.observe(drawing)
  return container
}
