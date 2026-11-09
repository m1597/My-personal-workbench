let count = 0
const start = performance.now()
const bootId = crypto.randomUUID()
document.body.dataset.bootId = bootId
const element = (id) => document.getElementById(id)
element('increment').addEventListener('click', () => {
  element('count').textContent = String(++count)
})
setInterval(() => {
  element('elapsed').textContent = String(Math.floor((performance.now() - start) / 1000))
}, 250)
let mode = 'standalone'
function render(state) {
  document.documentElement.dataset.theme = state.theme
  mode = state.mode
  element('mode').textContent = mode === 'docked' ? '已停靠' : '独立窗口'
  element('session').textContent = `会话 ${state.sessionId}`
  element('transfer').textContent = mode === 'docked' ? '分离窗口' : '加入工作台'
}
window.sampleHost.subscribe(render)
window.sampleHost.hello({ protocol: '0.1' }).then(render)
element('transfer').addEventListener('click', async () => {
  element('transfer').disabled = true
  try {
    const result = await window.sampleHost.transfer(mode === 'docked' ? 'detach' : 'attach')
    if (!result.ok) element('error').textContent = result.error
  } finally {
    element('transfer').disabled = false
  }
})
