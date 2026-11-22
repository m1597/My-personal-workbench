import { createBackButton, createSettingsGear, createSettingsShell } from './settings-shell.js'
import { el, field } from './ui-dom.js'
export { toolkitHome, glyph, makeCanvas }
/* Local toolkit pages use opaque file IDs returned by the native picker. */
const glyphs = {
  toolkit: 'M3 8h18v12H3z M8 8V5h8v3 M3 12h18 M9 11v3m6-3v3',
  color: 'M15 3l6 6-2 2-2-2-9 9-4 1 1-4 9-9-1-1z',
  capture: 'M3 8V3h5m8 0h5v5m0 8v5h-5m-8 0H3v-5 M10 8l7 6-4 1-2 4z',
  selection: 'M6 4h12m-6 0v16m-6 0h12',
  settings:
    'M9 3h6l.6 2.6 2.5 1.4 2.4-.8 2 4-2 1.7v2.4l2 1.7-2 4-2.4-.8-2.5 1.4L15 23H9l-.6-2.4-2.5-1.4-2.4.8-2-4 2-1.7v-2.4l-2-1.7 2-4 2.4.8 2.5-1.4z M16 13a4 4 0 1 1-8 0 4 4 0 1 1 8 0',
  annotate: 'M4 16L16 4l4 4L8 20H4z M14 6l4 4',
  compare: 'M2 5h12v12H2z M16 8h6v13H9v-2',
  album: 'M3 3h18v8H3z M3 14h18v7H3z M5 9l3-3 4 4',
  compress: 'M3 3l6 6m-5 0h5V4m12 17l-6-6m0 5v-5h5',
  clipboard: 'M7 5H4v16h16V5h-3 M8 3h8v4H8z M8 12h8m-8 4h6',
  diff: 'M3 7h8m-4-4v8m6 6h8',
  rename: 'M3 6h12m-12 6h7m-6 5h4m3 2l2-5 6-6 3 3-7 6z',
  resize: 'M3 9V3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6 M7 17l9-9m-5 0h5v5',
  pairs: 'M2 5h8v6H2z M14 13h8v6h-8z M13 6h5v4M6 14v4h5',
  convert: 'M3 3h8l3 4v4M3 3v18h7m2-5h9m-4-4l4 4-4 4',
  cancel: 'M5 5l14 14m0-14L5 19',
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
function lineDiff(a, b) {
  const lines = (s) => (s ? s.replace(/\r\n?/g, '\n').split('\n') : [])
  const x = lines(a),
    y = lines(b)
  let first = 0,
    last = 0
  while (first < x.length && first < y.length && x[first] === y[first]) first++
  while (
    last < x.length - first &&
    last < y.length - first &&
    x[x.length - last - 1] === y[y.length - last - 1]
  )
    last++
  const m = x.length - first - last,
    n = y.length - first - last
  if ((m + 1) * (n + 1) > 6000000 || x.length + y.length > 20000)
    throw Error('文本过长，请分段比较')
  const lcs = new Uint32Array((m + 1) * (n + 1)),
    offset = (i, j) => i * (n + 1) + j
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      lcs[offset(i, j)] =
        x[first + i] === y[first + j]
          ? 1 + lcs[offset(i + 1, j + 1)]
          : Math.max(lcs[offset(i + 1, j)], lcs[offset(i, j + 1)])
  const out = []
  function row(sign, i, j, text) {
    out.push([sign, i == null ? '·' : i + 1, j == null ? '·' : j + 1, text])
  }
  for (let i = 0; i < first; i++) row(' ', i, i, x[i])
  let i = 0,
    j = 0
  while (i < m || j < n) {
    if (i < m && j < n && x[first + i] === y[first + j]) {
      row(' ', first + i, first + j, x[first + i])
      i++
      j++
    } else if (i < m && (j === n || lcs[offset(i + 1, j)] >= lcs[offset(i, j + 1)])) {
      row('−', first + i, null, x[first + i])
      i++
    } else {
      row('+', null, first + j, y[first + j])
      j++
    }
  }
  for (let k = last; k > 0; k--) row(' ', x.length - k, y.length - k, x[x.length - k])
  return out
}
function makeCanvas(w, h) {
  if (!w || !h || w * h > 40000000 || w > 32760 || h > 32760)
    throw Error('图片尺寸过大，请缩小输入或改用 PDF')
  const c = el('canvas')
  c.width = w
  c.height = h
  return c
}
async function compressImage(img, limit) {
  let w = img.naturalWidth,
    h = img.naturalHeight
  for (;;) {
    const c = makeCanvas(w, h),
      ctx = c.getContext('2d')
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    for (const q of [0.92, 0.8, 0.65, 0.45, 0.25]) {
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q))
      if (blob && blob.size <= limit) return c.toDataURL('image/jpeg', q)
    }
    if (w === 1 && h === 1) throw Error('无法达到指定大小')
    w = Math.max(1, Math.floor(w * 0.72))
    h = Math.max(1, Math.floor(h * 0.72))
  }
}
function asMarkdown(html, text) {
  if (!html) return text
  const template = document.createElement('template')
  template.innerHTML = html
  function walk(node) {
    if (node.nodeType === 3) return node.textContent
    if (node.nodeType !== 1 && node.nodeType !== 11) return ''
    const tag = node.nodeName.toLowerCase()
    if (['style', 'script', 'noscript', 'iframe', 'object'].includes(tag)) return ''
    const body = Array.from(node.childNodes, walk).join('')
    if (['strong', 'b'].includes(tag)) return '**' + body + '**'
    if (['em', 'i'].includes(tag)) return '*' + body + '*'
    if (/^h[1-6]$/.test(tag)) return '#'.repeat(Number(tag[1])) + ' ' + body + '\n\n'
    if (tag === 'a' && /^https?:\/\//i.test(node.getAttribute('href') || ''))
      return '[' + body + '](' + node.getAttribute('href') + ')'
    if (tag === 'li') return '- ' + body + '\n'
    if (tag === 'br') return '\n'
    return ['p', 'div', 'ul', 'ol'].includes(tag) ? body + '\n\n' : body
  }
  return walk(template.content).trim() || text
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
    gear = createSettingsGear({ label: '设置', onClick: () => void settingsPage().catch(error) })
  head.append(el('h1', '工具集'), gear)
  const surface = el('div', '', 'tools-surface'),
    settingsBox = el('div')
  settingsBox.hidden = true
  root.append(head, notice, surface, settingsBox)
  notice.textContent = s.notice
  let refreshShortcuts
  async function settingsPage() {
    surface.hidden = true
    settingsBox.hidden = false
    head.hidden = true
    if (refreshShortcuts) await refreshShortcuts()
    if (!settingsBox.childElementCount) {
      const shell = createSettingsShell({
        title: '工具集设置',
        categories: [
          { id: 'keys', name: '快捷键' },
          { id: 'api', name: 'API 与模型' },
        ],
        active: 'keys',
        onSelect: showCategory,
        onBack: () => {
          settingsBox.hidden = true
          head.hidden = false
          surface.hidden = false
        },
      })
      const panels = el('div')
      function showCategory(id) {
        for (const box of panels.children)
          box.hidden = (id === 'api') !== box.classList.contains('connections')
      }
      settingsBox.append(shell.element)
      shell.content.append(panels)
      try {
        const values = api.shortcutSettings ? await api.shortcutSettings() : s
        if (!panels.isConnected) return
        refreshShortcuts = settingsContents(values, panels, { api, button, notice, error })
        api.onSettingsTarget?.((route) => {
          if (route) {
            shell.select('api')
            showCategory('api')
          }
        })
        const route = await api.settingsTarget?.()
        shell.select(route ? 'api' : 'keys')
        showCategory(route ? 'api' : 'keys')
      } catch (e) {
        settingsBox.replaceChildren()
        settingsBox.hidden = true
        head.hidden = false
        surface.hidden = false
        throw e
      }
    }
  }
  api.onSettingsTarget?.(() => settingsPage())
  void api.settingsTarget?.().then((route) => {
    if (route) settingsPage()
  })
  const images = () => files.filter((f) => f.type.startsWith('image/'))
  function select(id) {
    notice.textContent = ''
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
        tile('屏幕取色', '点选屏幕像素，复制十六进制色值', 'color', '开始取色', () =>
          api.capture('color'),
        ),
      )
      surface.append(primary)
      return
    }
    const panel = el('section', '', 'tool-page'),
      out = el('div', '', 'tool-results')
    surface.append(
      createBackButton(() => {
        active = ''
        draw()
      }),
      panel,
    )
    panel.append(el('h2', toolNames[active][0]))
    if (active === 'diff') {
      const input = (name) => {
        const l = el('label', name),
          t = el('textarea')
        t.rows = 6
        l.append(t)
        panel.append(l)
        return t
      }
      const a = input('原文'),
        b = input('新文本')
      if (files.length === 2 && files.every((f) => f.type === 'text/plain')) {
        a.disabled = b.disabled = true
        void Promise.all(files.map((f) => api.readText(f.id)))
          .then(([left, right]) => {
            a.value = left
            b.value = right
          })
          .catch(error)
          .finally(() => {
            a.disabled = b.disabled = false
          })
      }
      panel.append(
        button('比较文本', () => {
          out.replaceChildren()
          for (const [sign, i, j, text] of lineDiff(a.value, b.value)) {
            const line = el('pre', sign + '  ' + i + ' │ ' + j + '   ' + text)
            line.className = sign === '+' ? 'added' : sign === '−' ? 'removed' : ''
            out.append(line)
          }
        }),
        out,
      )
      return
    }
    if (active === 'clipboard') {
      panel.append(
        button('读取剪贴板', async () => {
          const c = await api.clipboardSnapshot()
          out.replaceChildren()
          if (!c.text && !c.image) {
            out.append(el('p', '剪贴板没有文字或图片'))
            return
          }
          if (c.text) out.append(el('pre', c.text.slice(0, 800)))
          for (const [id, label] of [
            ['plain', '复制纯文本'],
            ['copy-markdown', '复制 Markdown'],
            ['markdown', '保存 Markdown'],
            ['prompt', '存为提示词'],
            ['png', '保存 PNG'],
          ])
            if (id === 'png' ? c.image : c.text)
              out.append(
                button(label, async () => {
                  notice.textContent = await api.clipboardAction({
                    kind: id,
                    markdown: asMarkdown(c.html, c.text),
                  })
                }),
              )
        }),
        out,
      )
      return
    }
    panel.append(button(files.length ? '重新选择文件' : '选择文件', pick))
    const imgs = images()
    if (files.length) panel.append(el('small', files.map((f) => f.name).join(' · ')))
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
    if (active === 'pairs' || active === 'rename') {
      const prefix = field(panel, '新名称前缀', '图片')
      const texts = files.filter((f) => f.type === 'text/plain')
      const matches = new Map()
      const stem = (name) => name.replace(/\.[^.]+$/, '').toLowerCase()
      for (const image of active === 'pairs' ? imgs : []) {
        const label = el('label', image.name + ' 的提示词'),
          select = el('select')
        select.add(new Option('请选择提示词', ''))
        for (const t of texts) select.add(new Option(t.name, t.id))
        const exact = texts.filter((t) => stem(t.name) === stem(image.name))
        if (exact.length === 1) select.value = exact[0].id
        label.append(select)
        panel.append(label)
        matches.set(image.id, select)
      }
      let revision = 0,
        token
      const apply = button('确认重命名', async () => {
        notice.textContent = await api.applyRename(token)
        files = []
        draw()
      })
      apply.disabled = true
      prefix.oninput = () => {
        revision++
        apply.disabled = true
        out.replaceChildren()
      }
      for (const select of matches.values()) select.onchange = prefix.oninput
      panel.append(
        button('预览名称', async () => {
          const version = ++revision
          apply.disabled = true
          const next = await api.planRename({
            prefix: prefix.value,
            ...(active === 'rename'
              ? { ids: files.map((f) => f.id) }
              : { pairs: [...matches].map(([id, select]) => [id, select.value]) }),
          })
          const { rows } = next
          if (version !== revision) return
          token = next.token
          out.replaceChildren(
            ...rows.map((r) => el('p', r.from + ' → ' + r.to + (r.issue ? ' · ' + r.issue : ''))),
          )
          apply.disabled = !rows.length || rows.some((r) => r.issue)
        }),
        out,
        apply,
      )
      return
    }
    if (active === 'album') {
      if (imgs.length < 2) {
        panel.append(el('p', '请选择至少两张图片'))
        return
      }
      const order = el('ol')
      for (const [i, f] of imgs.entries()) {
        const li = el('li', f.name)
        for (const [d, label] of [
          [-1, '上移'],
          [1, '下移'],
        ]) {
          const b = button(label, () => {
            const j = files.indexOf(f),
              k = files.indexOf(imgs[i + d])
            ;[files[j], files[k]] = [files[k], files[j]]
            draw()
          })
          b.disabled = !imgs[i + d]
          li.append(b)
        }
        order.append(li)
      }
      panel.append(order)
      panel.append(
        button('导出长图', () =>
          exportTo(async (batch) => {
            const sizes = []
            for (const f of imgs) {
              const im = await loadImage(f.id)
              sizes.push([im.naturalWidth, im.naturalHeight])
            }
            const width = Math.max(...sizes.map((v) => v[0])),
              canvas = makeCanvas(
                width,
                sizes.reduce((n, v) => n + v[1], 0),
              ),
              ctx = canvas.getContext('2d')
            let y = 0
            for (const f of imgs) {
              const im = await loadImage(f.id)
              ctx.drawImage(im, Math.floor((width - im.naturalWidth) / 2), y)
              y += im.naturalHeight
            }
            notice.textContent =
              '已导出 ' + (await api.writeImage({ batch, format: 'png', data: canvas.toDataURL() }))
          }),
        ),
        button('导出 PDF', () =>
          exportTo(async (batch) => {
            notice.textContent =
              '已导出 ' + (await api.writeAlbumPdf({ batch, ids: imgs.map((f) => f.id) }))
          }),
        ),
      )
      return
    }
    if (active === 'resize') {
      if (!imgs.length) {
        panel.append(button('选择图片', pick))
        return
      }
      const width = field(panel, '输出宽度（像素）', '800', 'number')
      const height = field(panel, '输出高度（像素）', '600', 'number')
      panel.append(
        button('生成尺寸副本', async () => {
          const w = Number(width.value),
            h = Number(height.value)
          if (![w, h].every((v) => Number.isInteger(v) && v > 0 && v <= 16384) || w * h > 32000000)
            throw Error('宽高须为正整数且不超过 16384，最多 3200 万像素')
          await exportTo(async (batch) => {
            out.replaceChildren()
            for (const f of imgs) {
              const im = await loadImage(f.id),
                canvas = makeCanvas(w, h)
              canvas.getContext('2d').drawImage(im, 0, 0, w, h)
              const name = await api.writeImage({
                batch,
                id: f.id,
                format: 'png',
                data: canvas.toDataURL(),
              })
              out.append(el('p', name + ' · ' + w + ' × ' + h))
            }
          })
        }),
        out,
      )
      return
    }
    const compress = active === 'compress',
      inputs = compress
        ? imgs
        : files.filter((f) => f.type === 'application/docx' || f.type.startsWith('image/'))
    if (!inputs.length) {
      panel.append(el('p', compress ? '请选择图片' : '请选择图片或 DOCX 文档'))
      return
    }
    const size = compress ? field(panel, '每张最大 KB', '250', 'number') : null
    panel.append(
      button(compress ? '压缩并导出' : '开始转换', async () => {
        const limit = Number(size?.value) * 1024
        if (compress && (!Number.isFinite(limit) || limit < 1024)) throw Error('请输入至少 1 KB')
        await exportTo(async (batch) => {
          out.replaceChildren()
          for (const f of inputs) {
            try {
              let saved
              if (f.type === 'application/docx') saved = await api.convertDoc({ id: f.id, batch })
              else {
                const im = await loadImage(f.id)
                let data
                if (compress) data = await compressImage(im, limit)
                else {
                  const c = makeCanvas(im.naturalWidth, im.naturalHeight)
                  c.getContext('2d').drawImage(im, 0, 0)
                  data = c.toDataURL()
                }
                saved = await api.writeImage({
                  batch,
                  id: f.id,
                  format: compress ? 'jpg' : 'png',
                  data,
                })
              }
              out.append(el('p', f.name + ' → ' + saved))
            } catch (e) {
              out.append(el('p', f.name + ' · ' + e.message))
            }
          }
        })
      }),
      out,
    )
  }
  draw()
  let lastBatch
  async function openTarget(id) {
    if (id && typeof id === 'object') {
      if (lastBatch === id.id) return
      lastBatch = id.id
      files = await api.batchInputs(id)
      id = id.tool
    }
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
