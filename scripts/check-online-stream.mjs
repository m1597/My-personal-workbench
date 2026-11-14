import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import https from 'node:https'
import { syncBuiltinESMExports } from 'node:module'
import { PassThrough } from 'node:stream'
import { setTimeout as wait } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { onlineStream } from '../examples/component-host/online-stream.mjs'
import { writeFixtureRecording } from './music-recording-fixture.mjs'
import { MusicStore } from '../components/music/store.mjs'

async function checkRestoredTrial(profile) {
  const { registerLx } = await import('../dist/component-prototype/host/lx-music.mjs')
  const store = new MusicStore(path.join(profile, 'trial-library'))
  const code = `// @name Trial identity fixture
    lx.on('request', ({action, info}) => {
      const row = {name:'相同歌名',singer:'艺人',id:'target-id',trial:true,isPreview:true,
        freeTrialInfo:{start:12,end:24}, otherPrivateField:'https://example.com/temporary-secret'}
      if(action === 'search') {
        const others = Array.from({length:50},(_,i)=>({...row,id:'other-'+i}))
        if(info.keyword === '原查询') return {items:[row],hasMore:false}
        if(info.page === 1) return {items:others,hasMore:true}
        return {items:[row],hasMore:false}
      }
      const r = info.musicInfo
      return r.id === 'target-id' && r.trial && r.isPreview && r.freeTrialInfo?.end === 24
        ? 'https://1.1.1.1/trial' : 'https://1.1.1.1/other-segment'
    })
    lx.send('inited',{sources:{wy:{actions:['search','musicUrl'],qualitys:['320k']}}})`
  const src = { platform: 'wy', search: true, quality: ['320k'], permissionsVersion: 1 }
  store.set(
    'lx-source',
    JSON.stringify({ ...src, platforms: { wy: src }, catalogVersion: 2, code, name: 'trial' }),
  )
  const handlers = new Map()
  const newSession = () =>
    registerLx(
      (key, fn) => handlers.set(key, fn),
      () => store,
    )
  const first = newSession()
  const { items } = await handlers.get('lxSearch')({ title: '原查询', artist: '' }, 'wy')
  const id = handlers.get('rememberOnline')(items[0].key, '320k')
  const signal = new AbortController().signal
  assert.equal(
    await first.onlinePlayback(id, id).connect(signal, async (url) => url),
    'https://1.1.1.1/trial',
  )
  first.close()
  store.db
    .prepare('UPDATE online_recording_sources SET query=? WHERE id=?')
    .run(JSON.stringify({ title: '重排的目录', artist: '' }), id)
  const stored = store.db
    .prepare('SELECT identifiers FROM online_recording_sources WHERE id=?')
    .get(id)
  assert.ok(!stored.identifiers.includes('temporary-secret'))
  const restarted = newSession()
  assert.equal(
    await restarted.onlinePlayback(id, id).connect(signal, async (url) => url),
    'https://1.1.1.1/trial',
  )
  restarted.close()
  store.db.close()
}

