/** Measure decoded playback within one play, including pauses and repeated passages. */
export function observeListening(audio: HTMLAudioElement, heard: (url: string) => void) {
  let seconds = 0
  let reported = false
  let position: number | undefined
  let started = 0
  const intervals: [number, number][] = []
  const begin = () => {
    position = audio.currentTime
    started = performance.now()
  }
  const suspend = () => {
    position = undefined
  }
  const sample = () => {
    if (position === undefined || audio.seeking) return
    const elapsed = (performance.now() - started) / 1000
    const advance = audio.currentTime - position
    if (advance > 0 && advance <= elapsed * audio.playbackRate + 0.1) {
      seconds += advance
      if (audio.duration <= 30 && !reported) {
        const last = intervals.at(-1)
        if (last && last[1] === position) last[1] = audio.currentTime
        else intervals.push([position, audio.currentTime])
      }
    }
    begin()
    if (!reported && seconds >= 30) report()
  }
  const report = () => {
    reported = true
    heard(audio.currentSrc)
  }
  const stop = () => {
    sample()
    suspend()
  }
  const reset = () => {
    suspend()
    seconds = 0
    reported = false
    intervals.length = 0
  }
  const ended = () => {
    stop()
    if (!reported && audio.duration <= 30 && intervals.length) {
      let covered = 0
      for (const [from, to] of intervals.sort((a, b) => a[0] - b[0])) {
        if (from > covered + 0.01) break
        covered = Math.max(covered, to)
      }
      if (covered > 0 && covered >= audio.duration - 0.01) report()
    }
    reset()
  }
  const handlers = {
    playing: begin,
    timeupdate: sample,
    pause: stop,
    waiting: stop,
    seeking: suspend,
    ended,
    emptied: reset,
    loadstart: reset,
  }
  for (const [event, fn] of Object.entries(handlers)) audio.addEventListener(event, fn)
  return () => {
    for (const [event, fn] of Object.entries(handlers)) audio.removeEventListener(event, fn)
  }
}
