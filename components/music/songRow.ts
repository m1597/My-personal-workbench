import type { MouseEvent, FocusEvent } from 'react'

let doubleClickMs = 500
export function setSongDoubleClickTime(value: number) {
  if (Number.isFinite(value) && value >= 1 && value <= 5000) doubleClickMs = value
}
const selection = new WeakMap<Element, HTMLElement>()
let pendingCredit: AbortController | undefined

function select(row: HTMLElement) {
  const list = row.closest('[data-song-list]') ?? row.closest('ul,ol') ?? row.parentElement
  if (!list) return
  const previous = selection.get(list)
  if (previous !== row) previous?.removeAttribute('data-selected')
  row.dataset.selected = 'true'
  selection.set(list, row)
}

export function cancelCredit() {
  pendingCredit?.abort()
  pendingCredit = undefined
}

function rowTarget(e: MouseEvent<HTMLElement>) {
  const target = e.target
  if (!(target instanceof Element) || !e.currentTarget.contains(target)) return false
  const action = target.closest(
    'button,a,input,select,label,[role=button],[role=menuitem],[data-audio-drag],.track-actions,.search-result-actions',
  )
  return !action || action.hasAttribute('data-song-credit')
}

export function songRow(play: () => void, enabled = true) {
  return {
    'data-song-row': '',
    tabIndex: -1,
    onFocus: (e: FocusEvent<HTMLElement>) => {
      if (enabled && e.target === e.currentTarget) select(e.currentTarget)
    },
    onClick: (e: MouseEvent<HTMLElement>) => {
      if (!enabled || !rowTarget(e)) return
      select(e.currentTarget)
      if (!(e.target as Element).closest('[data-song-credit]')) {
        cancelCredit()
        e.currentTarget.focus({ preventScroll: true })
      }
    },
    onDoubleClick: (e: MouseEvent<HTMLElement>) => {
      if (!enabled || !rowTarget(e)) return
      cancelCredit()
      select(e.currentTarget)
      e.preventDefault()
      play()
    },
  }
}

export function creditClick(e: MouseEvent<HTMLButtonElement>, open: () => void) {
  cancelCredit()
  const button = e.currentTarget
  if (!button.closest('[data-song-row]') || e.detail === 0) {
    open()
    return
  }
  if (e.detail !== 1) return
  const controller = new AbortController()
  pendingCredit = controller
  const options = { capture: true, signal: controller.signal }
  for (const type of ['pointerdown', 'keydown', 'click', 'contextmenu', 'dragstart'])
    document.addEventListener(type, cancelCredit, options)
  window.addEventListener('blur', cancelCredit, { signal: controller.signal })
  const timer = setTimeout(() => {
    cancelCredit()
    if (button.isConnected && button.checkVisibility()) open()
  }, doubleClickMs + 60)
  controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true })
}
