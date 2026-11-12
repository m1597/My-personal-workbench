const { ipcRenderer } = require('electron')
window.addEventListener('DOMContentLoaded', () => {
  const lock = document.querySelector('button')
  lock.addEventListener('click', () => {
    const locked = document.body.classList.toggle('locked')
    lock.title = locked ? '解锁' : '锁定'
    lock.setAttribute('aria-label', lock.title)
    lock.setAttribute('aria-pressed', String(locked))
  })
  ipcRenderer.on('lyric-controls', (_, visible) => {
    document.body.toggleAttribute('data-pointer-inside', visible)
  })
  ipcRenderer.on('lyric-line', (_, line) => {
    document.querySelector('strong').textContent = line
  })
})
