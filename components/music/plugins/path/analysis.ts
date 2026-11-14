export type Features = [number, number, number]
export async function analyze(id: string): Promise<Features | undefined> {
  const bytes = await window.music.analysisRecording(id)
  if (!bytes?.length) return
  const ctx = new OfflineAudioContext(1, 1, 8000)
  const sound = await ctx.decodeAudioData(new Uint8Array(bytes).buffer)
  const windows = Math.min(120, Math.ceil(sound.length / 512))
  const levels = []
  let highPower = 0
  let totalPower = 0
  for (let i = 0; i < windows; i++) {
    const at = Math.floor((i / windows) * Math.max(0, sound.length - 512))
    const end = Math.min(sound.length, at + 512)
    let power = 0
    for (let ch = 0; ch < sound.numberOfChannels; ch++) {
      const samples = sound.getChannelData(ch)
      for (let j = at; j < end; j++) {
        power += samples[j] ** 2
        if (j > at) highPower += (samples[j] - samples[j - 1]) ** 2
      }
    }
    totalPower += power
    levels.push(Math.sqrt(power / ((end - at) * sound.numberOfChannels)))
  }
  if (!totalPower) return
  levels.sort((a, b) => a - b)
  const median = levels[Math.floor(levels.length * 0.5)]
  const peak = levels[Math.floor(levels.length * 0.9)]
  return [
    Math.max(0, Math.min(1, (20 * Math.log10(peak + 1e-8) + 60) / 60)),
    Math.sqrt(highPower / totalPower) / 2,
    (peak - median) / (peak + 1e-8),
  ]
}

export function transitionQueue(
  features: Map<string, Features>,
  start: string,
  end: string,
  count: number,
) {
  const a = features.get(start),
    b = features.get(end)
  if (!a || !b) throw Error('起点或终点无法分析。请选择 15 分钟以内、24 MiB 以内的可用本地录音。')
  const candidates = new Map(features)
  candidates.delete(start)
  candidates.delete(end)
  const steps = Math.min(count, candidates.size)
  const queue = [start]
  for (let i = 1; i <= steps; i++) {
    const target = a.map((value, k) => value + ((b[k] - value) * i) / (steps + 1))
    let best = ''
    let distance = Infinity
    for (const [id, values] of candidates) {
      const score = values.reduce((sum, v, k) => sum + (v - target[k]) ** 2, 0)
      if (score < distance) {
        best = id
        distance = score
      }
    }
    queue.push(best)
    candidates.delete(best)
  }
  return [...queue, end]
}
