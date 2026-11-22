import { api, root, picture, el, button } from './view.js'
import { makeCanvas } from './tools-view.js'
export { pickScreenColor, annotateRegion }
function pickScreenColor(s) {
  root.className = 'screen'
  const img = picture(s.image),
    panel = el('div', '', 'measure-panel'),
    output = el('output', '点击复制颜色 · Esc 取消')
  const swatch = el('span', '', 'swatch')
  panel.style.pointerEvents = 'none'
  panel.append(swatch, output)
  root.append(img, panel)
  const canvas = el('canvas'),
    ctx = canvas.getContext('2d', { willReadFrequently: true })
  let ready = false
  img.onload = () => {
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    ctx.drawImage(img, 0, 0)
    ready = true
  }
  function sample(e) {
    if (!ready) return
    const r = img.getBoundingClientRect()
    const x = Math.min(
      canvas.width - 1,
      Math.max(0, Math.floor(((e.clientX - r.left) * canvas.width) / r.width)),
    )
    const y = Math.min(
      canvas.height - 1,
      Math.max(0, Math.floor(((e.clientY - r.top) * canvas.height) / r.height)),
    )
    const hex =
      '#' +
      Array.from(ctx.getImageData(x, y, 1, 1).data)
        .slice(0, 3)
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()
    output.textContent = hex
    swatch.style.background = hex
    return hex
  }
  root.onpointermove = sample
  root.onclick = async (e) => {
    const hex = sample(e)
    if (hex)
      try {
        await api.copyMeasuredColor(hex)
        await api.dismiss()
      } catch {
        output.textContent = '复制失败，请再次点选'
      }
  }
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
  mode.add(new Option('铅笔', 'pen'))
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
  async function apply() {
    const data = canvas.toDataURL()
    await api.applyAnnotation(data)
    rect.style.backgroundImage = 'url(' + data + ')'
    rect.style.backgroundSize = '100% 100%'
    close()
  }
  controls.append(
    mode,
    ink,
    button('撤销', () => {
      strokes.pop()
      draw()
    }),
    button('应用标注', apply),
    button('复制', async () => {
      await apply()
      await api.copy()
    }),
    button('保存', async () => {
      await apply()
      await api.save()
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
