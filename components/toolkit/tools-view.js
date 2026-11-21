import { el, field } from './ui-dom.js'
export { toolkitHome, glyph, makeCanvas }
/* Local toolkit pages use opaque file IDs returned by the native picker. */
const glyphs = {
  toolkit: 'M3 8h18v12H3z M8 8V5h8v3 M3 12h18 M9 11v3m6-3v3',
  capture: 'M3 8V3h5m8 0h5v5m0 8v5h-5m-8 0H3v-5 M10 8l7 6-4 1-2 4z',
  selection: 'M6 4h12m-6 0v16m-6 0h12',
  settings:
    'M9 3h6l.6 2.6 2.5 1.4 2.4-.8 2 4-2 1.7v2.4l2 1.7-2 4-2.4-.8-2.5 1.4L15 23H9l-.6-2.4-2.5-1.4-2.4.8-2-4 2-1.7v-2.4l-2-1.7 2-4 2.4.8 2.5-1.4z M16 13a4 4 0 1 1-8 0 4 4 0 1 1 8 0',
  annotate: 'M4 16L16 4l4 4L8 20H4z M14 6l4 4',
  measure: 'M3 16L16 3l5 5L8 21z M8 12l3 3m1-7l3 3',
  compare: 'M2 5h12v12H2z M16 8h6v13H9v-2',
  album: 'M3 3h18v8H3z M3 14h18v7H3z M5 9l3-3 4 4',
  compress: 'M3 3l6 6m-5 0h5V4m12 17l-6-6m0 5v-5h5',
  clipboard: 'M7 5H4v16h16V5h-3 M8 3h8v4H8z M8 12h8m-8 4h6',
  diff: 'M3 7h8m-4-4v8m6 6h8',
  pairs: 'M2 5h8v6H2z M14 13h8v6h-8z M13 6h5v4M6 14v4h5',
  convert: 'M3 3h8l3 4v4M3 3v18h7m2-5h9m-4-4l4 4-4 4',
  copy: 'M3 4h12v3M7 8h13v13H7z',
  save: 'M3 3h15l3 3v15H3z M7 3v6h9V3 M7 21v-8h10v8',
  pin: 'M7 3h10l-2 7 4 4H5l4-4z M12 14v7',
  translate: 'M2 6h11m-6-3v3m4 0q-1 7-8 10m1-7l6 6m4 5l4-11 4 11m-7-3h6',
  ask: 'M3 4h18v13H9l-5 4v-4H3z M8 10h8',
  ocr: 'M3 8V3h5m8 0h5v5m0 8v5h-5m-8 0H3v-5 M8 8h8m-4 0v9',
}
function glyph(name) {
  const ns = 'http://www.w3.org/2000/svg',
    svg = document.createElementNS(ns, 'svg'),
    p = document.createElementNS(ns, 'path')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('class', 'tool-glyph')
  p.setAttribute('d', glyphs[name] || glyphs.toolkit)
  svg.append(p)
  return svg
}
function makeCanvas(w, h) {
  if (!w || !h || w * h > 40000000 || w > 32760 || h > 32760)
    throw Error('图片尺寸过大，请缩小输入或改用 PDF')
  const c = el('canvas')
  c.width = w
  c.height = h
  return c
}
function toolkitHome(s, { api, root, notice, error, button, settingsContents }) {
  async function loadImage(id) {
    const img = new Image()
    img.src = await api.readImage(id)
    await img.decode()
    return img
  }
  async function exportTo(fn) {
    const batch = await api.chooseOutput()
    if (!batch) return
    try {
      return await fn(batch)
    } finally {
      await api.finishOutput(batch)
    }
  }

  const toolNames = Object.fromEntries(s.catalog.map(([id, name, detail]) => [id, [name, detail]]))
  let files = [],
    active = '',
    generation = 0
  const head = el('div', '', 'home-title'),
    gear = button('设置', () => settingsPage())
  gear.prepend(glyph('settings'))
  gear.className = 'gear'
  head.append(el('h1', '工具集'), gear)
  const surface = el('div', '', 'tools-surface'),
    settingsBox = el('div')
  settingsBox.hidden = true
  root.append(head, notice, surface, settingsBox)
  notice.textContent = s.notice
  function settingsPage() {
    if (!settingsContents) return api.open('settings')
    generation++
    surface.hidden = true
    settingsBox.hidden = false
    head.hidden = true
    settingsBox.scrollIntoView()
    if (!settingsBox.childElementCount) {
      settingsBox.append(
        button('返回工具集', () => {
          settingsBox.hidden = true
          head.hidden = false
          surface.hidden = false
          draw()
        }),
      )
      settingsContents(s, settingsBox)
    }
  }
  api.onSettingsTarget?.(() => settingsPage())
  void api.settingsTarget?.().then((route) => {
    if (route) settingsPage()
  })
  const images = () => files.filter((f) => f.type.startsWith('image/'))
  function applies(id) {
    const count = images().length,
      texts = files.filter((f) => f.type === 'text/plain').length,
      allImages = count === files.length
    return (
      !files.length ||
      {
        diff: texts === 2 && texts === files.length,
        compare: allImages && count === 2,
        album: allImages && count >= 2,
        compress: allImages && count > 0,
        convert: files.every((f) => f.type.startsWith('image/') || f.type === 'application/docx'),
        pairs: count > 0 && texts === count && files.length === count * 2,
      }[id]
    )
  }
  function select(id) {
    notice.textContent = ''
    if (id === 'annotate' || id === 'measure') return api.capture(id)
    active = id
    draw()
  }
  function tile(title, sub, icon, label, fn) {
    const item = el('div', '', 'tool-row'),
      badge = el('span', '', 'badge ' + icon),
      text = el('div', '', 'tool-text')
    badge.append(glyph(icon))
    text.append(el('strong', title), el('small', sub))
    const action = button(label, fn)
    item.append(badge, text, action)
    return item
  }
  async function pick() {
    const chosen = await api.chooseFiles()
    if (chosen) {
      files = chosen
      draw()
    }
  }
  function draw() {
    const current = ++generation
    surface.replaceChildren()
    if (!active) {
      const primary = el('section', '', 'primary-tools')
      primary.append(
        tile('屏幕截图', '框选后可复制、贴图或提取文字', 'capture', '框选屏幕', () =>
          api.capture(),
        ),
        tile('划词助手', '选中文字后按快捷键翻译或提问', 'selection', '设置快捷键', settingsPage),
      )
      surface.append(primary)
      const heading = el('div', '', 'tools-heading')
      heading.append(el('h2', '其他工具'), button('选择文件', pick))
      surface.append(heading)
      if (files.length) {
        surface.append(
          el('small', '已选择 ' + files.length + ' 个文件'),
          button('清除选择', () => {
            files = []
            draw()
          }),
        )
      }
      const list = el('div', '', 'tool-list')
      surface.append(list)
      for (const [id, [name, detail]] of Object.entries(toolNames))
        if (applies(id)) {
          const b = button(name, () => select(id))
          b.className = 'tool-item'
          b.prepend(glyph(id))
          b.append(el('small', detail))
          list.append(b)
        }
      return
    }
    const panel = el('section', '', 'tool-page'),
      out = el('div', '', 'tool-results')
    surface.append(
      button('返回工具列表', () => {
        active = ''
        draw()
      }),
      panel,
    )
    panel.append(el('h2', toolNames[active][0]))
    if (active === 'compare') {
      if (imgs.length !== 2) {
        panel.append(el('p', '请选择两张图片'))
        return
      }
      const viewer = el('div', '', 'compare-view'),
        slider = field(panel, '上层不透明度', '50', 'range')
      slider.min = 0
      slider.max = 100
      void Promise.all(imgs.map((f) => loadImage(f.id)))
        .then(([a, b]) => {
          if (current !== generation) return
          a.alt = imgs[0].name
          b.alt = imgs[1].name
          viewer.append(a, b)
          function opacity(v) {
            slider.value = v
            b.style.opacity = Number(v) / 100
          }
          slider.oninput = () => opacity(slider.value)
          opacity(50)
          panel.append(
            viewer,
            button('切换图片', () => opacity(Number(slider.value) >= 50 ? 0 : 100)),
          )
        })
        .catch(error)
      return
    }
  }
  draw()
  async function openTarget(id) {
    settingsBox.hidden = true
    head.hidden = false
    surface.hidden = false
    if (id === 'settings') {
      settingsPage()
      return
    }
    if (id === 'files') {
      active = ''
      draw()
      await pick()
      return
    }
    if (toolNames[id]) await select(id)
    else {
      active = ''
      draw()
    }
  }
  api.onToolTarget?.((id) => void openTarget(id).catch(error))
  void api
    .toolTarget?.()
    .then((id) => {
      if (id) return openTarget(id)
    })
    .catch(error)
}
