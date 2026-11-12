import { BrowserWindow, session, net } from 'electron'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
export class AudioDecodeError extends Error {}
// Let Chromium decode the same bytes FitBay will play before publishing the file.
export async function verifyAudio(file, signal, fingerprintDuration) {
  signal.throwIfAborted()
  const isolated = session.fromPartition('lx-verify-' + randomUUID(), { cache: false })
  const base = 'https://verify.invalid/'
  let fileError
  isolated.protocol.handle('https', async (request) => {
    if (request.url === base)
      return new Response('<audio muted src="/audio"></audio>', {
        headers: {
          'Content-Type': 'text/html',
          'Content-Security-Policy': "default-src 'none'; media-src 'self'; connect-src 'self'",
        },
      })
    if (request.url !== base + 'audio') return new Response(null, { status: 404 })
    const headers = {}
    const range = request.headers.get('Range')
    if (range) headers.Range = range
    try {
      const response = await net.fetch(pathToFileURL(file).href, { headers })
      if (!response.ok) fileError = Error('无法读取待验证的本地文件')
      return response
    } catch (error) {
      fileError = error
      return Response.error()
    }
  })
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      session: isolated,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  })
  let fail
  const stopped = new Promise((_, reject) => {
    fail = reject
  })
  const destroy = () => {
    if (!win.isDestroyed()) win.destroy()
    fail(Error('验证已结束'))
  }
  const timer = setTimeout(destroy, fingerprintDuration ? 60000 : 10000)
  signal.addEventListener('abort', destroy, { once: true })
  try {
    await Promise.race([win.loadURL(base), stopped])
    if (fingerprintDuration)
      return await Promise.race([
        stopped,
        win.webContents.executeJavaScript(
          '(' + sampleRecording.toString() + ')(' + (fingerprintDuration < 4) + ')',
        ),
      ])
    const played = await Promise.race([
      stopped,
      win.webContents.executeJavaScript(
        `(async()=>{
      const a=document.querySelector('audio'); a.muted=true;
      const failure=()=>[3,4].includes(a.error?.code)?'invalid':'unavailable';
      try{await a.play()}catch{return failure()} return await new Promise(resolve=>{
        const check=()=>{if(a.currentTime>0 && a.webkitAudioDecodedByteCount>0)resolve('played')};
        a.ontimeupdate=check; a.onended=()=>resolve(a.webkitAudioDecodedByteCount>0?'played':'invalid');a.onerror=()=>resolve(failure());check()
      })
    })()`,
        true,
      ),
    ])
    if (fileError) throw fileError
    if (played === 'invalid') throw new AudioDecodeError('此源返回的音频无法解码')
    if (played !== 'played') throw Error('本地音频验证未完成')
  } catch (error) {
    signal.throwIfAborted()
    throw error
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', destroy)
    destroy()
    isolated.protocol.unhandle('https')
  }
}

// Distributed waveforms preserve timing and phase across a codec or tag change.
// Each window is normalized independently to tolerate gain differences.
async function sampleRecording(short) {
  const context = new OfflineAudioContext(1, 1, 8000)
  const data = await (await fetch('/audio')).arrayBuffer()
  const audio = await (short ? new OfflineAudioContext(1, 1, 48000) : context).decodeAudioData(data)
  if (audio.duration < 4) {
    const digests = []
    for (let ch = 0; ch < audio.numberOfChannels; ch++) {
      const sha = await crypto.subtle.digest('SHA-256', audio.getChannelData(ch))
      digests.push(Array.from(new Uint8Array(sha)).join('.'))
    }
    return { duration: audio.duration, pcm: digests.join('/') }
  }
  const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i))
  const windows = []
  for (let n = 0; n < 14; n++) {
    const start = Math.floor(((audio.length - 4096) * n) / 13 / 4) * 4
    const values = []
    let peak = 0
    for (let i = 0; i < 1024; i++) {
      let sum = 0
      for (const samples of channels) for (let k = 0; k < 4; k++) sum += samples[start + 4 * i + k]
      values.push(sum)
      peak = Math.max(peak, Math.abs(sum))
    }
    windows.push(
      peak < 0.005
        ? ''
        : btoa(String.fromCharCode(...values.map((x) => 128 + Math.round((126 * x) / peak)))),
    )
  }
  // Continuous 32 ms low/mid/high energy envelopes include the intro, tail and
  // everything between the phase-sensitive windows. Retain channels separately.
  function pack(values) {
    const chunks = []
    for (let i = 0; i < values.length; i += 0x4000)
      chunks.push(String.fromCharCode(...values.slice(i, i + 0x4000)))
    return btoa(chunks.join(''))
  }
  const wave = []
  const envelopes = channels.map((samples, channel) => {
    const frames = []
    let blockSum = 0
    let low = 0,
      mid = 0,
      energy = [0, 0, 0]
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i]
      low += 0.12 * (sample - low)
      mid += 0.64 * (sample - mid)
      if (channel === 0) {
        blockSum += low
        if ((i + 1) % 16 === 0) {
          const amplitude = blockSum / 16
          wave.push(
            128 +
              Math.round(126 * Math.sign(amplitude) * Math.sqrt(Math.min(1, Math.abs(amplitude)))),
          )
          blockSum = 0
        }
      }
      energy[0] += low * low
      energy[1] += (mid - low) ** 2
      energy[2] += (sample - mid) ** 2
      if ((i + 1) % 256 === 0) {
        for (const e of energy)
          frames.push(
            Math.max(0, Math.min(255, Math.round(180 + 20 * Math.log10(e / 256 + 1e-12)))),
          )
        energy = [0, 0, 0]
      }
    }
    return pack(frames)
  })
  return { duration: audio.duration, windows, envelopes, wave: pack(wave) }
}
