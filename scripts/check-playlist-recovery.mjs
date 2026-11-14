import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { _electron as electron, expect } from '@playwright/test'
import { recording } from '../components/music/offline-source.mjs'
import { MusicStore } from '../components/music/store.mjs'
import { sourceCatalog } from '../examples/component-host/lx-source-catalog.mjs'
import { offlineSourceRepository } from './music-source-fixture.mjs'

const root = await mkdtemp(path.resolve('tmp/playlist-recovery-')),
  profile = path.join(root, 'profile')
const tone = path.join(root, 'audio.wav')
await writeFile(tone, recording('fitbay-tone-1'))
const titles = ['轻云', '细雨', '晚风', '归途']
function script(role) {
  return `// @name ${role}
lx.on('request',({action,info})=>{
const role=${JSON.stringify(role)}, titles=${JSON.stringify(titles)};
if(action==='search'){
const title=titles.find(t=>info.keyword.includes(t));
if(!title)return [];
const live=role==='备用' && title==='晚风';
const row={name:title+(live?' (Live)':''),singer:'夹具艺人',albumName:'夹具专辑',id:title+(live?'live':''),durationSeconds:live?200:20};
return {hasMore:false,items:live?[row,{...row,id:title+'otherLive',durationSeconds:302}]:[row]};
}
const id=info.musicInfo.id;
if(role==='原源' || !(role==='备用'&&['轻云','归途','晚风live'].includes(id) || role==='新增'&&id==='细雨'))return 'https://1.1.1.1/fail';
return 'https://1.1.1.1/audio/'+encodeURIComponent(id)+'?issued='+Date.now();
});lx.send('inited',{sources:{wy:{actions:['musicUrl','search'],qualitys:['128k']}}})`
}
const store = new MusicStore(path.join(profile, 'fitbay-music'))
const bank = sourceCatalog(store.db),
  props = { platform: 'wy', search: true, quality: ['128k'], permissionsVersion: 1 }
for (const name of ['原源', '备用'])
  bank.install(
    { ...props, code: script(name), name, catalogVersion: 2, platforms: { wy: props } },
    null,
    name === '原源',
  )
