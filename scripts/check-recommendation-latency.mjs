import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { writeFixtureRecording } from './music-recording-fixture.mjs'

await fs.mkdir('tmp', { recursive: true })
const root = await fs.mkdtemp(path.resolve('tmp/recommendation-latency-'))
const profile = path.join(root, 'profile')
const output = path.join(root, 'recordings')
await fs.mkdir(output)
const store = new MusicStore(path.join(profile, 'fitbay-music'))
store.set('music-recommend-dir', output)
store.set('music-media-keys', 'off')
store.db.close()
const sources = [
  [
    '健康源',
    `if(action==='musicUrl')return 'https://1.1.1.1/recording';
    if(action==='lyric')return '';
    const [name,singer]=info.keyword.split(' ');
    if(name==='慢歌')return new Promise(()=>{});
    return [{id:name,name,singer,allowPermanentSave:true}]`,
  ],
  [
    '无响应源',
    `if(action==='search' && info.keyword.startsWith('同版歌曲'))
      return [{id:'同版歌曲',name:'同版歌曲',singer:'乙',allowPermanentSave:true}];
    if(action==='musicUrl' && info.musicInfo.name==='同版歌曲')
      return new Promise(done=>setTimeout(()=>done('https://1.1.1.1/recording'),900));
    if(action==='search' && info.keyword.startsWith('健康歌曲')) {
    return [{id:'健康歌曲',name:'健康歌曲',singer:'乙',allowPermanentSave:true}]
  }
  return new Promise(()=>{})`,
  ],
]
const app = await electron.launch({
  args: [
    path.resolve(process.argv[2] ?? 'dist/component-prototype/host'),
    '--mode=music',
    '--mute-audio',
    '--user-data-dir=' + profile,
    '--workbench=' + path.resolve('out/renderer/index.html'),
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  const page = await app.firstWindow()
  await page.waitForSelector('.music-shell')
  for (const [name, body] of sources) {
    const file = path.join(root, name + '.js')
    await fs.writeFile(
      file,
      `// @name ${name}
lx.on('request',({action,info})=>{${body}});
lx.send('inited',{sources:{wy:{actions:['search','musicUrl'],qualitys:['320k'],allowPermanentSave:true}}})`,
    )
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      })
    }, file)
    await page.evaluate(() => window.music.lxImport())
  }
  const sharedAudio = path.join(root, 'shared.wav')
  await writeFixtureRecording(sharedAudio, 718)
  await app.evaluate(
    ({ app, BaseWindow }, { audio, sharedAudio }) => {
      if (
        !app.commandLine.hasSwitch('mute-audio') ||
        BaseWindow.getAllWindows().some((w) => w.isFocusable())
      )
        throw Error('测试窗口未静音或可能抢焦点')
      const https = process.getBuiltinModule('node:https')
      const fs = process.getBuiltinModule('node:fs')
      const { EventEmitter } = process.getBuiltinModule('node:events')
      globalThis.calls = []
      const workers = process.getBuiltinModule('node:worker_threads')
      const Worker = workers.Worker
      workers.Worker = class extends Worker {
        constructor(url, options) {
          super(url, options)
          const { payload, code } = options?.workerData ?? {}
          if (payload?.action)
            globalThis.calls.push(code.split('\n')[0].slice(9) + '/' + payload.action)
        }
      }
      process.getBuiltinModule('node:module').syncBuiltinESMExports()
      https.request = (url, _options, receive) => {
        if (url.href !== 'https://1.1.1.1/recording') throw Error('夹具意外请求')
        globalThis.calls.push('transfer')
        const req = new EventEmitter()
        req.end = () =>
          receive(
            Object.assign(fs.createReadStream(globalThis.shared ? sharedAudio : audio), {
              statusCode: 200,
              headers: {},
              setTimeout() {},
            }),
          )
        return req
      }
      globalThis.fetch = async () => {
        globalThis.calls.push('model')
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  songs: globalThis.shared
                    ? [{ title: '同版歌曲', artist: '乙', reason: '测试' }]
                    : [
                        { title: '慢歌', artist: '甲', reason: '测试' },
                        { title: '健康歌曲', artist: '乙', reason: '测试' },
                      ],
                }),
              },
            },
          ],
        })
      }
    },
    { audio: path.resolve('tests/fixtures/local-music/tone.mp3'), sharedAudio },
  )
  await page.evaluate(() => window.music.configureModel('deepseek', 'fixture', 'fixture', false))
  await page.getByRole('tab', { name: '每日推荐' }).click()
  await page.getByLabel('推荐首数').fill('2')
  await page.getByLabel('描述你想听什么').fill('测试两首音乐')
  const start = performance.now()
  await page.getByRole('button', { name: '生成推荐', exact: true }).click()
  await expect(page.locator('.music-list li strong')).toHaveText(['健康歌曲'], {
    timeout: 4500,
  })
  const firstMs = Math.round(performance.now() - start)
  await page.getByRole('button', { name: '终止本次推荐', exact: true }).click()
  await expect(page.getByText('已下载 1/2，本次推荐已终止')).toBeVisible()
  const snapshot = async () => ({
    files: await fs.readdir(output),
    calls: await app.evaluate(() => globalThis.calls),
    titles: await page.locator('.music-list li strong').allTextContents(),
  })
  const stopped = await snapshot()
  assert.deepEqual(
    stopped.calls.filter((call) => !call.includes('/')),
    ['model', 'transfer'],
  )
  for (const source of ['无响应源', '健康源'])
    for (const action of ['search', 'musicUrl'])
      assert.ok(stopped.calls.includes(source + '/' + action), stopped.calls.join(','))
  assert.deepEqual(stopped.titles, ['健康歌曲'])
  assert.equal(stopped.files.filter((f) => !f.endsWith('.lrc')).length, 1)
  await new Promise((resolve) => setTimeout(resolve, 1500))
  assert.deepEqual(await snapshot(), stopped)
  await app.evaluate(() => {
    globalThis.shared = true
    globalThis.calls = []
  })
  await page.getByLabel('推荐首数').fill('1')
  await page.getByRole('button', { name: '生成推荐', exact: true }).click()
  await expect(page.getByText('已下载 1/1，已达到目标首数')).toBeVisible()
  const single = await snapshot()
  assert.deepEqual(single.titles, ['同版歌曲'])
  assert.deepEqual(
    single.calls.filter((call) => !call.includes('/')),
    ['model', 'transfer'],
  )
  for (const source of ['无响应源', '健康源'])
    assert.ok(single.calls.includes(source + '/musicUrl'))
  assert.equal(single.files.filter((f) => !f.endsWith('.lrc')).length, 2)
  console.log(JSON.stringify({ firstMs, stopped, single }))
} finally {
  await app.close()
}
