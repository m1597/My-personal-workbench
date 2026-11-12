const { ipcRenderer } = require('electron')
window.addEventListener('DOMContentLoaded', () => {
  const lock = document.querySelector('button')
  lock.addEventListener('click', () => ipcRenderer.send('lyric-lock'))
  ipcRenderer.on('lyric-locked', (_, locked) => {
    document.body.classList.toggle('locked', locked)
  })
  ipcRenderer.on('lyric-controls', (_, visible) => {
    document.body.toggleAttribute('data-pointer-inside', visible)
  })
  ipcRenderer.on('lyric-line', (_, line) => {
    document.querySelector('strong').textContent = line
  })
})
