const api = window.toolkit
const root = document.querySelector('#app')
const el = (tag, text, cls) => {
  const n = document.createElement(tag)
  if (text) n.textContent = text
  if (cls) n.className = cls
  return n
}
const notice = el('div', '', 'notice')
notice.setAttribute('role', 'status')
function error(e) {
  notice.textContent = String(e.message || e).replace(/^.*?Error: /, '')
}
function button(label, action) {
  const b = el('button', label)
  b.onclick = async () => {
    b.disabled = true
    try {
      notice.textContent = ''
      await action(b)
    } catch (e) {
      error(e)
    } finally {
      b.disabled = false
    }
  }
  return b
}
function field(parent, label, value, type = 'text') {
  const wrap = el('label', label),
    input = el('input')
  input.type = type
  input.value = value
  wrap.append(input)
  parent.append(wrap)
  return input
}
function picture(src, cls) {
  const img = el('img', '', cls)
  img.src = src
  img.draggable = false
  img.alt = '选区图像'
  return img
}
// Only public connection summaries enter this window. A typed key is write-only.
function connectionEditor(parent) {
  const section = el('section', '', 'connections')
  section.append(el('h2', 'API 与模型'))
  const purposeLabel = el('label', '用途')
  const purpose = el('select')
  for (const [id, title] of [
    ['translation', '翻译与文字问答'],
    ['vision', '视觉问答'],
  ])
    purpose.add(new Option(title, id))
  purposeLabel.append(purpose)
  const connectionLabel = el('label', '连接')
  const connection = el('select')
  connection.setAttribute('aria-label', '连接')
  connectionLabel.append(connection)
  section.append(purposeLabel, connectionLabel)
  const fields = el('div', '', 'connection-fields')
  section.append(fields)
  const protocolLabel = el('label', '协议')
  const protocol = el('select')
  for (const [id, title] of [
    ['chat', 'Chat Completions'],
    ['responses', 'Responses'],
    ['claude', 'Claude Messages'],
    ['gemini', 'Gemini generateContent'],
  ])
    protocol.add(new Option(title, id))
  protocolLabel.append(protocol)
  fields.append(protocolLabel)
  const address = field(fields, '服务地址', '')
  address.placeholder = 'https://…/v1'
  const model = field(fields, '模型名', '')
  const key = field(fields, 'API 密钥', '', 'password')
  key.autocomplete = 'new-password'
  const status = el('p', '', 'connection-status')
  const save = button('保存 API 配置', async () => {
    const route = purpose.value
    await api.configure({
      route,
      connection: connection.value,
      expectedId: editingId,
      endpoint: address.value.trim(),
      protocol: protocol.value,
      model: model.value.trim(),
      key: key.value,
    })
    dirty = false
    key.value = ''
    await refresh()
    render()
    notice.textContent = 'API 配置已保存'
  })
  section.append(status, save)
  parent.append(section)
  save.disabled = true
  let editingId,
    snapshot,
    dirty = false,
    sequence = 0
  function renderFields(id) {
    const ref = snapshot.connections.find((c) => c.id === id)
    const bound = snapshot.routes[purpose.value]
    editingId = bound?.id ?? null
    const own = id === 'private' || id === 'edit'
    const current = own ? bound : ref
    protocol.value = current?.protocol || 'chat'
    protocol.disabled = !own
    address.value = current?.endpoint || ''
    model.value = current?.model || ''
    key.value = ''
    key.placeholder = current?.hasKey ? '已保存 · 留空保留' : '本机服务可留空'
    address.readOnly = !own
    model.readOnly = !own
    key.disabled = !own
    status.textContent =
      id === 'edit'
        ? '保存将更新所有复用此连接的用途。'
        : own
          ? '单独配置仅用于当前用途。'
          : '使用所选连接的服务和凭据。'
    if (snapshot.migrationPending.includes(purpose.value))
      status.textContent = '原连接未能迁移。请重新填写此用途的连接，原配置已保留。'
    save.disabled = false
  }
  function render() {
    connection.replaceChildren(new Option('单独配置', 'private'))
    const bound = snapshot.routes[purpose.value]
    if (bound && !bound.private) connection.add(new Option('编辑当前共享连接', 'edit'))
    for (const c of snapshot.connections)
      if (c.id !== bound?.id || !bound.private) connection.add(new Option('复用 · ' + c.name, c.id))
    connection.value = bound?.private || !bound ? 'private' : bound.id
    if (!connection.value) connection.value = 'private'
    renderFields(connection.value)
  }
  async function refresh() {
    const request = ++sequence
    const next = await api.connections()
    if (request !== sequence) return
    const changed = JSON.stringify(next) !== JSON.stringify(snapshot)
    snapshot = next
    if (!dirty && changed) render()
    else if (changed) {
      save.disabled = true
      status.textContent = '连接已在其他窗口更新。请重新选择用途以加载当前配置。'
    }
  }
  section.oninput = () => {
    dirty = true
  }
  purpose.onchange = () => {
    dirty = false
    if (snapshot) render()
  }
  connection.onchange = () => {
    dirty = true
    if (snapshot) renderFields(connection.value)
  }
  async function focusRoute(route) {
    if (!['translation', 'vision'].includes(route)) return
    purpose.value = route
    dirty = false
    await refresh()
    render()
    section.scrollIntoView({ block: 'start' })
    address.focus({ preventScroll: true })
  }
  api.onConnectionChange(() => void refresh().catch(error))
  api.onSettingsTarget((route) => void focusRoute(route).catch(error))
  void refresh()
    .then(() => api.settingsTarget())
    .then(focusRoute)
    .catch(error)
}