if (!process.versions.electron) {
  const { default: executable } = await import('electron')
  await mkdir('tmp', { recursive: true })
  const profile = await mkdtemp(path.resolve('tmp/online-stream-'))
  await writeFixtureRecording(path.join(profile, 'recording.wav'), 4, 180)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawnSync(
    executable,
    [fileURLToPath(import.meta.url), '--user-data-dir=' + profile, '--mute-audio'],
    {
      env,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 45000,
    },
  )
  assert.equal(child.status, 0, child.stdout + child.stderr + (child.error?.message ?? ''))
  console.log(child.stdout.trim())
} else {
  const { app, BrowserWindow, protocol, session } = await import('electron')
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'fitbay-audio',
      privileges: {
        standard: true,
        secure: true,
        stream: true,
        supportFetchAPI: true,
      },
    },
  ])
  void app.whenReady().then(async () => {
    const bytes = await readFile(path.join(app.getPath('userData'), 'recording.wav'))
    const requests = []
    let expired = true
    let addresses = 0
    const grant = {
      url: 'fitbay-audio://track/test',
      controller: new AbortController(),
      address: async () => 'https://1.1.1.1/media/' + ++addresses,
    }
    https.request = (_url, options, receive) => {
      const req = new EventEmitter()
      req.end = () => {
        const range = options.headers.Range
        const [, first, last] = /^bytes=(\d+)-(\d*)$/.exec(range) || []
        const start = Number(first ?? 0)
        const end = last ? Math.min(Number(last), bytes.length - 1) : bytes.length - 1
        const res = new PassThrough()
        res.setTimeout = () => {}
        res.on('error', () => {})
        res.statusCode = expired ? 403 : start >= bytes.length ? 416 : range ? 206 : 200
        expired = false
        res.headers = {
          'content-type': 'audio/wav',
          'accept-ranges': 'bytes',
          'content-length': String(end - start + 1),
        }
        if (res.statusCode === 206)
          res.headers['content-range'] = 'bytes ' + start + '-' + end + '/' + bytes.length
        if (res.statusCode === 416) res.headers['content-range'] = 'bytes */' + bytes.length
        const item = { range, sent: 0, status: res.statusCode, closed: false }
        requests.push(item)
        res.on('close', () => {
          item.closed = true
        })
        const abort = () => res.destroy()
        options.signal.addEventListener('abort', abort, { once: true })
        res.once('close', () => options.signal.removeEventListener('abort', abort))
        receive(res)
        if (![200, 206].includes(res.statusCode) || options.method === 'HEAD') return
        void (async () => {
          for (let offset = start; offset <= end && !res.destroyed; offset += 8192) {
            const chunk = bytes.subarray(offset, Math.min(end + 1, offset + 8192))
            item.sent += chunk.length
            res.write(chunk)
            await wait(45)
          }
          res.end()
        })()
      }
      return req
    }
    syncBuiltinESMExports()
    try {
      await checkRestoredTrial(app.getPath('userData'))
      for (const [range, status] of [
        ['bytes=100-149', 206],
        ['bytes=999999999-', 416],
        ['bytes=2-4,8-10', 416],
      ]) {
        const result = await onlineStream(new Request(grant.url, { headers: { range } }), grant)
        assert.equal(result.status, status)
        if (status === 206) {
          assert.equal(result.headers.get('content-range'), 'bytes 100-149/' + bytes.length)
          assert.deepEqual(Buffer.from(await result.arrayBuffer()), bytes.subarray(100, 150))
        }
      }
      assert.equal(requests[0].status, 403)
      assert.equal(requests[1].range, requests[0].range)
      const head = await onlineStream(new Request(grant.url, { method: 'HEAD' }), grant)
      assert.equal(head.body, null)
      assert.equal(head.headers.get('content-length'), String(bytes.length))
      session.defaultSession.protocol.handle('fitbay-audio', (req) => onlineStream(req, grant))
      const win = new BrowserWindow({
        show: false,
        webPreferences: { autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false },
      })
      win.webContents.setAudioMuted(true)
      await win.loadURL('data:text/html,<audio muted></audio>')
      const time = await win.webContents.executeJavaScript(`(async()=>{
      const a=document.querySelector('audio'); a.src='fitbay-audio://track/test'; await a.play()
      while(a.currentTime<0.25) await new Promise(done=>setTimeout(done,50))
      return a.currentTime
    })()`)
      const ongoing = requests.find((r) => r.sent > 50 && r.sent < bytes.length && !r.closed)
      assert.ok(ongoing, '播放时上游应仍在发送音频')
      await win.webContents.executeJavaScript("document.querySelector('audio').pause()")
      grant.controller.abort()
      await wait(120)
      assert.ok(ongoing.closed)
      assert.ok(ongoing.sent < bytes.length)
      console.log(
        JSON.stringify({
          secondsPlaying: time,
          received: ongoing.sent,
          total: bytes.length,
          range: ongoing.range,
          closedAfterPause: ongoing.closed,
          expiredAddressRetried: true,
        }),
      )
      win.destroy()
      app.exit(0)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
  })
}
