import { layoutTranslation } from './translated-diagram.js'
import { settingsContents, connectionEditor } from './settings-view.js'
import { createSettingsShell } from './settings-shell.js'
import { el, field, feedback } from './ui-dom.js'
import { toolkitHome, glyph } from './tools-view.js'
import { pickScreenColor, annotateRegion } from './screen-tools.js'
export { api, root, notice, el, button, error, field, picture, settingsContents }
const api = window.toolkit
const root = document.querySelector('#app')
const { button, error, notice } = feedback()
function picture(src, cls) {
  const img = el('img', '', cls)
  img.src = src
  img.draggable = false
  img.alt = '选区图像'
  return img
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
    ['提取文字', api.extractText],
    ['翻译', () => ask('translate')],
    ['问 AI', () => ask('explain')],
    ['标注', () => annotateRegion(rect, bar)],
    [
      '选区取色',
      async () => {
        const image = await api.selectionImage()
        bar.hidden = true
        bar.style.display = 'none'
        pickScreenColor({ image }, rect)
      },
    ],
    ['取消截图', () => api.dismiss()],
  ]) {
    const action = button(name, () => fn())
    action.title = name
    action.setAttribute('aria-label', name)
    action.prepend(
      glyph(
        {
          复制: 'copy',
          保存: 'save',
          贴图置顶: 'pin',
          翻译: 'translate',
          '问 AI': 'ask',
          提取文字: 'ocr',
          标注: 'annotate',
          选区取色: 'color',
          取消截图: 'cancel',
        }[name],
      ),
    )
    bar.append(action)
  }
  void api
    .actions()
    .then((actions) => {
      for (const a of actions) bar.append(button(a.displayName, () => ask('custom', a.id)))
    })
    .catch(error)
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
    if (root.classList.contains('annotating') || bar.contains(e.target) || e.button !== 0) return
    e.preventDefault()
    rect.style.backgroundImage = ''
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
  root.onlostpointercapture = root.onpointercancel = () => {
    if (!start) return
    start = null
    rect.hidden = true
    tip.hidden = false
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
  const body = el('div', '', 'assistant-result')
  const settingsBox = el('div', '', 'result-settings')
  settingsBox.hidden = true
  root.append(body, settingsBox)
  body.append(el('h1', s.image ? '截图助手' : '划词助手'))
  const preview = s.image && picture(s.image, 'preview')
  if (preview) body.append(preview)
  else body.append(el('pre', s.text))
  const prompt = el('textarea')
  prompt.placeholder = '输入问题'
  prompt.setAttribute('aria-label', '问题')
  const row = el('div', '', 'row'),
    output = el('section'),
    history = el('div'),
    controls = el('div', '', 'row result-actions')
  output.hidden = true
  body.append(prompt, row, notice, output)
  output.append(history, controls)
  let focusRoute
  const configure = button('打开 API 设置', async () => {
    body.hidden = true
    settingsBox.hidden = false
    if (focusRoute) {
      await focusRoute(configure.dataset.route)
      return
    }
    const shell = createSettingsShell({
      title: '工具集设置',
      categories: [{ id: 'api', name: 'API 与模型' }],
      active: 'api',
      onSelect: () => {},
      onBack: () => {
        settingsBox.hidden = true
        body.hidden = false
        configure.focus()
      },
    })
    const settingsUI = feedback()
    settingsBox.append(shell.element)
    shell.content.append(settingsUI.notice)
    focusRoute = connectionEditor(shell.content, { ...settingsUI, api }, configure.dataset.route)
  })
  configure.hidden = true
  row.append(configure)
  let copyKind = '最新回答'
  const copyUI = feedback()
  copyUI.notice.hidden = true
  const copy = copyUI.button('复制结果', async () => {
    try {
      await api.copyAnswer()
      delete copyUI.notice.dataset.error
      copyUI.notice.textContent = '已复制' + copyKind
    } catch {
      copyUI.notice.dataset.error = 'true'
      copyUI.notice.textContent = '复制失败，请再试一次'
    }
    copyUI.notice.hidden = false
  })
  const pin = button('窗口置顶', async (button) => {
    const pinned = await api.top()
    button.textContent = pinned ? '窗口已置顶' : '窗口置顶'
    button.title = pinned ? '取消窗口置顶' : '让结果窗口保持在最前面'
    button.setAttribute('aria-pressed', String(pinned))
  })
  pin.title = '让结果窗口保持在最前面'
  pin.setAttribute('aria-pressed', 'false')
  let hasAnswer = false,
    busy = false
  let failed
  const retry = button('重试', () => run(failed.mode, failed.id, failed.question))
  retry.hidden = true
  row.append(retry)
  async function run(mode, id, question = prompt.value) {
    if (busy) return
    if (mode === 'question' && !question.trim()) {
      prompt.focus()
      return
    }
    busy = true
    failed = undefined
    retry.hidden = true
    prompt.readOnly = true
    copyUI.notice.hidden = true
    const requests = [copy, ...row.querySelectorAll('button'), controls.lastElementChild].filter(
      Boolean,
    )
    for (const action of requests) action.disabled = true
    row.setAttribute('aria-busy', 'true')
    configure.hidden = true
    delete notice.dataset.error
    notice.textContent = '正在处理…'
    try {
      const answer = await api.ask({ mode, id, question })
      if (mode !== 'follow') history.replaceChildren()
      if (answer?.blocks) {
        history.append(await layoutTranslation(s.image, answer.blocks))
        preview.hidden = true
      } else {
        if (preview && mode !== 'follow') preview.hidden = false
        history.append(
          el('h2', question || (mode === 'explain' ? '解释' : '回答')),
          el('pre', answer),
        )
      }
      output.hidden = false
      copyKind = mode === 'translate' ? '译文' : '最新回答'
      hasAnswer = true
      if (prompt.value === question) prompt.value = ''
      notice.textContent = ''
    } catch (e) {
      notice.dataset.error = 'true'
      failed = { mode, id, question }
      retry.hidden = false
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
      prompt.readOnly = false
      for (const action of requests) action.disabled = false
      row.removeAttribute('aria-busy')
    }
  }
  row.append(
    button('翻译', () => run('translate')),
    button('问 AI', () => run(prompt.value.trim() ? 'question' : 'explain')),
  )
  try {
    for (const a of await api.actions())
      row.append(button(a.displayName, () => run('custom', a.id)))
  } catch (e) {
    error(e)
  }
  controls.append(
    copy,
    pin,
    button('追问', () => {
      if (hasAnswer && prompt.value.trim()) return run('follow')
      prompt.focus()
    }),
  )
  output.append(copyUI.notice)
  const initial = await api.initial()
  if (initial) await run(initial.mode, initial.id)
}
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  const back = root.querySelector('.result-settings:not([hidden]) button[aria-label="返回"]')
  if (back) back.click()
  else void api.dismiss()
})
api
  .state()
  .then(async (s) => {
    if (s.material) {
      if (s.kind !== 'home') document.body.classList.add('result-window')
      const apply = (m) => {
        document.documentElement.style.setProperty('--material-light', String(m.brightness / 100))
        document.documentElement.style.setProperty(
          '--material-opacity',
          String(1 - m.transparency / 100),
        )
        document.documentElement.style.setProperty('--material-frost', String(m.frost / 100))
      }
      api.onMaterial(apply)
      apply(s.material)
    }
    if (s.kind === 'home') {
      return toolkitHome(s.settings, { api, root, notice, error, button, settingsContents })
    }
    if (s.kind === 'screen') {
      if (s.intent === 'color') pickScreenColor(s)
      else await screenView(s)
      await root.querySelector('img').decode()
      // Wait for the decoded desktop image to reach a painted frame before revealing the overlay.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      await api.screenReady()
      return
    }
    if (s.kind === 'result') return result(s)
    if (s.kind === 'color-result') {
      const rgb =
        'rgb(' +
        s.hex
          .slice(1)
          .match(/../g)
          .map((c) => parseInt(c, 16))
          .join(', ') +
        ')'
      const swatch = el('div', '', 'picked-color')
      swatch.style.backgroundColor = s.hex
      const values = el('div')
      values.append(el('strong', s.hex), el('p', rgb))
      const sample = el('div', '', 'row')
      sample.append(swatch, values)
      const actions = el('div', '', 'row')
      actions.append(
        button('复制 HEX', async () => {
          await api.copyColorResult('hex')
          notice.textContent = '已复制 HEX'
        }),
        button('复制 RGB', async () => {
          await api.copyColorResult('rgb')
          notice.textContent = '已复制 RGB'
        }),
        button('重新取色', () => api.repick()),
      )
      root.append(el('h1', '取色结果'), sample, actions, notice)
      return
    }
    if (s.kind === 'pin') {
      root.className = 'pinned'
      const img = picture(s.image)
      root.append(img)
      try {
        await img.decode()
      } catch {
        await api.pinFailed()
        return
      }
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      await api.pinReady()
      let drag
      root.onpointerdown = (e) => {
        if (e.button !== 0) return
        root.setPointerCapture(e.pointerId)
        drag = [e.screenX, e.screenY]
      }
      root.onpointermove = (e) => {
        if (!drag) return
        const dx = Math.round(e.screenX - drag[0]),
          dy = Math.round(e.screenY - drag[1])
        if (dx || dy) {
          drag = [e.screenX, e.screenY]
          void api.pinMove([dx, dy]).catch(error)
        }
      }
      root.onpointerup = root.onlostpointercapture = () => {
        drag = undefined
      }
      root.addEventListener(
        'wheel',
        (e) => {
          e.preventDefault()
          if (e.deltaY) void api.pinZoom(-Math.sign(e.deltaY)).catch(error)
        },
        { passive: false },
      )
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
