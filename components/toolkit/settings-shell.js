// Shared by the standalone DOM renderer, the docked shadow root and the React adapter.
// Settings outline from Lucide (ISC), matching the Music toolbar.
const gearPath =
  'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915'
const icon = (path, center = '') =>
  `<svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/>${center}</svg>`
const controls = `
button.fitbay-settings-action {
 display:inline-flex;align-items:center;justify-content:center;width:30px;height:28px;
 min-width:0;padding:0;color:var(--text-secondary);background:transparent;
 border:1px solid transparent;border-radius:var(--radius-4);cursor:pointer
}
button.fitbay-settings-action:hover {background:var(--hover);color:var(--text)}
button.fitbay-settings-action:focus-visible,.fitbay-settings-shell button:focus-visible {outline:2px solid var(--accent);outline-offset:-2px}
`
function sheet(css) {
  const style = document.createElement('style')
  style.textContent = css
  return style
}
function button(label, graphic, callback) {
  const node = document.createElement('button')
  node.type = 'button'
  node.className = 'fitbay-settings-action'
  node.title = label
  node.setAttribute('aria-label', label)
  node.innerHTML = graphic
  node.addEventListener('click', callback)
  return node
}
export function createSettingsGear({ label, onClick }) {
  const gear = button(label, icon(gearPath, '<circle cx="12" cy="12" r="3"/>'), onClick)
  gear.append(sheet(controls))
  return gear
}
export function createSettingsShell({ title, categories, active, onSelect, onBack }) {
  const element = document.createElement('div')
  element.className = 'fitbay-settings-shell'
  element.append(
    sheet(
      controls +
        `
.fitbay-settings-shell {
  display:flex;flex-direction:column;container-type:inline-size;min-width:0;min-height:0;height:100%;
  width:100%;overflow:hidden;box-sizing:border-box;background:transparent;color:var(--text);font-family:var(--font-ui)
}
.fitbay-settings-shell > header {display:flex;align-items:center;justify-content:flex-start;gap:8px;min-height:40px;padding:0 10px;border-bottom:1px solid var(--stroke)}
.fitbay-settings-shell > header h2 {font-size:var(--font-size-heading);margin:0}
.fitbay-settings-body {display:grid;grid-template-columns:clamp(150px,19%,240px) minmax(0,1fr);min-height:0;flex:1}
.fitbay-settings-body > nav {display:flex;flex-direction:column;gap:2px;overflow:auto;padding:8px;border-right:1px solid var(--stroke)}
.fitbay-settings-body > nav button,.fitbay-category-toggle {display:flex;align-items:center;gap:7px;min-height:28px;padding:3px 8px;text-align:start;color:var(--text);font:inherit;border:1px solid transparent;border-radius:4px;background:transparent}
.fitbay-settings-body > nav button:hover,.fitbay-category-toggle:hover {background:var(--hover)}
.fitbay-settings-body > nav button[aria-pressed=true] {background:var(--accent-soft);color:var(--accent)}
.fitbay-settings-body > .fitbay-settings-content {overflow:auto;min-width:0;min-height:0;padding:12px 16px}
.fitbay-category-toggle {display:none}
@container(max-width:520px){
 .fitbay-category-toggle {display:inline-flex;margin-left:auto}
 .fitbay-settings-body {display:flex;flex-direction:column}
 .fitbay-settings-body > nav {display:none;max-height:40%;border-right:0;border-bottom:1px solid var(--stroke)}
 .fitbay-settings-body > nav[data-open=true] {display:flex}
 .fitbay-settings-content {flex:1}
}
`,
    ),
  )
  const header = document.createElement('header')
  const heading = document.createElement('h2')
  heading.textContent = title
  const back = button('返回', icon('m12 19-7-7 7-7M5 12h14'), onBack)
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'fitbay-category-toggle'
  toggle.textContent = '设置分类'
  header.append(back, heading, toggle)
  const body = document.createElement('div')
  body.className = 'fitbay-settings-body'
  const nav = document.createElement('nav')
  nav.setAttribute('aria-label', '设置分类')
  const content = document.createElement('div')
  content.className = 'fitbay-settings-content'
  const icons = new Map()
  const buttons = new Map()
  function expand(open) {
    nav.dataset.open = String(open)
    toggle.setAttribute('aria-expanded', String(open))
  }
  expand(false)
  toggle.onclick = () => expand(nav.dataset.open !== 'true')
  function select(id) {
    for (const [key, item] of buttons) item.setAttribute('aria-pressed', String(key === id))
    if (active !== id) content.scrollTop = 0
    active = id
  }
  for (const item of categories) {
    const action = document.createElement('button')
    action.type = 'button'
    const glyph = document.createElement('span')
    glyph.style.display = 'contents'
    icons.set(item.id, glyph)
    action.append(glyph, item.name)
    action.onclick = () => {
      select(item.id)
      expand(false)
      onSelect(item.id)
    }
    buttons.set(item.id, action)
    nav.append(action)
  }
  select(active)
  body.append(nav, content)
  element.append(header, body)
  return { element, content, select, icons }
}
