import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { writeFixtureRecording } from './music-recording-fixture.mjs'

const root = await fs.mkdtemp(path.resolve('tmp/source-speed-'))
const profile = path.join(root, 'profile')
const output = path.join(root, 'audio')
await fs.mkdir(output)
const store = new MusicStore(path.join(profile, 'fitbay-music'))
for (const kind of ['manual', 'recommend']) store.set('music-' + kind + '-dir', output)
store.set('music-media-keys', 'off')
store.set('music-muted', 'on')
store.db.exec('PRAGMA journal_mode=WAL')
store.db.close()
const songs = ['潮汐', '晨光', '流云', '晚风', '星图', '手动曲']
const artists = ['甲', '乙', '丙', '丁', '戊', '己']
for (const [i, title] of songs.entries())
  await writeFixtureRecording(path.join(root, title + '.wav'), (i + 1) * 139)
const source = (name, slow) => `// @name ${name}
lx.on('request',({action,info})=>{
  if(action==='lyric')return '';
  if(action==='musicUrl')return new Promise(resolve=>setTimeout(()=>resolve('https://1.1.1.1/audio/'+encodeURIComponent(info.musicInfo.name)),${slow ? 1800 : 40}));
  const [name,singer]=info.keyword.split(' ');
  return {items:[{id:name,name,singer,lyric:'[00:00]测试',allowPermanentSave:true}],hasMore:false}
});
lx.send('inited',{sources:{wy:{actions:['search','musicUrl'],qualitys:['128k'],allowPermanentSave:true}}})`
const sources = [source('快速源', false), source('慢速源', true)]
const app = await electron.launch({
  args: [
    path.resolve(process.argv[2] || 'dist/component-prototype/host'),
    '--mode=music',
    '--mute-audio',
    '--user-data-dir=' + profile,
    '--workbench=' + path.resolve('out/renderer/index.html'),
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
const db = new DatabaseSync(path.join(profile, 'fitbay-music/music.sqlite'), {
  readOnly: true,
  timeout: 1000,
})
try {
  const page = await app.firstWindow()
  await page.waitForSelector('.music-shell')
  await app.evaluate(
    ({ app, BaseWindow, screen, net }, { root, songs, artists, sources }) => {
      const original = net.fetch.bind(net)
      net.fetch = (url, opts) =>
        ['raw.githubusercontent.com', 'api.github.com'].includes(new URL(url).hostname)
          ? Promise.reject(Error('走受控仓库传输'))
          : original(url, opts)
      const left = Math.min(...screen.getAllDisplays().map((d) => d.bounds.x))
      if (
        !app.commandLine.hasSwitch('mute-audio') ||
        BaseWindow.getAllWindows().some(
          (w) => w.isFocusable() || w.getBounds().x + w.getBounds().width > left,
        )
      )
        throw Error('窗口未离屏静音')
      const builtin = process.getBuiltinModule
      const { Readable } = builtin('node:stream')
      const { EventEmitter } = builtin('node:events')
      const files = builtin('node:fs')
      const dns = builtin('node:dns/promises')
      dns.lookup = async () => [{ address: '1.1.1.1', family: 4 }]
      const workers = builtin('node:worker_threads')
      const BaseWorker = workers.Worker
      globalThis.samples = []
      globalThis.repositoryMs = 0
      let repositoryStart
      workers.Worker = class extends BaseWorker {
        constructor(url, opts) {
          super(url, opts)
          const { payload } = opts.workerData
          if (!payload) return
          const start = performance.now()
          this.once('message', () =>
            samples.push({ stage: payload.action, ms: Math.round(performance.now() - start) }),
          )
        }
      }
      builtin('node:module').syncBuiltinESMExports()
      builtin('node:https').request = (url, _options, receive) => {
        const req = new EventEmitter()
        const start = performance.now()
        if (url.pathname.endsWith('README.md')) repositoryStart = start
        req.end = () =>
          setTimeout(() => {
            let bytes
            if (url.pathname.startsWith('/audio/'))
              bytes = files.readFileSync(
                builtin('node:path').join(root, decodeURIComponent(url.pathname.slice(7)) + '.wav'),
              )
            else if (url.pathname.endsWith('README.md'))
              bytes = Buffer.from(
                '### Fast\nhttps://raw.githubusercontent.com/pdone/lx-music-source/main/fish/latest.js\n### Slow\nhttps://raw.githubusercontent.com/pdone/lx-music-source/main/lx/latest.js',
              )
            else if (url.pathname.includes('/git/trees/')) bytes = Buffer.from('{"tree":[]}')
            else if (url.pathname.endsWith('health-state.json'))
              bytes = Buffer.from('{"sources":{"fish":"可用","lx":"可用"}}')
            else if (url.pathname.endsWith('latest.js'))
              bytes = Buffer.from(sources[url.pathname.includes('/fish/') ? 0 : 1])
            else throw Error('夹具意外请求 ' + url.pathname)
            const audio = url.pathname.startsWith('/audio/')
            const stream = Readable.from(
              (async function* () {
                const first = performance.now()
                if (audio) samples.push({ stage: 'firstByte', ms: Math.round(first - start) })
                yield bytes.subarray(0, 32)
                await new Promise((r) => setTimeout(r, 40))
                yield bytes.subarray(32)
                if (audio)
                  samples.push({ stage: 'transfer', ms: Math.round(performance.now() - first) })
                else if (repositoryStart)
                  globalThis.repositoryMs = Math.round(performance.now() - repositoryStart)
              })(),
            )
            receive(Object.assign(stream, { statusCode: 200, headers: {}, setTimeout() {} }))
          }, 65)
        return req
      }
      globalThis.fetch = async () =>
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  songs: songs
                    .slice(0, 5)
                    .map((title, i) => ({ title, artist: artists[i], reason: '测试' })),
                }),
              },
            },
          ],
        })
    },
    { root, songs, artists, sources },
  )
  for (const [i, code] of sources.entries()) {
    const file = path.join(root, i + '.js')
    await fs.writeFile(file, code)
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    }, file)
    await page.evaluate(() => window.music.lxImport())
  }
  await page.evaluate(() => window.music.configureModel('deepseek', 'fixture', 'fixture', false))
  const start = performance.now()
  await page.evaluate(() => window.music.lxRefreshCatalog())
  const catalogMs = Math.round(performance.now() - start)
  const startManual = performance.now()
  const manual = await page.evaluate(async () => {
    const { items } = await window.music.lxSearch({ title: '手动曲', artist: '己' })
    return window.music.lxDownload(items[0].key, '128k', true)
  })
  const manualMs = Math.round(performance.now() - startManual)
  const manualStages = await app.evaluate(() => samples.splice(0))
  await app.evaluate(() => {
    globalThis.repositoryMs = 0
  })
  const startBatch = performance.now()
  const task = page.evaluate(() => window.music.generate('测试五首', 'auto', false, 5))
  const marks = []
  const timer = setInterval(() => {
    const count = db
      .prepare("SELECT count(*) AS n FROM local_tracks WHERE importedOrigin='daily'")
      .get().n
    while (marks.length < count) marks.push(Math.round(performance.now() - startBatch))
  }, 15)
  try {
    await task
  } finally {
    clearInterval(timer)
  }
  const count = db
    .prepare("SELECT count(*) AS n FROM local_tracks WHERE importedOrigin='daily'")
    .get().n
  while (marks.length < count) marks.push(Math.round(performance.now() - startBatch))
  assert.equal(
    count,
    5,
    JSON.stringify(db.prepare('SELECT state,message FROM recommendation_runs').all()),
  )
  console.log(
    JSON.stringify({
      catalogMs,
      repositoryNetworkMs: await app.evaluate(() => globalThis.repositoryMs),
      manualMs,
      manual,
      manualStages,
      firstMs: marks[0],
      fiveMs: marks[4],
      dailyStages: await app.evaluate(() => samples),
      root,
    }),
  )
} finally {
  db.close()
  await app.close()
}
