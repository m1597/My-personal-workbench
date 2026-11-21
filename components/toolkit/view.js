import { settingsContents } from './settings-view.js'
import { el, field, feedback } from './ui-dom.js'
import { toolkitHome, glyph } from './tools-view.js'
import { measureScreen, annotateRegion } from './screen-tools.js'
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
    ['截图翻译', () => ask('translate')],
    ['向模型提问', () => ask('question')],
    ['标注', () => annotateRegion(rect, bar)],
    [
      '测距与取色',
      async () => {
        const image = await api.selectionImage(),
          bounds = rect.getBoundingClientRect()
        const { onpointerup, onpointermove, onpointerdown } = root
        root.onpointerup = null
        bar.hidden = true
        measureScreen({ image }, bounds, () => {
          root.className = 'screen'
          Object.assign(root, { onpointerup, onpointermove, onpointerdown })
          bar.hidden = false
        })
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
          截图翻译: 'translate',
          向模型提问: 'ask',
          提取文字: 'ocr',
          标注: 'annotate',
          测距与取色: 'measure',
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
      if (s.intent === 'annotate') {
        s.intent = null
        await annotateRegion(rect, bar)
      }
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
  .then(async (s) => {
    if (s.kind === 'home')
      return toolkitHome(s.settings, { api, root, notice, error, button, settingsContents })
    if (s.kind === 'screen') {
      if (s.intent === 'measure') measureScreen(s)
      else await screenView(s)
      await root.querySelector('img').decode()
      await api.screenReady()
      return
    }
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