async function home(s) {
  root.append(el('h1', '工具集'), notice)
  notice.textContent = s.notice
  for (const [id, title] of [
    ['capture', '屏幕截图'],
    ['selection', '划词助手'],
  ]) {
    const box = el('section')
    box.append(el('h2', title))
    const key = field(box, '全局快捷键', s[id].key),
      row = el('div', '', 'row')
    const set = async (enabled) => {
      await api.enable({ id, enabled, key: key.value.trim() })
      s[id].enabled = enabled
      toggle.textContent = enabled ? '停用' : '启用'
      notice.textContent = enabled ? '已启用 ' + key.value : '已停用'
    }
    const toggle = button(s[id].enabled ? '停用' : '启用', () => set(!s[id].enabled))
    row.append(
      toggle,
      button('应用快捷键', () => set(s[id].enabled)),
    )
    if (id === 'capture') row.append(button('立即截图', () => api.capture()))
    else box.append(el('p', '在阅读器中选中文字，然后按快捷键。'))
    box.append(row)
    root.append(box)
  }
  connectionEditor(root)
}
async function screenView(s) {
  root.className = 'screen'
  const rect = el('div', '', 'rect'),
    bar = el('div', '', 'bar row'),
    tip = el('span', '拖动框选 · Esc 取消', 'tip')
  root.append(picture(s.image), rect, bar, tip)
  rect.hidden = true
  bar.hidden = true
  bar.style.display = 'none'
  bar.append(notice)
  const ask = (mode, id) => api.ask({ mode, id })
  for (const [name, fn] of [
    ['复制', api.copy],
    ['保存', api.save],
    ['贴图置顶', api.pin],
    ['截图翻译', () => ask('translate')],
    ['向模型提问', () => ask('question')],
  ])
    bar.append(button(name, () => fn()))
  try {
    for (const a of await api.actions())
      bar.append(button(a.displayName, () => ask('custom', a.id)))
  } catch (e) {
    error(e)
  }
  let start, end
  function point(e) {
    return [
      Math.min(innerWidth, Math.max(0, e.clientX)),
      Math.min(innerHeight, Math.max(0, e.clientY)),
    ]
  }
  function bounds() {
    return [
      Math.min(start[0], end[0]),
      Math.min(start[1], end[1]),
      Math.max(start[0], end[0]),
      Math.max(start[1], end[1]),
    ]
  }
  function draw() {
    const [x, y, r, b] = bounds()
    Object.assign(rect.style, {
      left: x + 'px',
      top: y + 'px',
      width: r - x + 'px',
      height: b - y + 'px',
    })
  }
  root.onpointerdown = (e) => {
    if (bar.contains(e.target) || e.button !== 0) return
    root.setPointerCapture(e.pointerId)
    start = end = point(e)
    rect.hidden = false
    bar.style.display = 'none'
    tip.hidden = true
    draw()
  }
  root.onpointermove = (e) => {
    if (start) {
      end = point(e)
      draw()
    }
  }
  root.onpointerup = async (e) => {
    if (!start) return
    end = point(e)
    draw()
    const [x, y, r, b] = bounds()
    start = null
    if (r - x < 2 || b - y < 2) {
      rect.hidden = true
      tip.hidden = false
      return
    }
    try {
      await api.crop([x / innerWidth, y / innerHeight, r / innerWidth, b / innerHeight])
      bar.hidden = false
      bar.style.display = 'flex'
      bar.style.left = Math.max(0, Math.min(x, innerWidth - bar.offsetWidth)) + 'px'
      bar.style.top =
        Math.max(0, b + bar.offsetHeight + 5 <= innerHeight ? b + 4 : y - bar.offsetHeight - 4) +
        'px'
    } catch (e) {
      error(e)
      tip.textContent = notice.textContent
      tip.hidden = false
    }
  }
}
async function result(s) {
  root.append(el('h1', s.image ? '截图助手' : '划词助手'))
  if (s.image) root.append(picture(s.image, 'preview'))
  else root.append(el('pre', s.text))
  const prompt = el('textarea')
  prompt.placeholder = '输入问题'
  prompt.setAttribute('aria-label', '问题')
  const row = el('div', '', 'row'),
    output = el('section'),
    history = el('div'),
    controls = el('div', '', 'row')
  output.hidden = true
  root.append(prompt, row, notice, output)
  output.append(history, controls)
  const configure = button('打开 API 设置', () => api.settings(configure.dataset.route))
  configure.hidden = true
  row.append(configure)
  let hasAnswer = false,
    busy = false
  async function run(mode, id) {
    if (busy) return
    if (mode === 'question' && !prompt.value.trim()) {
      prompt.focus()
      return
    }
    const question = prompt.value
    busy = true
    configure.hidden = true
    notice.textContent = '正在处理…'
    try {
      const answer = await api.ask({ mode, id, question })
      if (mode !== 'follow') history.replaceChildren()
      history.append(el('h2', question || '回答'), el('pre', answer))
      output.hidden = false
      hasAnswer = true
      prompt.value = ''
      notice.textContent = ''
    } catch (e) {
      const missing = String(e.message || e).match(/TOOLKIT_CONFIG_(translation|vision)/)
      if (missing) {
        configure.dataset.route = missing[1]
        configure.hidden = false
        notice.textContent =
          (/HTTP (401|403)/.exec(e.message)?.[0] || '') +
          (missing[1] === 'vision' ? ' 请检查视觉问答连接。' : ' 请检查翻译与文字问答连接。')
      } else error(e)
    } finally {
      busy = false
    }
  }
  row.append(
    button('翻译', () => run('translate')),
    button('解释', () => run('explain')),
    button('自由提问', () => run('question')),
  )
  try {
    for (const a of await api.actions())
      row.append(button(a.displayName, () => run('custom', a.id)))
  } catch (e) {
    error(e)
  }
  controls.append(
    button('复制结果', () => api.copyAnswer()),
    button('固定', async (b) => {
      b.textContent = (await api.top()) ? '取消固定' : '固定'
    }),
    button('追问', () => {
      if (hasAnswer && prompt.value.trim()) return run('follow')
      prompt.focus()
    }),
  )
  const initial = await api.initial()
  if (initial) await run(initial.mode, initial.id)
}
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') void api.dismiss()
})
api
  .state()
  .then((s) => {
    if (s.kind === 'home') return home(s.settings)
    if (s.kind === 'screen') return screenView(s)
    if (s.kind === 'result') return result(s)
    if (s.kind === 'pin') {
      root.className = 'pinned'
      root.append(picture(s.image))
    } else
      root.append(
        el('p', s.text),
        button('关闭', () => api.dismiss()),
      )
  })
  .catch((e) => {
    root.append(notice)
    error(e)
  })
