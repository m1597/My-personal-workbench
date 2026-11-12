import { BrowserWindow, session, net } from 'electron'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
export class AudioDecodeError extends Error {}
// Let Chromium decode the same bytes FitBay will play before publishing the file.
export async function verifyAudio(file, signal) {
  signal.throwIfAborted()
  const isolated = session.fromPartition('lx-verify-' + randomUUID(), { cache: false })
  const base = 'https://verify.invalid/'
  let fileError
  isolated.protocol.handle('https', async (request) => {
    if (request.url === base)
      return new Response('<audio muted src="/audio"></audio>', {
        headers: {
          'Content-Type': 'text/html',
          'Content-Security-Policy': "default-src 'none'; media-src 'self'",
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
  const timer = setTimeout(destroy, 10000)
  signal.addEventListener('abort', destroy, { once: true })
  try {
    await Promise.race([win.loadURL(base), stopped])
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
