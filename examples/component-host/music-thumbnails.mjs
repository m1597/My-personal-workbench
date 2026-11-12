import { nativeImage } from 'electron'
import { fileURLToPath } from 'node:url'

export function musicThumbnails(send) {
  let owner
  let icons
  let applied
  let playback
  function render() {
    if (!owner || owner.isDestroyed() || !playback || applied === playback) return
    if (!icons) {
      const sheet = nativeImage.createFromPath(
        fileURLToPath(new URL('./transport-icons.png', import.meta.url)),
      )
      icons = ['previous', 'play', 'pause', 'next'].map((_, i) =>
        sheet.crop({ x: i * 32, y: 0, width: 32, height: 32 }),
      )
    }
    const target = owner
    const button = (action, tooltip, icon, enabled) => ({
      icon: icons[icon],
      tooltip,
      flags: enabled ? [] : ['disabled'],
      click: () => {
        if (owner === target) send(action)
      },
    })
    if (
      owner.setThumbarButtons([
        button('previous', '上一首', 0, playback.previous),
        button(
          'toggle',
          playback.paused ? '播放' : '暂停',
          playback.paused ? 1 : 2,
          playback.toggle,
        ),
        button('next', '下一首', 3, playback.next),
      ])
    )
      applied = playback
  }
  return {
    owner(window) {
      if (window !== owner) {
        if (owner && !owner.isDestroyed()) owner.setThumbarButtons([])
        owner = window
        applied = undefined
      }
      render()
    },
    update(state) {
      if (
        !state ||
        !['paused', 'previous', 'toggle', 'next'].every((k) => typeof state[k] === 'boolean')
      )
        return
      playback = state
      render()
    },
    reset() {
      this.owner(undefined)
      playback = undefined
    },
  }
}
