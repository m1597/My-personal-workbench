import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron, expect } from '@playwright/test'
import { offlineSourceRepository } from './music-source-fixture.mjs'
import { MusicStore } from '../components/music/store.mjs'

await fs.mkdir('tmp', { recursive: true })
const root = await fs.mkdtemp(path.resolve('tmp/music-release-catalog-'))
const profile = path.join(root, 'profile')
const downloads = path.join(root, 'downloads')

const source = path.join(root, 'source.js')
const tone = path.resolve('tests/fixtures/local-music/tone.mp3')
await fs.mkdir(downloads)
const store = new MusicStore(path.join(profile, 'fitbay-music'))
store.set('music-manual-dir', downloads)
store.library.upsert({
  file: tone,
  title: '远山',
  artist: '青禾',
  album: '山色',
  albumArtist: '青禾',
  discNumber: 2,
  trackNumber: 1,
  duration: 1,
})
for (const title of ['无编号', '唯一曲目']) {
  const file = path.join(root, title + '.mp3')
  await fs.copyFile(tone, file)
  store.library.upsert({
    file,
    title,
    artist: '青禾',
    album: '山色',
    albumArtist: '青禾',
    duration: 1,
  })
}
store.db.close()
await fs.writeFile(
  source,
  `// @name 版本归组源
lx.on('request',({action,info})=>{
 if(action==='search') {
   if(info.keyword==='缺少曲 青禾')return [{id:'missing',name:'缺少曲',singer:'青禾',albumName:'山色'}]
   return [{id:'recording-17',name:'远山',singer:'青禾',albumName:'山色',interval:'03:01'},
    {id:'recording-18',name:'远山 (Live)',singer:'青禾',albumName:'山色现场',interval:'03:24'},
    {id:'other',name:'远山',singer:'另一人'},
    {id:'a',name:'访客',singer:'未知艺人',albumName:'甲'},{id:'b',name:'访客',singer:'未知艺人',albumName:'乙'},
    {id:'c',name:'问候',singer:'-',albumName:'甲'},{id:'d',name:'问候',singer:'-',albumName:'乙'},
    {id:'e',name:'无标记',singer:'青禾'},{id:'f',name:'无标记',singer:'青禾'},
    {id:'g',name:'远山 (月亮)',singer:'青禾',albumName:'山色'}]
 }
 if(action==='musicUrl')return 'https://1.1.1.1/'+info.musicInfo.id+'.mp3'
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
  const view = await app.firstWindow()
  await view.waitForSelector('.music-shell')
  await view.evaluate(() => {
    delete document.documentElement.dataset.backdrop
  })
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
    globalThis.audioRequests = []
    https.request = (url, options, done) => {
      if (!/^https:\/\/1\.1\.1\.1\/recording-(?:17|18)\.mp3$/.test(url.href))
        return request(url, options, done)
      globalThis.audioRequests.push(url.pathname)
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
  await app.evaluate(() => {
    globalThis.catalogRequests = []
    const first = '00000000-0000-0000-0000-000000000001'
    const second = '00000000-0000-0000-0000-000000000002'
    const artist = '00000000-0000-0000-0000-000000000003'
    const artistCredit = [{ artist: { id: artist, name: '青禾' }, name: '青禾' }]
    globalThis.fetch = async (url, options) => {
      if (
        url.origin !== 'https://musicbrainz.org' ||
        !options.headers['User-Agent'].includes('FitBay')
      )
        throw Error('外部请求未隔离')
      globalThis.catalogRequests.push(url.pathname)
      const today = new Date().toISOString().slice(0, 10)
      const entity = url.pathname.split('/').at(-1)
      if (entity === 'artist')
        return Response.json({ artists: [{ id: artist, name: '青禾', disambiguation: '乐队' }] })
      if (entity === 'release-group')
        return Response.json({
          'release-groups': [
            {
              id: first,
              title: '初雪',
              'first-release-date': today,
              'artist-credit': artistCredit,
            },
            {
              id: second,
              title: '旧作',
              'first-release-date': '2002-09-01',
              'artist-credit': artistCredit,
            },
          ],
        })
      if (entity === 'release')
        return Response.json({
          releases: [
            {
              id: first,
              title: '山色',
              date: '2001',
              country: 'JP',
              disambiguation: '普通版',
              media: [{ format: 'CD' }],
              'artist-credit': artistCredit,
            },
            {
              id: second,
              title: '山色',
              date: '2009',
              country: 'CN',
              disambiguation: '豪华版',
              media: [{ format: 'Vinyl' }],
              'artist-credit': artistCredit,
            },
          ],
        })
      if (entity === first || entity === second)
        return Response.json({
          'artist-credit': artistCredit,
          media: [
            {
              position: 1,
              tracks: [
                { title: '远山', number: '1' },
                { title: '无编号', number: '2' },
                { title: '唯一曲目', number: '3' },
              ],
            },
            {
              position: 2,
              tracks: [
                { title: '远山', number: '1' },
                { title: entity === first ? '初版曲' : '缺少曲', number: '2' },
                { title: '无编号', number: '3' },
              ],
            },
          ],
        })
      throw Error('未知路径')
    }
  })
  return app
}
let app = await launch()
try {
  let page = await app.firstWindow()
  const tab = (name) => page.getByRole('tab', { name, exact: true })
  const button = (name) => page.getByRole('button', { name, exact: true })
  const news = () => page.getByRole('region', { name: '关注歌手的新发行' })
  const played = async () =>
    await expect
      .poll(() => page.locator('audio').evaluate((a) => a.currentTime > 0 && !a.paused), {
        intervals: [25, 50],
      })
      .toBe(true)
  await button('跳过').click()
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, source)
  await page.evaluate(() => window.music.lxImport())
  await tab('搜索音乐').click()
  const input = page.getByRole('textbox', { name: '搜索关键词' })
  await input.fill('远山')
  await input.press('Enter')
  const group = page.locator('.version-group details')
  await expect(group.locator('summary')).toHaveText('远山 · 青禾 · 2 个版本')
  await expect(page.getByText('另一人 · 时长未知')).toBeVisible()
  await expect(group).toHaveCount(1)
  for (const name of ['访客', '问候', '无标记'])
    await expect(page.getByText(name, { exact: true })).toHaveCount(2)
  await expect(page.getByText('远山 (月亮)', { exact: true })).toBeVisible()
  await group.locator('summary').click()
  const versions = group.getByRole('listitem')
  await expect(versions.nth(0)).toContainText('3:01')
  await expect(versions.nth(1)).toContainText('3:24')
  for (const i of [0, 1]) {
    await versions.nth(i).getByRole('button', { name: '播放', exact: true }).click()
    await expect
      .poll(() => app.evaluate(() => globalThis.audioRequests.at(-1)))
      .toBe('/recording-' + (17 + i) + '.mp3')
    await played()
  }
  await page.screenshot({ path: path.join(root, 'versions.png') })
  assert.equal((await fs.readdir(downloads)).length, 0)
  await versions.nth(1).getByRole('button', { name: '下载', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已下载并入库')
  assert.match(
    (await fs.readdir(downloads)).find((f) => f.endsWith('.mp3')),
    /Live/,
  )
  await tab('每日推荐').click()
  await news().getByRole('button', { name: '管理关注' }).click()
  await news().getByLabel('要关注的歌手').fill('青禾')
  await button('查找歌手').click()
  await button('关注青禾').click()
  await expect(news().getByText('初雪', { exact: true })).toBeVisible()
  await expect(news().getByText('旧作')).toHaveCount(0)
  await expect(page.locator('.music-list li')).toHaveCount(0)
  await expect(page.getByLabel('推荐首数')).toHaveValue('5')
  await page.screenshot({ path: path.join(root, 'artist-news.png') })
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  await tab('每日推荐').click()
  await expect(news().getByText('初雪', { exact: true })).toBeVisible()
  await button('管理关注').click()
  await button('取消关注青禾').click()
  await expect(news().getByText('初雪', { exact: true })).toHaveCount(0)
  await tab('本地曲库').click()
  await button('专辑').click()
  await button('山色 · 青禾').click()
  assert.ok(!(await app.evaluate(() => globalThis.catalogRequests)).includes('/ws/2/release'))
  await button('查看完整发行曲目').click()
  const editions = page.getByRole('region', { name: '发行版本曲目' })
  const choose = editions.getByRole('combobox')
  await choose.click()
  await expect(page.getByRole('listbox')).toBeVisible()
  await page.screenshot({ path: path.join(root, 'edition-menu.png') })
  await page.getByRole('option', { name: /普通版/ }).click()
  await expect(editions.getByText('2.2 初版曲')).toBeVisible()
  await choose.click()
  await page.getByRole('option', { name: /豪华版/ }).click()
  await expect(editions.getByText('2.2 缺少曲')).toBeVisible()
  const trackRow = (name) =>
    editions.getByRole('listitem').filter({ has: page.getByText(name, { exact: true }) })
  await expect(trackRow('1.1 远山').getByRole('button', { name: '搜索缺曲' })).toBeVisible()
  await expect(trackRow('2.1 远山').getByText('已收录', { exact: true })).toBeVisible()
  for (const title of ['1.2 无编号', '2.3 无编号'])
    await expect(trackRow(title).getByRole('button', { name: '搜索缺曲' })).toBeVisible()
  await expect(trackRow('1.3 唯一曲目').getByText('已收录', { exact: true })).toBeVisible()
  await page.screenshot({ path: path.join(root, 'editions.png') })
  await trackRow('2.2 缺少曲').getByRole('button', { name: '搜索缺曲' }).click()
  await expect(page.getByRole('textbox', { name: '搜索关键词' })).toHaveValue('缺少曲 青禾')
  await expect(
    page.getByRole('region', { name: '搜索音乐' }).getByText('缺少曲', { exact: true }),
  ).toBeVisible()
  console.log(
    'PASS 同曲版组、逐项播放/时长/下载、关注与跨重启新发行、发行版本切换与缺曲搜索 ' + root,
  )
} finally {
  await app.close()
}
