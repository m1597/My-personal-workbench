import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs/promises'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { writeFixtureRecording } from './music-recording-fixture.mjs'
import { offlineSourceRepository } from './music-source-fixture.mjs'

await fs.mkdir('tmp', { recursive: true })
const root = await fs.mkdtemp(path.resolve('tmp/refill-five-'))
const profile = path.join(root, 'profile')
const output = path.join(root, 'songs')
await fs.mkdir(output)
const store = new MusicStore(path.join(profile, 'fitbay-music'))
store.set('music-recommend-dir', output)
store.set('music-media-keys', 'off')
store.db.close()

const songs = ['晨风', '河岸', '远山', '晚钟', '归途']
const files = {}
for (const [i, song] of songs.entries()) {
  files[song] = path.join(root, song + '.wav')
  await writeFixtureRecording(files[song], 630 + i * 175)
}
const code = path.join(root, 'source.js')
await fs.writeFile(
  code,
  `// @name 五首补推测试源
lx.on('request', ({action,info}) => {
  if(action === 'musicUrl') return 'https://1.1.1.1/audio/' + encodeURIComponent(info.musicInfo.name)
  if(action !== 'search') return ''
  const name = info.keyword.split(' ')[0]
  return [{id:name,name,singer:'青禾',allowPermanentSave:!name.startsWith('限听')}]
})
lx.send('inited',{sources:{wy:{actions:['search','musicUrl'],qualitys:['320k']}}})`,
)
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
  await offlineSourceRepository(app)
  await app.evaluate(
    ({ app, BaseWindow, dialog }, { files, code, songs }) => {
      if (
        !app.commandLine.hasSwitch('mute-audio') ||
        BaseWindow.getAllWindows().some((w) => w.isFocusable())
      )
        throw Error('测试窗口必须后台静音')
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [code] })
      const fs = process.getBuiltinModule('node:fs')
      const https = process.getBuiltinModule('node:https')
      const { EventEmitter } = process.getBuiltinModule('node:events')
      globalThis.transfers = []
      https.request = (url, _options, receive) => {
        if (url.origin !== 'https://1.1.1.1') throw Error('夹具意外请求')
        const title = decodeURIComponent(url.pathname.slice('/audio/'.length))
        if (!files[title]) throw Error('无授权曲目触发了音频请求')
        globalThis.transfers.push(title)
        const req = new EventEmitter()
        req.end = () =>
          receive(
            Object.assign(fs.createReadStream(files[title]), {
              headers: {},
              statusCode: 200,
              setTimeout() {},
            }),
          )
        return req
      }
      const catalog = [
        ...songs.slice(0, 4),
        '限听一',
        '限听二',
        '限听三',
        '限听四',
        songs[4],
        '限听五',
      ]
      globalThis.counts = []
      globalThis.fetch = async (_url, options) => {
        const { count, excluded = [] } = JSON.parse(
          JSON.parse(options.body).messages.at(-1).content,
        )
        globalThis.counts.push(count)
        const titles = catalog
          .filter((title) => !excluded.some((s) => s.title === title))
          .slice(0, count)
        await new Promise((r) => setTimeout(r, 1200))
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  requestedArtist: '青禾',
                  songs: titles.map((title) => ({ title, artist: '青禾', reason: '同艺人作品' })),
                }),
              },
            },
          ],
        })
      }
    },
    { files, code, songs },
  )
  await page.evaluate(async () => {
    await window.music.lxImport()
    await window.music.configureModel('deepseek', 'fixture', 'fixture', false)
  })
  await page.getByRole('tab', { name: 'AI 推荐' }).click()
  await page.getByLabel('推荐首数').fill('5')
  await page.getByLabel('想让 AI 推荐什么？（选填）').fill('只听青禾本人的作品')
  await page.evaluate(() => {
    delete document.documentElement.dataset.backdrop
    const list = document.querySelector('.music-list')
    const started = performance.now()
    const times = {}
    new MutationObserver(() => {
      const n = list.querySelectorAll('li strong').length
      if (n > 0 && !times.firstMs) times.firstMs = Math.round(performance.now() - started)
      if (n === 5 && !times.fiveMs) times.fiveMs = Math.round(performance.now() - started)
    }).observe(list, { subtree: true, childList: true, characterData: true })
    window.fixtureTimes = times
  })
  await page.getByRole('button', { name: '生成推荐', exact: true }).click()
  await expect(page.locator('.music-batch-status [role="status"]')).toContainText(
    '已入库 5/5，已达到目标首数',
    { timeout: 30000 },
  )
  const times = await page.evaluate(() => window.fixtureTimes)
  const counts = await app.evaluate(() => globalThis.counts)
  assert.deepEqual((await app.evaluate(() => globalThis.transfers)).sort(), [...songs].sort())
  assert.deepEqual(
    (await page.locator('.music-list li strong').allTextContents()).sort(),
    [...songs].sort(),
  )
  assert.equal((await fs.readdir(output)).filter((f) => f.endsWith('.wav')).length, 5)
  assert.deepEqual(counts, [5, 5])
  const report = { ...times, counts, root }
  await fs.writeFile(path.join(root, 'timing.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally {
  await app.close()
}
