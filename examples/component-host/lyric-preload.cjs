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
  const label = document.querySelector('.lyric-groups')
  ipcRenderer.on('lyric-line', (_, groups, size) => {
    const previous = new Map(
      Array.from(label.children, (row) => [
        row.dataset.id,
        { y: row.getBoundingClientRect().top, opacity: getComputedStyle(row).opacity },
      ]),
    )
    const was = label.firstElementChild?.dataset.id
    label.style.fontSize = `${size}px`
    const rows = groups.map(({ id, original, translation }) => {
      const row = document.createElement('span')
      row.className = 'lyric-group'
      row.dataset.id = id
      for (const [content, className] of [
        [original, 'lyric-original'],
        [translation, 'lyric-translation'],
      ]) {
        if (!content) continue
        const line = document.createElement('span')
        line.className = className
        line.textContent = content
        row.append(line)
      }
      return row
    })
    label.replaceChildren(...rows)
    const measured = label.scrollHeight + 12
    ipcRenderer.send('lyric-height', measured)
    if (!was || was === groups[0]?.id || matchMedia('(prefers-reduced-motion: reduce)').matches)
      return
    for (const row of rows) {
      const old = previous.get(row.dataset.id)
      const rect = row.getBoundingClientRect()
      const dy = old ? old.y - rect.top : rect.height
      row.animate(
        [
          { transform: `translateY(${dy}px)`, opacity: old?.opacity ?? 0 },
          { transform: 'translateY(0)', opacity: getComputedStyle(row).opacity },
        ],
        { duration: 300, easing: 'ease-out' },
      )
    }
  })
})
