import { BrowserWindow, session, net } from 'electron'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
// Let Chromium decode the same bytes FitBay will play before publishing the file.
export async function verifyAudio(file, signal) {
  signal.throwIfAborted()
  const isolated = session.fromPartition('lx-verify-' + randomUUID(), { cache: false })
  const base = 'https://verify.invalid/'
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
    return net.fetch(pathToFileURL(file).href, { headers })
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
      await a.play(); return await new Promise(resolve=>{
        const check=()=>{if(a.currentTime>0 && a.webkitAudioDecodedByteCount>0)resolve(true)};
        a.ontimeupdate=check; a.onended=()=>resolve(a.webkitAudioDecodedByteCount>0);a.onerror=()=>resolve(false);check()
      })
    })()`,
        true,
      ),
    ])
    if (!played) throw Error()
  } catch {
    signal.throwIfAborted()
    throw Error('音频无法解码，请选择其他版本')
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', destroy)
    destroy()
    isolated.protocol.unhandle('https')
  }
}
