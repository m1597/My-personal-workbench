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
