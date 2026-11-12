const { ipcRenderer } = require('electron')
window.addEventListener('DOMContentLoaded', () => {
  const lock = document.querySelector('button')
  lock.addEventListener('click', () => {
    const locked = document.body.classList.toggle('locked')
    lock.title = locked ? '解锁' : '锁定'
    lock.setAttribute('aria-label', lock.title)
    lock.setAttribute('aria-pressed', String(locked))
  })
  ipcRenderer.on('lyric-line', (_, line) => {
    document.querySelector('strong').textContent = line || '暂无同步歌词'
  })
})
