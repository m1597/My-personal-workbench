export function recordShortcut(e: KeyboardEvent, local = true) {
  const parts = [
    e.ctrlKey && 'Ctrl',
    e.altKey && 'Alt',
    e.shiftKey && 'Shift',
    e.metaKey && 'Super',
  ].filter(Boolean)
  const ascii = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(e.code)
  const key =
    ascii?.[1] ??
    ascii?.[2] ??
    e.key
      .replace(/^Arrow/, '')
      .replace(/^ $/, 'Space')
      .replace(/^MediaTrackNext$/, 'MediaNextTrack')
      .replace(/^MediaTrackPrevious$/, 'MediaPreviousTrack')
  if (
    !/^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert|Delete|MediaPlayPause|MediaNextTrack|MediaPreviousTrack)$/.test(
      key,
    )
  )
    return undefined
  if (!local && !parts.length && !/^(F\d+|Media)/.test(key)) return undefined
  return [...parts, key].join('+')
}

export function shortcutInput(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="slider"],[role="menu"],[role="listbox"],[role="tablist"],[role="dialog"]',
      ),
    )
  )
}
