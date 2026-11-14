import { openDiscovery } from './discovery-fixture.mjs'
import { offlineSourceRepository } from './music-source-fixture.mjs'
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
    `if(action==='musicUrl')return 'https://1.1.1.1/recording/'+encodeURIComponent(info.musicInfo.name);
    if(action==='lyric')return '';
    const [name,singer]=info.keyword.split(' ');
    if(name.startsWith('故障'))throw Error('检索暂不可用');
    if(name.startsWith('缺歌'))return [];
    if(name==='慢歌')return new Promise(()=>{});
    if(name==='后页歌曲' && info.page===1)return {items:[{id:name,name,singer:'丙',allowPermanentSave:false}],hasMore:true};
    if(name==='后页歌曲')return [{id:'许可版本',name,singer:'丙',allowPermanentSave:true}];
    return [{id:name,name,singer,allowPermanentSave:true}]`,
  ],
  [
    '无响应源',
    `if(action==='search' && info.keyword.startsWith('故障'))throw Error('检索暂不可用');
    if(action==='lyric')return '';
    if(action==='search' && info.keyword.startsWith('单源恢复'))return [];
    if(action==='search' && info.keyword.startsWith('超时换源'))return [{id:'超时换源',name:'超时换源',singer:'甲',allowPermanentSave:true}];
    if(action==='musicUrl' && info.musicInfo.name==='超时换源')return 'https://1.1.1.1/recording/'+encodeURIComponent('超时换源')+'?alternative=1';
    if(action==='search' && (info.keyword.startsWith('后页歌曲') || info.keyword.startsWith('缺歌')))return [];
    if(action==='search' && info.keyword.startsWith('同版歌曲'))
      return [{id:'同版歌曲',name:'同版歌曲',singer:'乙',allowPermanentSave:true}];
    if(action==='musicUrl' && info.musicInfo.name==='同版歌曲')
      return new Promise(done=>setTimeout(()=>done('https://1.1.1.1/recording'),900));
    if(action==='search' && info.keyword.startsWith('健康歌曲')) {
    return [{id:'健康歌曲',name:'健康歌曲',singer:'乙',allowPermanentSave:true}]
  }
  return new Promise(()=>{})`,
  ],
]
const launch = () =>
  electron.launch({
    args: [
      path.resolve(process.argv[2] ?? 'dist/component-prototype/host'),
      '--mode=music',
      '--mute-audio',
      '--user-data-dir=' + profile,
      '--workbench=' + path.resolve('out/renderer/index.html'),
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
let app = await launch()
try {
  let page = await app.firstWindow()
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
  const recordings = {}
  for (const [index, name] of [
    '同版歌曲',
    '后页歌曲',
    '滚动一',
    '滚动二',
    '滚动三',
    '滚动四',
    '慢传追加',
    '首轮甲',
    '首轮乙',
    '补选一',
    '补选二',
    '超时换源',
    '单源恢复',
  ].entries()) {
    recordings[name] = path.join(root, name + '.wav')
    await writeFixtureRecording(recordings[name], 718 + index * 151)
  }
  const mockRequests = async () => {
    await offlineSourceRepository(app)
    return app.evaluate(
      ({ app, BaseWindow }, { audio, recordings }) => {
        if (
          !app.commandLine.hasSwitch('mute-audio') ||
          BaseWindow.getAllWindows().some((w) => w.isFocusable())
        )
          throw Error('测试窗口未静音或可能抢焦点')
        const https = process.getBuiltinModule('node:https')
        const fs = process.getBuiltinModule('node:fs')
        const { EventEmitter } = process.getBuiltinModule('node:events')
        globalThis.calls = []
        globalThis.searches = []
        globalThis.timedTransfers = []
        const timeout = AbortSignal.timeout.bind(AbortSignal)
        AbortSignal.timeout = (ms) => timeout(globalThis.testDeadline && ms === 240000 ? 1200 : ms)
        const workers = process.getBuiltinModule('node:worker_threads')
        const Worker = workers.Worker
        workers.Worker = class extends Worker {
          constructor(url, options) {
            super(url, options)
            const { payload, code } = options?.workerData ?? {}
            if (payload?.action)
              globalThis.calls.push(code.split('\n')[0].slice(9) + '/' + payload.action)
            if (payload?.action === 'search')
              globalThis.searches.push([
                code.split('\n')[0].slice(9),
                payload.info.keyword,
                payload.info.page,
              ])
          }
        }
        process.getBuiltinModule('node:module').syncBuiltinESMExports()
        https.request = (url, options, receive) => {
          if (url.origin !== 'https://1.1.1.1' || !url.pathname.startsWith('/recording'))
            throw Error('夹具意外请求')
          const song = decodeURIComponent(url.pathname.split('/')[2] ?? '')
          globalThis.calls.push('transfer')
          const req = new EventEmitter()
          if (globalThis.testDeadline && ['超时换源', '单源恢复'].includes(song)) {
            const attempts = globalThis.timedTransfers
            const alternative = url.searchParams.has('alternative')
            const hang = !alternative && !attempts.some(([title]) => title === song)
            attempts.push([song, alternative])
            if (hang) {
              const { PassThrough } = process.getBuiltinModule('node:stream')
              const stream = Object.assign(new PassThrough(), {
                statusCode: 200,
                headers: {},
                setTimeout() {},
              })
              req.end = () => receive(stream)
              options.signal.addEventListener(
                'abort',
                () => stream.destroy(Error('fixture transfer deadline')),
                { once: true },
              )
              return req
            }
          }
          const respond = () =>
            receive(
              Object.assign(fs.createReadStream(recordings[song] ?? audio), {
                statusCode: 200,
                headers: {},
                setTimeout() {},
              }),
            )
          req.end = () => {
            if (song === '慢传追加') globalThis.releaseSlowTransfer = respond
            else setTimeout(respond, song === '滚动一' ? 4500 : 650)
          }
          return req
        }
        globalThis.fetch = async (_url, options) => {
          globalThis.calls.push('model')
          let requested
          if (globalThis.requestedCounts) {
            const input = JSON.parse(options.body).messages.at(-1).content
            requested = JSON.parse(input).count
            globalThis.requestedCounts.push(requested)
          }
          if (
            globalThis.holdRefill &&
            globalThis.calls.filter((call) => call === 'model').length === 2
          ) {
            globalThis.waitingOnModel = true
            await new Promise((_, reject) =>
              options.signal.addEventListener('abort', () => reject(options.signal.reason), {
                once: true,
              }),
            )
          }
          if (globalThis.rounds?.length)
            globalThis.songs = globalThis.rounds.shift().slice(0, requested)
          await new Promise((resolve) => setTimeout(resolve, 450))
          return Response.json({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    songs: globalThis.songs
                      ? globalThis.songs.map(([title, artist]) => ({
                          title,
                          artist,
                          reason: '测试',
                        }))
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
      { audio: path.resolve('tests/fixtures/local-music/tone.mp3'), recordings },
    )
  }
  await mockRequests()
  await page.evaluate(() => window.music.configureModel('deepseek', 'fixture', 'fixture', false))
  await openDiscovery(page, true)
  await page.getByLabel('推荐首数').fill('2')
  await page.getByLabel('想让 AI 推荐什么？（选填）').fill('测试两首音乐')
  // Offscreen capture cannot composite the Windows acrylic surface.
  await page.evaluate(() => {
    delete document.documentElement.dataset.backdrop
  })
  const start = performance.now()
  await page.getByRole('button', { name: '生成推荐', exact: true }).click()
  let progress = page.locator('.music-batch-status [role="status"]')
  await expect(progress).toContainText('已入库 0/2，正在生成候选歌曲')
  await expect(progress).toContainText('正在下载《健康歌曲》')
  await expect(page.getByRole('button', { name: '终止本次推荐' })).toBeEnabled()
  await page.screenshot({ path: path.join(root, '下载进度.png') })
  await expect(page.locator('.music-list li strong')).toHaveText(['健康歌曲'], {
    timeout: 4500,
  })
  const firstMs = Math.round(performance.now() - start)
  await page.getByRole('button', { name: '终止本次推荐', exact: true }).click()
  await expect(page.getByText('已入库 1/2，本次推荐已终止')).toBeVisible()
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
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  await page.waitForSelector('.music-shell')
  await mockRequests()
  await openDiscovery(page, true)
  progress = page.locator('.music-batch-status [role="status"]')
  await app.evaluate(() => {
    globalThis.songs = [['同版歌曲', '乙']]
    globalThis.calls = []
  })
  await page.getByLabel('推荐首数').fill('1')
  await page.getByRole('button', { name: '生成推荐', exact: true }).click()
  await expect(page.getByText('已入库 1/1，已达到目标首数')).toBeVisible()
  const single = await snapshot()
  assert.deepEqual(single.titles, ['同版歌曲'])
  assert.deepEqual(
    single.calls.filter((call) => !call.includes('/')),
    ['model', 'transfer'],
  )
  assert.equal(
    single.calls.find((call) => call.endsWith('/search')),
    '健康源/search',
  )
  assert.equal(
    single.calls.find((call) => call.endsWith('/musicUrl')),
    '健康源/musicUrl',
  )
  assert.equal(single.files.filter((f) => !f.endsWith('.lrc')).length, 1)
  await app.evaluate(() => {
    globalThis.songs = [['后页歌曲', '丙']]
  })
  await page.getByRole('button', { name: '生成推荐', exact: true }).click()
  await expect(page.locator('.music-list li strong')).toHaveText(['后页歌曲'], { timeout: 16000 })
  const queries = await app.evaluate(() =>
    globalThis.searches.filter(([source, q]) => source === '健康源' && q.startsWith('后页歌曲')),
  )
  assert.equal(queries.filter(([, q, n]) => q === '后页歌曲 丙' && n === 1).length, 1)
  assert.ok(queries.some(([, q, n]) => q === '后页歌曲 丙' && n === 2))
  await app.evaluate(() => {
    globalThis.songs = [
      ['滚动一', '甲'],
      ['缺歌', '戊'],
      ['滚动二', '乙'],
      ['滚动三', '丙'],
      ['滚动四', '丁'],
    ]
  })
  await page.getByLabel('推荐首数').fill('4')
  await page.getByRole('button', { name: '生成推荐', exact: true }).click()
  await expect(page.locator('.music-list li strong')).toHaveText(['滚动二', '滚动三', '滚动四'], {
    timeout: 10000,
  })
  await expect(progress).toContainText('已入库 3/4，正在下载《滚动一》')
  await page.getByRole('button', { name: '播放本次推荐' }).click()
  await expect(page.getByRole('button', { name: '终止本次推荐' })).toBeEnabled()
  await expect(progress).toContainText('已入库 4/4，已达到目标首数', { timeout: 12000 })
  await app.evaluate(() => {
    globalThis.calls = []
    globalThis.requestedCounts = []
    globalThis.rounds = [
      [
        ['慢传追加', '甲'],
        ['首轮甲', '辛'],
        ['首轮乙', '壬'],
        ['缺歌一', '乙'],
        ['缺歌二', '丙'],
      ],
      [
        ['缺歌三', '庚'],
        ['补选一', '丁'],
        ['补选二', '戊'],
      ],
    ]
  })
  await page.getByLabel('推荐首数').fill('5')
  await page.getByRole('button', { name: '生成推荐', exact: true }).click()
  await expect(progress).toContainText('已入库 4/5，正在下载《慢传追加》', { timeout: 30000 })
  await expect(page.locator('.music-list li strong')).toHaveCount(4)
  await app.evaluate(() => globalThis.releaseSlowTransfer())
  await expect(progress).toContainText('已入库 5/5，已达到目标首数', { timeout: 14000 })
  const counts = await app.evaluate(() => {
    const counts = globalThis.requestedCounts
    delete globalThis.requestedCounts
    return counts
  })
  assert.equal(counts[0], 5)
  assert.ok(counts[1] >= 3 && counts[1] <= 5)
  assert.deepEqual(
    (await page.locator('.music-list li strong').allTextContents()).sort(),
    ['首轮甲', '首轮乙', '补选一', '补选二', '慢传追加'].sort(),
  )
  assert.equal(
    await app.evaluate(() => globalThis.calls.filter((call) => call === 'model').length),
    2,
  )
  await app.evaluate(() => {
    globalThis.songs = [
      ['故障甲', '甲'],
      ['故障乙', '乙'],
      ['故障丙', '丙'],
      ['故障丁', '丁'],
    ]
  })
  await page.getByLabel('推荐首数').fill('4')
  await page.getByRole('button', { name: '生成推荐', exact: true }).click()
  await expect(progress).toContainText('已入库 0/4，连续多首歌曲的所有匹配来源均无法访问')
  await page.getByText('查看详情', { exact: true }).click()
  await expect(page.locator('.music-failure-details p')).toContainText('同批暂时跳过此来源')
  const skipped = await app.evaluate(() =>
    globalThis.searches.filter(([, keyword]) => keyword.startsWith('故障丁')),
  )
  assert.deepEqual(skipped, [])
  for (const song of ['超时换源', '单源恢复']) {
    await app.evaluate((_, song) => {
      globalThis.testDeadline = true
      globalThis.songs = [[song, '甲']]
    }, song)
    await page.getByLabel('推荐首数').fill('1')
    await page.getByRole('button', { name: '生成推荐', exact: true }).click()
    await expect(page.locator('.music-list li strong')).toHaveText([song], { timeout: 11000 })
    await expect(progress).toContainText('已入库 1/1，已达到目标首数')
  }
  assert.deepEqual(await app.evaluate(() => globalThis.timedTransfers), [
    ['超时换源', false],
    ['超时换源', true],
    ['单源恢复', false],
    ['单源恢复', false],
  ])
  await app.evaluate(() => {
    globalThis.calls = []
    globalThis.songs = [['取消等待', '甲']]
    globalThis.holdRefill = true
  })
  await page.getByLabel('推荐首数').fill('2')
  await page.getByRole('button', { name: '生成推荐', exact: true }).click()
  await expect.poll(() => app.evaluate(() => !!globalThis.waitingOnModel)).toBe(true)
  await page.getByRole('button', { name: '终止本次推荐', exact: true }).click()
  await expect(progress).toContainText('本次推荐已终止')
  const finalCalls = await app.evaluate(() => globalThis.calls)
  assert.equal(finalCalls.filter((call) => call === 'model').length, 2)
  await new Promise((resolve) => setTimeout(resolve, 800))
  assert.deepEqual(await app.evaluate(() => globalThis.calls), finalCalls)
  console.log(JSON.stringify({ firstMs, stopped, single }))
} finally {
  await app.close()
}
