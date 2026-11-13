type Cues = { start: number; end: number; first: number; last: number }
const cache = new Map<string, Promise<Cues | null>>()
const rate = 8000
const hop = rate / 4

async function measure(id: string): Promise<Cues | null> {
  const bytes = await window.music.analysisRecording(id)
  if (!bytes?.length) return null
  const context = new OfflineAudioContext(1, 1, rate)
  const sound = await context.decodeAudioData(new Uint8Array(bytes).buffer)
  const channels = Array.from({ length: sound.numberOfChannels }, (_, i) => sound.getChannelData(i))
  const levels = []
  for (let i = 0; i < sound.length; i += hop) {
    let power = 0
    const count = Math.min(hop, sound.length - i)
    for (const data of channels) for (let j = i; j < i + count; j += 4) power += data[j] ** 2
    levels.push(Math.sqrt(power / (channels.length * Math.ceil(count / 4))))
  }
  const reference = [...levels].sort((a, b) => a - b)[Math.floor(levels.length * 0.9)] || 0
  const audible = Math.max(0.002, reference * 0.05)
  const first = levels.findIndex((v) => v >= audible)
  let last = levels.length - 1
  while (last >= first && levels[last] < audible) last--
  if (first < 0 || last <= first) return null
  const length = Math.min(80, last - first + 1)
  let best = -Infinity,
    at = first
  // Prefer sustained material. A single transient contributes at most the reference level.
  for (let i = first; i + length - 1 <= last; i++) {
    let score = 0
    for (let j = i; j < i + length; j++) score += Math.min(reference || audible, levels[j])
    if (score > best) {
      best = score
      at = i
    }
  }
  return {
    start: at / 4,
    end: Math.min(sound.duration, (at + length) / 4),
    first: first / 4,
    last: Math.min(sound.duration, (last + 1) / 4),
  }
}

export function listeningCues(id: string, identity: string) {
  const key = id + ':' + identity
  let result = cache.get(key)
  if (!result) {
    result = measure(id).catch(() => null)
    cache.set(key, result)
    const oldest = cache.keys().next().value
    if (cache.size > 16 && oldest) cache.delete(oldest)
  }
  return result
}
