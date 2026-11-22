import { el, field } from './ui-dom.js'
// Only public connection summaries enter this window. A typed key is write-only.
function connectionEditor(parent, { api, button, notice, error }) {
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
  api.onConnectionChange?.(() => void refresh().catch(error))
  api.onSettingsTarget?.((route) => void focusRoute(route).catch(error))
  void refresh()
    .then(() => api.settingsTarget?.())
    .then(focusRoute)
    .catch(error)
}

export function settingsContents(s, target, ctx) {
  const { api, button, notice } = ctx
  notice.textContent = s.notice
  const defaults = { capture: 'Control+Alt+S', selection: 'Control+Alt+T', color: 'Control+Alt+C' }
  const refreshers = []
  const sync = (values) => {
    for (const apply of refreshers) apply(values)
  }
  const refresh = async () =>
    sync(api.shortcutSettings ? await api.shortcutSettings() : (await api.state()).settings)
  for (const [id, title] of [
    ['capture', '屏幕截图'],
    ['selection', '划词助手'],
    ['color', '屏幕取色'],
  ]) {
    const box = el('section'),
      host = el('div')
    const toggle = button(s[id].enabled ? '停用' : '启用', async () => {
      const enabled = !s[id].enabled
      await api.enable({ id, key: s[id].key, enabled, field: 'enabled' })
      await refresh()
    })
    const props = () => ({
      label: title,
      defaultValue: defaults[id],
      saved: s[id].key.replace(/^Control\+/, 'Ctrl+'),
      change: async (key) => {
        const accelerator = key.replace(/^Ctrl\+/, 'Control+')
        try {
          await api.enable({ id, enabled: s[id].enabled, key: accelerator, field: 'key' })
          await refresh()
          notice.textContent = '快捷键已保存'
          return true
        } catch (error) {
          ctx.error(error)
          return false
        }
      },
    })
    const mount = api.mountRecorder || window.FitBayRecorder.mountRecorder
    box.setAttribute('aria-label', title)
    box.append(host, toggle)
    target.append(box)
    const recorder = mount(host, {
      ...props(),
      defaultValue: defaults[id].replace('Control+', 'Ctrl+'),
    })
    const update = () =>
      recorder.render({ ...props(), defaultValue: defaults[id].replace('Control+', 'Ctrl+') })
    refreshers.push((values) => {
      s[id] = values[id]
      toggle.textContent = s[id].enabled ? '停用' : '启用'
      update()
    })
  }
  const reset = el('section')
  reset.append(
    button('全部恢复默认快捷键', async () => {
      await api.enable({ id: 'defaults' })
      await refresh()
      notice.textContent = '已恢复默认快捷键'
    }),
  )
  target.append(reset)
  connectionEditor(target, ctx)
  return refresh
}
