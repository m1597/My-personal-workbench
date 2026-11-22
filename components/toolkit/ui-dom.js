export const el = (tag, text, cls) => {
  const n = document.createElement(tag)
  if (text) n.textContent = text
  if (cls) n.className = cls
  return n
}
export function field(parent, label, value, type = 'text') {
  const wrap = el('label', label),
    input = el('input')
  input.type = type
  input.value = value
  wrap.append(input)
  parent.append(wrap)
  return input
}

export function feedback() {
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
  return { button, error, notice }
}

// The control is mounted only after its actual document or pane shadow root is known.
class ToolkitChoice extends HTMLElement {
  connectedCallback() {
    this.refresh()
  }
  disconnectedCallback() {
    const previous = this.control
    this.control = undefined
    if (previous) queueMicrotask(() => previous.dispose())
  }
  refresh() {
    if (!this.isConnected) return
    const props = {
      'aria-label': this.label,
      value: this.value,
      choices: this.choices,
      disabled: this.disabled,
      onChange: (value) => {
        this.set({ value })
        this.dispatchEvent(new Event('input', { bubbles: true }))
        this.dispatchEvent(new Event('change', { bubbles: true }))
      },
    }
    if (this.control) this.control.render(props)
    else this.control = this.mount(this, props)
  }
  set(next) {
    Object.assign(this, next)
    this.refresh()
  }
}
if (!customElements.get('fitbay-toolkit-choice'))
  customElements.define('fitbay-toolkit-choice', ToolkitChoice)
export function choice(label, options, mount = window.FitBayRecorder?.mountChoice) {
  const node = document.createElement('fitbay-toolkit-choice')
  node.set({
    label,
    mount,
    choices: options.map(([value, label]) => ({ value, label })),
    value: options[0]?.[0] || '',
  })
  return node
}
