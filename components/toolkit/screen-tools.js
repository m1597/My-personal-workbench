import { api, root, picture, el, button } from './view.js'
import { makeCanvas } from './tools-view.js'
export { measureScreen, annotateRegion }
function measureScreen(s) {
  root.className = 'screen measuring'
  const surface = picture(s.image),
    line = document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
    seg = document.createElementNS(line.namespaceURI, 'line')
  line.classList.add('ruler-line')
  line.append(seg)
  const bar = el('div', '', 'measure-panel'),
    readout = el('output', '点击起点和终点测距'),
    color = el('span'),
    swatch = el('span', '', 'swatch')
  let start, end, hex
  const canvas = el('canvas')
  surface.onload = () => {
    canvas.width = surface.naturalWidth
    canvas.height = surface.naturalHeight
    canvas.getContext('2d', { willReadFrequently: true }).drawImage(surface, 0, 0)
  }
  function update(e) {
    if (!canvas.width || !surface.complete) return
    const x = Math.min(canvas.width - 1, Math.floor((e.clientX * canvas.width) / innerWidth)),
      y = Math.min(canvas.height - 1, Math.floor((e.clientY * canvas.height) / innerHeight))
    const rgb = canvas.getContext('2d').getImageData(x, y, 1, 1).data
    hex =
      '#' +
      Array.from(rgb)
        .slice(0, 3)
        .map((c) => c.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()
    color.textContent = hex
    swatch.style.background = hex
    return [x, y, e.clientX, e.clientY]
  }
  function ruler(a, b) {
    for (const [key, v] of Object.entries({ x1: a[2], y1: a[3], x2: b[2], y2: b[3] }))
      seg.setAttribute(key, v)
    readout.textContent =
      'Δx ' +
      (b[0] - a[0]) +
      ' · Δy ' +
      (b[1] - a[1]) +
      ' · ' +
      Math.hypot(b[0] - a[0], b[1] - a[1]).toFixed(1) +
      ' px'
  }
  root.onpointermove = (e) => {
    if (bar.contains(e.target) || end) return
    const p = update(e)
    if (start && p) ruler(start, p)
  }
  root.onpointerdown = (e) => {
    if (bar.contains(e.target)) return
    const p = update(e)
    if (!p) return
    if (!start || end) {
      start = p
      end = null
      ruler(p, p)
    } else {
      end = p
      ruler(start, end)
    }
  }
  bar.append(
    readout,
    swatch,
    color,
    button('复制颜色', () => api.copyMeasuredColor(hex)),
    button('关闭', () => api.dismiss()),
  )
  root.append(surface, line, bar)
}
async function annotateRegion(rect, bar) {
  if (root.classList.contains('annotating')) return
  const img = new Image()
  img.src = await api.selectionImage()
  await img.decode()
  root.classList.add('annotating')
  const canvas = makeCanvas(img.naturalWidth, img.naturalHeight),
    ctx = canvas.getContext('2d'),
    r = rect.getBoundingClientRect()
  canvas.className = 'annotation-canvas'
  Object.assign(canvas.style, {
    left: r.x + 'px',
    top: r.y + 'px',
    width: r.width + 'px',
    height: r.height + 'px',
  })
  bar.style.display = 'none'
  const controls = el('div', '', 'annotation-controls bar row'),
    mode = el('select'),
    ink = el('input')
  mode.setAttribute('aria-label', '标注形状')
  mode.add(new Option('画笔', 'pen'))
  mode.add(new Option('矩形', 'rect'))
  ink.type = 'color'
  ink.value = '#ff453a'
  ink.setAttribute('aria-label', '标注颜色')
  const strokes = []
  let stroke
  function draw() {
    ctx.drawImage(img, 0, 0)
    for (const s of strokes) {
      const a = s.points[0],
        b = s.points.at(-1)
      ctx.strokeStyle = s.ink
      ctx.lineWidth = Math.max(2, (3 * canvas.width) / r.width)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (s.mode === 'rect') ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1])
      else {
        ctx.beginPath()
        ctx.moveTo(...a)
        for (const p of s.points) ctx.lineTo(...p)
        ctx.lineTo(b[0] + 0.01, b[1] + 0.01)
        ctx.stroke()
      }
    }
  }
  const pos = (e) => [
    ((e.clientX - r.x) * canvas.width) / r.width,
    ((e.clientY - r.y) * canvas.height) / r.height,
  ]
  canvas.onpointerdown = (e) => {
    e.stopPropagation()
    canvas.setPointerCapture(e.pointerId)
    stroke = { mode: mode.value, ink: ink.value, points: [pos(e)] }
    strokes.push(stroke)
    draw()
  }
  canvas.onpointermove = (e) => {
    if (stroke) {
      e.stopPropagation()
      stroke.points.push(pos(e))
      draw()
    }
  }
  canvas.onpointerup = (e) => {
    e.stopPropagation()
    stroke = null
  }
  function close() {
    root.classList.remove('annotating')
    canvas.remove()
    controls.remove()
    bar.style.display = 'flex'
  }
  controls.append(
    mode,
    ink,
    button('撤销', () => {
      strokes.pop()
      draw()
    }),
    button('应用标注', async () => {
      const data = canvas.toDataURL()
      await api.applyAnnotation(data)
      rect.style.backgroundImage = 'url(' + data + ')'
      rect.style.backgroundSize = '100% 100%'
      close()
    }),
    button('取消标注', close),
  )
  for (const ev of ['pointerdown', 'pointerup', 'pointermove'])
    controls.addEventListener(ev, (e) => e.stopPropagation())
  root.append(canvas, controls)
  controls.style.left = Math.max(0, Math.min(r.x, innerWidth - controls.offsetWidth)) + 'px'
  controls.style.top =
    Math.max(
      0,
      r.bottom + controls.offsetHeight < innerHeight
        ? r.bottom + 4
        : r.y - controls.offsetHeight - 4,
    ) + 'px'
  draw()
}
