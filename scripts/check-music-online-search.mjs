import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron, expect } from '@playwright/test'
import { offlineSourceRepository } from './music-source-fixture.mjs'
import { openMusicSettings, selectMusicSettings } from './music-settings-fixture.mjs'

await fs.mkdir('tmp', { recursive: true })
const root = await fs.mkdtemp(path.resolve('tmp/music-online-search-'))
const profile = path.join(root, 'profile')
const downloads = path.join(root, 'downloads')
const cache = path.join(profile, 'fitbay-music', 'audition-cache')
const source = path.join(root, 'source.js')
const tone = path.resolve('tests/fixtures/local-music/tone.mp3')
await fs.mkdir(downloads)
await fs.writeFile(
  source,
  `// @name 在线搜索测试源
lx.on('request', ({action,info}) => {
  if(action==='search') return [{id:'recording-17', name:'远山', singer:'青禾', albumName:'回声'}]
  if(action==='musicUrl') return 'https://1.1.1.1/recording-17.mp3'
})
lx.send('inited',{sources:{wy:{actions:['search','musicUrl'],qualitys:['320k']}}})`,
)
async function launch() {
  const app = await electron.launch({
    args: [
      path.resolve('dist/component-prototype/host'),
      '--mode=music',
      '--mute-audio',
      '--user-data-dir=' + profile,
      '--workbench=' + path.resolve('out/renderer/index.html'),
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
  await app.firstWindow()
  await app.evaluate(({ BaseWindow }) => {
    BaseWindow.getAllWindows()
      .find((win) => win.getTitle() === 'Music')
      .setContentSize(1000, 740)
  })
  await offlineSourceRepository(app)
  await app.evaluate(({ app }, file) => {
    if (!app.commandLine.hasSwitch('mute-audio')) throw Error('测试未静音')
    const https = process.getBuiltinModule('node:https')
    const { EventEmitter } = process.getBuiltinModule('node:events')
    const { Readable } = process.getBuiltinModule('node:stream')
    const bytes = process.getBuiltinModule('node:fs').readFileSync(file)
    const request = https.request.bind(https)
    https.request = (url, options, done) => {
      if (url.href !== 'https://1.1.1.1/recording-17.mp3') return request(url, options, done)
      const req = new EventEmitter()
      req.end = () => {
        const range = /^bytes=(\d+)-(\d*)$/.exec(options.headers?.Range ?? '')
        const start = range ? Number(range[1]) : 0
        const end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1
        const body = bytes.subarray(start, end + 1)
        done(
          Object.assign(Readable.from([body]), {
            statusCode: range ? 206 : 200,
            headers: {
              'content-type': 'audio/mpeg',
              'content-length': String(body.length),
              'accept-ranges': 'bytes',
              ...(range && {
                'content-range': `bytes ${start}-${end}/${bytes.length}`,
              }),
            },
            setTimeout() {},
          }),
        )
      }
      return req
    }
  }, tone)
  return app
}
const choose = (app, file) =>
  app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    })
  }, file)
let app = await launch()
try {
  let page = await app.firstWindow()
  const button = (name) => page.getByRole('button', { name, exact: true })
  const tab = (name) => page.getByRole('tab', { name, exact: true })
  const result = () =>
    page.getByRole('listitem').filter({ has: page.getByText('远山', { exact: true }) })
  const search = async () => {
    await tab('在线找歌').click()
    const input = page.getByRole('textbox', { name: '搜索关键词' })
    await input.fill('远山 青禾')
    await input.press('Enter')
    await expect(result()).toBeVisible()
  }
  const playing = async () => {
    await expect
      .poll(
        () =>
          page
            .locator('audio')
            .evaluate(
              (a) => a.currentSrc.startsWith('fitbay-audio:') && !a.paused && a.currentTime > 0,
            ),
        { intervals: [40, 80, 100] },
      )
      .toBe(true)
    await expect(page.locator('.music-player')).toContainText('远山')
  }
  await button('跳过').click()
  await tab('歌单').click()
  await button('新建歌单').click()
  await page.getByLabel('歌单名称').fill('路上听')
  await button('创建').click()
  await openMusicSettings(page)
  await selectMusicSettings(page, '音乐源')
  await choose(app, source)
  await button('本地导入').click()
  await expect.poll(() => page.evaluate(() => window.music.lxInfo())).toBe('在线搜索测试源')
  await selectMusicSettings(page, '下载')
  await choose(app, downloads)
  await button('选择手动下载目录').click()
  await expect
    .poll(() => page.evaluate(async () => (await window.music.state()).prefs.manualDir))
    .toBe(downloads)
  await search()
  await result().getByRole('button', { name: '加入歌单' }).click()
  await page.getByRole('menuitem', { name: '路上听' }).click()
  await expect(page.getByRole('status')).toContainText('已加入「路上听」')
  await result().getByRole('button', { name: '播放', exact: true }).click()
  await playing()
  assert.deepEqual(await fs.readdir(downloads), [])
  assert.deepEqual(await fs.readdir(cache), [])
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  await tab('歌单').click()
  await button('路上听').click()
  await expect(page.locator('.library-name strong')).toHaveText(['远山'])
  await button('播放远山').click()
  await playing()
  await page.screenshot({
    path: path.join(root, 'playlist-playing.png'),
    style: ':root { background: var(--base) !important }',
  })
  assert.deepEqual(await fs.readdir(downloads), [])
  assert.deepEqual(await fs.readdir(cache), [])
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => {
      throw Error('设置下载目录后仍要求选择文件夹')
    }
  })
  await search()
  await result().getByRole('button', { name: '下载', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已下载并入库')
  const audio = (await fs.readdir(downloads)).filter((f) => f.endsWith('.mp3'))
  assert.equal(audio.length, 1)
  assert.deepEqual(await fs.readFile(path.join(downloads, audio[0])), await fs.readFile(tone))
  await tab('曲库').click()
  await button('全部歌曲').click()
  await expect(page.locator('.library-name strong')).toHaveText(['试音 mp3'])
  console.log('PASS 搜索页播放、加入指定歌单、重启后在线播放、设置目录手动下载及永久入库 · ' + root)
} finally {
  await app.close()
}