store.db.close()
const app = await electron.launch({
  args: [
    path.resolve('dist/component-prototype/host'),
    '--mode=music',
    '--mute-audio',
    '--user-data-dir=' + profile,
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  await offlineSourceRepository(app)
  await app.evaluate(
    ({ app }, { tone, code }) => {
      if (!app.commandLine.hasSwitch('mute-audio')) throw Error('需要静音')
      const https = process.getBuiltinModule('node:https'),
        fs = process.getBuiltinModule('node:fs'),
        { Readable } = process.getBuiltinModule('node:stream'),
        { EventEmitter } = process.getBuiltinModule('node:events')
      const previous = https.request
      globalThis.testPlaybackEvents = []
      https.request = (url, options, done) => {
        if (url.hostname !== '1.1.1.1') return previous(url, options, done)
        const pathname = decodeURIComponent(url.pathname)
        globalThis.testPlaybackEvents.push(pathname)
        if (pathname === '/audio/轻云') {
          globalThis.issuedURLs ??= []
          globalThis.issuedURLs.push(url.href)
        }
        const body = pathname.startsWith('/audio/')
          ? fs.readFileSync(tone)
          : Buffer.from(
              pathname === '/manifest'
                ? JSON.stringify({
                    sources: [{ url: '/source.js' }],
                    repositories: ['https://1.1.1.1/untrusted'],
                  })
                : pathname === '/source.js'
                  ? code
                  : '',
            )
        const req = new EventEmitter()
        req.end = () =>
          done(
            Object.assign(Readable.from([body]), {
              statusCode: pathname === '/fail' || globalThis.expired === url.href ? 403 : 200,
              headers: {
                'content-type': pathname.startsWith('/audio/') ? 'audio/wav' : 'text/plain',
                'content-length': String(body.length),
              },
              setTimeout() {},
            }),
          )
        return req
      }
      process.getBuiltinModule('node:module').syncBuiltinESMExports()
    },
    { tone, code: script('新增') },
  )
  const page = await app.firstWindow()
  const press = async (locator) => locator.press('Enter')
  await press(page.getByRole('button', { name: '跳过', exact: true }))
  const { ids, list } = await page.evaluate(async (titles) => {
    const ids = []
    for (const title of titles) {
      const hits = await window.music.lxSearch({ title, artist: '' }, 'wy')
      ids.push(await window.music.rememberOnline(hits.items[0].key))
    }
    const list = await window.music.createPlaylist('仅在线引用')
    await window.music.setMembership(list, ids, true)
    await window.music.setPlaybackRepository('https://1.1.1.1/manifest', true)
    return { ids, list }
  }, titles)
  await page.reload()
  await press(page.getByRole('tab', { name: '歌单', exact: true }))
  await press(page.getByRole('button', { name: '歌单导航', exact: true }))
  await press(page.getByRole('button', { name: '仅在线引用', exact: true }))
  await press(page.getByRole('button', { name: '播放轻云', exact: true }))
  const snapshot = () =>
    page.evaluate(async () => {
      const a = document.querySelector('audio'),
        s = await window.music.state()
      return {
        id: s.current,
        playing: !a.paused && a.currentTime > 0.15,
        duration: a.duration,
        time: a.currentTime,
        queue: s.queue,
        tracks: s.playlists.find((p) => p.name === '仅在线引用').tracks,
        local: s.localTracks.length,
      }
    })
  const frames = []
  async function playing(index) {
    await expect
      .poll(
        async () => {
          const s = await snapshot()
          return s.playing && s.id === ids[index]
        },
        { timeout: 95000 },
      )
      .toBe(true)
    const s = await snapshot()
    assert.deepEqual(s.queue, ids)
    assert.deepEqual(s.tracks, ids)
    assert.equal(s.local, 0)
    frames.push(s)
  }
  async function end() {
    await page.locator('audio').evaluate((a) => (a.currentTime = a.duration - 0.15))
  }
  await playing(0)
  await end()
  await playing(1)
  await end()
  await playing(3)
  const choose = page.getByRole('button', { name: /播放晚风.*Live/ })
  await expect(choose).toHaveCount(2)
  await expect(choose.first()).toContainText('3:20')
  await expect(choose.last()).toContainText('5:02')
  await page.screenshot({ path: path.join(root, '版本选择.png') })
  await press(choose.first())
  await playing(2)
  await app.evaluate(() => {
    globalThis.expired = globalThis.issuedURLs[0]
  })
  await press(page.getByRole('button', { name: '播放轻云', exact: true }))
  await playing(0)
  const renewed = await app.evaluate(() => globalThis.issuedURLs)
  assert.equal(renewed[0], renewed[1])
  assert.notEqual(renewed[1], renewed[2])
  const events = await app.evaluate(() => globalThis.testPlaybackEvents)
  assert.equal(events.filter((p) => p === '/manifest').length, 1)
  assert.equal(events.filter((p) => p === '/untrusted').length, 0)
  for (const p of ['/fail', '/audio/轻云', '/audio/细雨', '/audio/归途', '/audio/晚风live'])
    assert.ok(events.includes(p), p)
  const inventory = await page.evaluate(() => window.music.lxSources())
  assert.equal(inventory.installed.filter((x) => !x.disabled).length, 3)
  assert.deepEqual(inventory.repositories.discovered, ['https://1.1.1.1/untrusted'])
  await writeFile(
    path.join(root, 'evidence.json'),
    JSON.stringify({ ids, list, events, frames }, null, 2),
  )
  console.log(
    root,
    events,
    frames.map((x) => [x.time, x.duration]),
  )
} finally {
  await app.close()
}
