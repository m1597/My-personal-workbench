import { openDiscovery } from './discovery-fixture.mjs'
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
const coverTitle = 'I BEG YOU（翻自 Aimer）'
const coverFile = path.join(root, 'cover.mp3')
const bytes = await fs.readFile(tone)
const textFrame = (id, value) => {
  const b = Buffer.concat([Buffer.from([3]), Buffer.from(value)])
  const h = Buffer.alloc(10)
  h.write(id)
  h.writeUInt32BE(b.length, 4)
  return Buffer.concat([h, b])
}
const frames = Buffer.concat([
  textFrame('TCOM', '本地作曲者'),
  textFrame('TIPL', 'arranger\0本地编曲者'),
  textFrame('TMCL', 'bass\0贝斯手甲,贝斯手乙'),
])
const header = Buffer.from([73, 68, 51, 4, 0, 0, 0, 0, 0, 0])
for (let i = 0; i < 4; i++) header[9 - i] = (frames.length >>> (7 * i)) & 127
await fs.writeFile(
  coverFile,
  Buffer.concat([
    header,
    frames,
    bytes.subarray(10 + bytes.subarray(6, 10).reduce((a, b) => a * 128 + b, 0)),
  ]),
)
store.library.upsert({
  file: coverFile,
  title: coverTitle,
  artist: '翻唱歌手',
  album: '现场录音',
  duration: 1,
})
const navRows = [
  ...Array.from({ length: 20 }, (_, i) => ['先前歌曲' + i, '测试歌手', '占位']),
  ['神様のいうとおり', '春間無Nashi', '神様のいうとおり'],
  ['冬のはなし', 'Given', ''],
  ['三原色（翻自 YOASOBI）', '小幻', '三原色'],
  ...Array.from({ length: 15 }, (_, i) => ['其他歌曲' + i, '测试歌手', '占位']),
]
const navIds = []
for (const [i, [title, artist, album]] of navRows.entries()) {
  const file = path.join(root, 'nav-' + i + '.mp3')
  await fs.copyFile(tone, file)
  store.library.upsert({ file, title, artist, album, albumArtist: artist, duration: 3 })
  navIds.push(store.db.prepare('SELECT id FROM local_tracks WHERE file=?').get(file).id)
}
store.library.createPlaylist('截图歌单', navIds)
const listId = store.library.createPlaylist('发行试听')
store.db.close()
await fs.writeFile(
  source,
  `// @name 版本归组源
lx.on('request',({action,info})=>{
 if(action==='search') {
   if(['Morning Aimer','Night Aimer','Evening Aimer','Daylight Aimer'].includes(info.keyword)){
     const title=info.keyword.split(' ')[0]
     return [{id:'missing',name:title,singer:'Aimer',albumName:({Evening:'Instrumental Edition',Daylight:'Tokyo Live'})[title] || 'Studio Recording'}]
   }
   if(info.keyword==='海へ ギヴン')return [{id:'missing',name:'海へ',singer:'ギヴン',albumName:'海へ'}]
   if(info.keyword==='i beg you yurisa')return [{id:'highlight',name:'i beg you',singer:'yurisa',interval:'04:29'}]
   if(info.keyword==='Vogel im Käfig 澤野弘之')return [{id:'sawano',name:'Vogel im Käfig',singer:'澤野弘之'}]
   if(info.keyword==='夜风 云海')return [{id:'highlight',name:'夜风',singer:'云海'}]
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
      if (
        !/^https:\/\/1\.1\.1\.1\/(?:recording-(?:17|18)|missing|highlight|sawano)\.mp3$/.test(
          url.href,
        )
      )
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
      const given = '5f077093-f2cd-4839-9158-51db217fba81',
        release = '12345678-0001-1234-1234-000000000001',
        edition = '12345678-0002-1234-1234-000000000002'
      const credit = [
        { name: 'ギヴン', artist: { name: 'ギヴン', 'sort-name': 'given', id: given } },
      ]
      const q = url.searchParams.get('query') ?? ''
      if (entity === 'recording' && q.includes('冬のはなし'))
        return Response.json({
          count: 1,
          recordings: [{ title: '冬のはなし', 'artist-credit': credit }],
        })
      if (entity === 'release-group' && q.includes(given))
        return Response.json({
          'release-groups': [
            {
              id: release,
              title: '海へ',
              'primary-type': 'Album',
              'artist-credit': credit,
              'first-release-date': '2024',
            },
          ],
        })
      if (entity === 'release' && q.includes(release))
        return Response.json({
          releases: [{ id: edition, title: '海へ', 'artist-credit': credit }],
        })
      if (entity === edition)
        return Response.json({
          'artist-credit': credit,
          media: [{ position: 1, tracks: [{ number: '1', title: '海へ' }] }],
        })
      if (entity === 'release' && (q.includes('神様のいうとおり') || q.includes('三原色'))) {
        const title = q.includes('三原色') ? '三原色' : '神様のいうとおり',
          artist = title === '三原色' ? '小幻' : '春間無Nashi'
        const base = title === '三原色' ? '2' : '1'
        return Response.json({
          releases: [
            { id: first, title, 'artist-credit': [{ name: '无关同名艺人' }] },
            ...['普通版', '豪华版'].map((disambiguation, i) => ({
              id: `12345678-0003-1234-1234-0000000000${base}${i}`,
              title,
              disambiguation,
              'artist-credit': [{ name: artist }],
            })),
          ],
        })
      }
      if (entity.startsWith('12345678-0003-')) {
        const isMihara = entity.at(-2) === '2'
        const artist = isMihara ? '小幻' : '春間無Nashi'
        const title = isMihara ? '三原色（翻自 YOASOBI）' : '神様のいうとおり'
        return Response.json({
          'artist-credit': [{ name: artist }],
          media: [{ position: 1, tracks: [{ number: '1', title }] }],
        })
      }
      const wid = '04574440-b752-49eb-8ce7-75aa82113cd6',
        rid = '8efb27e4-aa62-4999-821d-6482df5e7238',
        composer = '67e344da-ec54-4e26-b2a4-8351d744a14c'
      const song = (id, singer, title = 'I beg you') => ({
        id,
        title,
        length: 269000,
        'artist-credit': [{ name: singer }],
      })
      if (entity === 'recording' && url.searchParams.get('query')?.startsWith('recording:')) {
        return Response.json({
          count: 2,
          recordings: [song(rid, 'Aimer'), song(second, '同名异作艺人')],
        })
      }
      if (entity === rid)
        return Response.json({
          relations: [{ type: 'performance', work: { id: wid, title: 'I beg you' } }],
        })
      if (entity === wid)
        return Response.json({
          title: 'I beg you',
          relations: [
            { type: 'composer', artist: { id: composer, name: '梶浦由記' } },
            ...[
              ['Morning', 'live'],
              ['Night', 'instrumental'],
              ['Evening', 'instrumental'],
              ['Daylight', 'live'],
            ].map(([title, attr], i) => ({
              type: 'performance',
              attributes: [attr],
              recording: {
                id: '10000000-1000-1000-1000-10000000000' + i,
                title,
                'artist-credit': [{ name: 'Aimer' }],
              },
            })),
            ...[
              [rid, 'Aimer', []],
              [first, 'yurisa', ['cover']],
              [second, 'Aimer', ['live']],
            ].map(([id, singer, attributes]) => ({
              type: 'performance',
              attributes,
              recording: song(
                id,
                singer,
                attributes.includes('cover')
                  ? 'i beg you'
                  : attributes.includes('live')
                    ? 'I beg you (Live)'
                    : 'I beg you',
              ),
            })),
          ],
        })
      if (entity === composer)
        return Response.json({
          relations: [
            { type: 'composer', work: { id: wid, title: 'I beg you' } },
            { type: 'composer', work: { id: first, title: '花の唄' } },
          ],
        })
      const related = '00000000-0000-0000-0000-000000000006'
      if (entity === artist || entity === related)
        return Response.json({
          genres: [
            { name: 'rock', count: 3 },
            { name: 'jazz', count: 2 },
          ],
          relations: [{ type: 'founder', artist: { id: first, name: '关系组合' } }],
        })
      if (url.pathname.endsWith('/artist/') && url.searchParams.get('query')?.includes('tag:')) {
        return Response.json({
          artists: [
            { id: first, name: '单标签', tags: [{ name: 'rock', count: 50 }] },
            { id: second, name: '关系组合', tags: [] },
            {
              id: related,
              name: '云海',
              tags: [
                { name: 'rock', count: 1 },
                { name: 'jazz', count: 1 },
              ],
            },
            {
              id: artist,
              name: '青禾',
              tags: [
                { name: 'rock', count: 2 },
                { name: 'jazz', count: 2 },
              ],
            },
          ],
        })
      }
      const sawano = '60d2ea34-1912-425f-bf9c-fc544e4448cd'
      const sawanoCredit = [{ name: '澤野弘之', artist: { id: sawano, name: '澤野弘之' } }]
      const query = url.searchParams.get('query') ?? ''
      if (entity === 'artist' && query.includes('澤野弘之'))
        return Response.json({ artists: [sawanoCredit[0].artist] })
      if (entity === sawano) return Response.json({ relations: [] })
      if (entity === 'recording' && query.includes(sawano))
        return Response.json({
          recordings: [{ title: 'Vogel im Käfig', 'artist-credit': sawanoCredit }],
        })
      if (
        entity === 'release-group' &&
        query.includes(sawano) &&
        !query.includes('firstreleasedate')
      )
        return Response.json({
          'release-groups': [
            {
              id: first,
              title: '進撃の巨人',
              'primary-type': 'Album',
              'artist-credit': sawanoCredit,
            },
          ],
        })
      if (entity === 'recording')
        return Response.json({
          recordings: [
            { title: '夜风', 'artist-credit': [{ artist: { id: related, name: '云海' } }] },
          ],
        })
      if (entity === 'artist')
        return Response.json({ artists: [{ id: artist, name: '青禾', disambiguation: '乐队' }] })
      if (entity === 'release-group')
        return Response.json({
          'release-groups': [
            {
              id: first,
              title: '初雪',
              'primary-type': 'Single',
              'first-release-date': today,
              'artist-credit': artistCredit,
            },
            {
              id: '00000000-0000-0000-0000-000000000004',
              title: '薄暮',
              'primary-type': 'Album',
              'artist-credit': artistCredit,
              'first-release-date': new Date(Date.now() - 86400000 * 5).toISOString().slice(0, 10),
            },
            {
              id: '00000000-0000-0000-0000-000000000005',
              title: '映画',
              'primary-type': 'Album',
              'secondary-types': ['Soundtrack'],
              'artist-credit': artistCredit,
              'first-release-date': new Date(Date.now() - 86400000 * 9).toISOString().slice(0, 10),
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
      if (entity === second && globalThis.failEditionOnce) {
        globalThis.failEditionOnce = false
        return new Response(null, { status: 503 })
      }
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
  await openDiscovery(page, false)
  const input = page.getByRole('textbox', { name: '搜索关键词' })
  await input.fill('远山')
  await input.press('Enter')
  const group = page.locator('.version-group details')
  await expect(group.locator('summary')).toHaveText('远山 · 青禾 · 2 个版本')
  await expect(page.locator('.search-recording').filter({ hasText: '另一人' })).toContainText(
    '时长未知',
  )
  await expect(group).toHaveCount(1)
  for (const name of ['访客', '问候', '无标记'])
    await expect(page.getByText(name, { exact: true })).toHaveCount(2)
  await expect(page.getByText('远山 (月亮)', { exact: true })).toBeVisible()
  await expect(group).toHaveAttribute('open', '')
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
  await tab('歌手').click()
  await expect(button('管理关注')).toHaveCount(0)
  await news().getByLabel('要关注的歌手').fill('青禾')
  await news().getByLabel('要关注的歌手').press('Enter')
  await button('关注青禾').click()
  await expect(news().getByText('初雪', { exact: true })).toBeVisible()
  await expect(news().getByText('旧作')).toHaveCount(0)
  await expect(page.locator('.music-list li')).toHaveCount(0)
  await expect(
    news().locator(':is(:scope, .release-news-column) > ul .release-event-head strong'),
  ).toHaveText(['初雪', '薄暮', '映画'])
  for (const [i, type] of ['单曲', '专辑', '原声带'].entries())
    await expect(
      news().locator(':is(:scope, .release-news-column) > ul .release-event-head small').nth(i),
    ).toContainText(type)
  await news().getByRole('button', { name: '查看曲目' }).first().click()
  const pick = news().getByRole('button', { name: '播放', exact: true }).first()
  await expect(pick).toBeVisible()
  const selector = news().getByRole('combobox', { name: '动态发行版本' })
  await app.evaluate(() => {
    globalThis.failEditionOnce = true
  })
  await selector.click()
  await page.getByRole('option', { name: /豪华版/ }).click()
  await expect(news().getByRole('alert')).toContainText('暂时无法访问')
  const failedRequests = await app.evaluate(() => globalThis.catalogRequests)
  await news().getByRole('button', { name: '重试' }).click()
  await expect(news().getByText('2.2 缺少曲', { exact: true })).toBeVisible()
  await expect(selector).toContainText('豪华版')
  const requests = await app.evaluate(() => globalThis.catalogRequests)
  assert.deepEqual(requests.slice(failedRequests.length), [
    '/ws/2/release/00000000-0000-0000-0000-000000000002',
  ])
  await news().getByRole('button', { name: '收起曲目' }).click()
  await news().getByRole('button', { name: '查看曲目' }).first().click()
  await expect(pick).toBeVisible()
  assert.deepEqual(await app.evaluate(() => globalThis.catalogRequests), requests)
  await selector.click()
  await page.getByRole('option', { name: /豪华版/ }).click()
  await expect(news().getByText('2.2 缺少曲', { exact: true })).toBeVisible()
  await pick.scrollIntoViewIfNeeded()
  const scroll = () => page.locator('.music-scroll').evaluate((el) => el.scrollTop)
  const before = await scroll()
  await pick.click()
  await expect(tab('歌手')).toHaveAttribute('aria-selected', 'true')
  await expect(selector).toContainText('豪华版')
  await expect(news().getByRole('button', { name: '收起曲目' })).toBeVisible()
  assert.equal(await scroll(), before)
  await expect
    .poll(() => app.evaluate(() => globalThis.audioRequests.at(-1)))
    .toBe('/recording-17.mp3')
  await played()
  await news()
    .getByRole('listitem')
    .filter({ has: page.getByText('1.2 无编号', { exact: true }) })
    .getByRole('button', { name: '播放', exact: true })
    .last()
    .click()
  await expect(news().getByRole('alert')).toContainText('未找到这首歌的可播放版本')
  await expect(tab('歌手')).toHaveAttribute('aria-selected', 'true')
  await openDiscovery(page, true)
  await expect(page.getByLabel('推荐首数')).toHaveValue('5')
  await expect(news()).toHaveCount(0)
  await tab('歌手').click()
  await expect(news().getByText('初雪', { exact: true })).toBeVisible()
  assert.deepEqual(await app.evaluate(() => globalThis.catalogRequests), requests)
  await page.screenshot({ path: path.join(root, 'artist-news.png') })
  const similar = news().getByRole('region', { name: '相似歌手' })
  await expect(similar.getByText('云海', { exact: true })).toBeVisible()
  await expect(similar.getByText('青禾', { exact: true })).toHaveCount(0)
  await expect(similar.locator('.catalog-text-link')).toHaveText(['云海', '单标签'])
  await expect(similar.getByText('共同风格 · rock、jazz')).toBeVisible()
  await expect(similar.getByText('关系组合')).toHaveCount(0)
  await similar.getByRole('button', { name: '代表作' }).first().click()
  await similar.getByRole('button', { name: '试听' }).click()
  await expect
    .poll(() => app.evaluate(() => globalThis.audioRequests.at(-1)))
    .toBe('/highlight.mp3')
  await played()
  await similar.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await page.screenshot({ path: path.join(root, 'similar-artists.png') })
  const home = page.getByRole('region', { name: '歌手主页' })
  await similar.getByRole('button', { name: '云海', exact: true }).click()
  await expect(home.getByText('夜风', { exact: true })).toBeVisible()
  await home.getByRole('button', { name: '返回' }).click()
  await similar.getByRole('button', { name: '关注云海' }).click()
  const cloudCard = news()
    .locator('.followed-artist-card')
    .filter({ has: button('云海') })
  const cloudToggle = cloudCard.getByRole('button', { name: '取消关注云海' })
  await expect(cloudToggle.locator('.follow-status')).toBeVisible()
  await cloudToggle.hover()
  await expect(cloudToggle.locator('.follow-cancel')).toBeVisible()
  await cloudToggle.click()
  await expect(cloudCard).toHaveCount(0)
  await expect(similar.getByRole('button', { name: '关注云海' })).toHaveText('关注')
  await similar.getByRole('button', { name: '关注云海' }).click()
  await news().getByRole('heading', { name: '我关注的歌手' }).hover()
  await expect(
    similar.getByRole('button', { name: '取消关注云海' }).locator('.follow-status'),
  ).toBeVisible()
  await cloudCard.getByRole('button', { name: '云海', exact: true }).click()
  await expect(home.getByText('夜风', { exact: true })).toBeVisible()
  await home.getByRole('button', { name: '返回' }).click()
  await expect(similar.getByRole('heading')).toHaveText('与云海相似的歌手')
  await expect(similar.getByRole('button', { name: '取消关注青禾' })).toBeVisible()

  await expect(button('管理关注')).toHaveCount(0)
  await news().getByLabel('要关注的歌手').fill('澤野弘之')
  await button('查找歌手').click()
  await button('关注澤野弘之').click()
  const portrait = news().getByRole('button', { name: '澤野弘之', exact: true })
  await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].setContentSize(660, 520))
  await portrait.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  const savedArtistScroll = await scroll()
  assert.ok(savedArtistScroll > 0)
  await portrait.locator('img').click()
  await expect(home.getByRole('heading', { name: '澤野弘之', exact: true })).toBeVisible()
  await expect(home.getByText('Vogel im Käfig', { exact: true })).toBeVisible()
  await home.getByRole('button', { name: '播放', exact: true }).click()
  await expect.poll(() => app.evaluate(() => globalThis.audioRequests.at(-1))).toBe('/sawano.mp3')
  await played()
  await page.screenshot({ path: path.join(root, 'sawano-artist-home.png') })
  await home.getByRole('button', { name: /進撃の巨人/ }).click()
  const sawanoAlbum = page.getByRole('region', { name: '专辑主页' })
  await expect(sawanoAlbum.getByText('1.1 远山', { exact: true })).toBeVisible()
  await sawanoAlbum.getByRole('button', { name: '返回' }).click()
  await home.getByRole('button', { name: '返回' }).click()
  assert.equal(await scroll(), savedArtistScroll)
  await expect(similar.getByText('风格标签资料不足，暂无可核实的相似歌手。')).toBeVisible()
  await expect(portrait).toBeInViewport()
  await page.screenshot({ path: path.join(root, 'sawano-return.png') })
  await button('取消关注澤野弘之').click()
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  await tab('歌手').click()
  await expect(news().getByText('初雪', { exact: true })).toBeVisible()
  await expect(button('管理关注')).toHaveCount(0)
  await news()
    .locator('.followed-artist-card')
    .getByRole('button', { name: '取消关注青禾' })
    .click()
  await expect(news().getByText('初雪', { exact: true })).toHaveCount(0)
  await tab('曲库').click()
  await button('专辑').click()
  await button('山色 · 青禾').click()
  assert.ok(!(await app.evaluate(() => globalThis.catalogRequests)).includes('/ws/2/release'))
  await button('查看完整发行曲目').click()
  const editions = page.getByRole('region', { name: '发行版本曲目' })
  const choose = editions.getByRole('combobox', { name: '发行版本', exact: true })
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
  await app.evaluate(({ shell }) => {
    shell.showItemInFolder = (file) => {
      globalThis.revealedTrack = file
    }
  })
  await trackRow('2.1 远山').click({ button: 'right' })
  await page.getByRole('menuitem', { name: '查看文件所在位置' }).click()
  assert.equal(await app.evaluate(() => globalThis.revealedTrack), tone)
  for (const title of ['1.2 无编号', '2.3 无编号'])
    await expect(trackRow(title).getByRole('button', { name: '搜索缺曲' })).toBeVisible()
  await expect(trackRow('1.3 唯一曲目').getByText('已收录', { exact: true })).toBeVisible()
  await page.screenshot({ path: path.join(root, 'editions.png') })
  await trackRow('2.2 缺少曲').getByRole('button', { name: '搜索缺曲' }).click()
  const missing = trackRow('2.2 缺少曲')
  await missing.getByRole('button', { name: '播放', exact: true }).click()
  await expect.poll(() => app.evaluate(() => globalThis.audioRequests.at(-1))).toBe('/missing.mp3')
  await played()
  await expect(choose).toContainText('豪华版')
  await missing.getByRole('combobox', { name: '加入歌单' }).click()
  await page.getByRole('option', { name: '发行试听' }).click()
  await expect(missing.getByRole('status')).toHaveText('已加入发行试听')
  const saved = await page.evaluate(
    async (id) => (await window.music.state()).playlists.find((p) => p.id === id).tracks.length,
    listId,
  )
  assert.equal(saved, 1)
  assert.equal((await fs.readdir(downloads)).filter((f) => f.endsWith('.mp3')).length, 1)
  await missing.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await page.screenshot({ path: path.join(root, 'inline-missing.png') })
  await openDiscovery(page, false)
  await tab('曲库').click()
  await button('全部歌曲').click()
  await button('播放' + coverTitle).click()
  await button('打开歌词页').click()
  await button('其他演绎').click()
  const details = page.getByRole('dialog', { name: '歌曲资料' })
  await expect(details.getByText('Aimer · 原唱')).toBeVisible()
  await expect(details.getByText('Aimer · 现场').first()).toBeVisible()
  await expect(details.getByText('同名异作艺人')).toHaveCount(0)
  for (const [title, playable] of [
    ['Morning', false],
    ['Night', false],
    ['Daylight', true],
    ['Evening', true],
  ]) {
    const candidate = details
      .getByRole('listitem')
      .filter({ has: page.getByText(title, { exact: true }) })
    await candidate.getByRole('button', { name: '查找音源' }).click()
    if (playable) await expect(candidate.getByRole('button', { name: '试听' })).toBeVisible()
    else {
      await expect(details.getByRole('status')).toContainText('未找到能确认版本')
      await expect(candidate.getByRole('button', { name: '试听' })).toHaveCount(0)
    }
  }
  const version = details.getByRole('listitem').filter({ hasText: 'yurisa' })
  await version.getByRole('button', { name: '查找音源' }).click()
  await version.getByRole('combobox', { name: '加入歌单' }).click()
  await page.getByRole('option', { name: '发行试听' }).click()
  await expect(details.getByRole('status')).toHaveText('已加入发行试听')
  await version.getByRole('button', { name: '试听' }).click()
  await played()
  await page.screenshot({ path: path.join(root, 'song-versions.png') })
  await details.getByRole('tab', { name: '参与人员' }).click()
  await expect(details.getByText('翻唱歌手', { exact: true })).toBeVisible()
  await expect(details.getByText('本地作曲者')).toBeVisible()
  await expect(details.getByText('本地编曲者')).toBeVisible()
  await expect(details.getByText('贝斯手甲')).toBeVisible()
  await expect(details.getByText('贝斯手乙')).toBeVisible()
  await details.getByRole('button', { name: '梶浦由記' }).click()
  await expect(details.getByText('花の唄')).toBeVisible()
  await page.screenshot({ path: path.join(root, 'song-credits.png') })
  await details.getByRole('button', { name: '关闭' }).click()
  await button('返回').click()
  await button('播放唯一曲目').click()
  await button('打开歌词页').click()
  await button('其他演绎').click()
  await expect(details.getByText('资料不足，暂无可确认的其他演绎。')).toBeVisible()
  await details.getByRole('button', { name: '关闭' }).click()
  await tab('歌单').click()
  await button('截图歌单').click()
  for (const area of ['歌单', '曲库']) {
    await tab(area).click()
    if (area === '曲库') await button('全部歌曲').click()
    const row = page
      .locator('.library-row')
      .filter({ has: page.getByText('三原色（翻自 YOASOBI）', { exact: true }) })
    const changeSong = async () => {
      await button('播放冬のはなし').click()
      await played()
    }
    const isTarget = async () => {
      await expect(row.getByRole('button', { name: '暂停三原色（翻自 YOASOBI）' })).toBeVisible()
      await played()
      await expect(page.getByRole('region', { name: '歌手主页' })).toHaveCount(0)
      await expect(page.getByRole('region', { name: '专辑主页' })).toHaveCount(0)
    }
    await changeSong()
    await row.locator('.library-track-title strong').click()
    await isTarget()
    for (const [linkName, region] of [
      ['小幻', '歌手主页'],
      ['三原色', '专辑主页'],
    ]) {
      await changeSong()
      const link = row.getByRole('button', { name: linkName, exact: true })
      await link.scrollIntoViewIfNeeded()
      const point = await link.evaluate((el) => {
        const r = el.getBoundingClientRect(),
          parent = el.parentElement.getBoundingClientRect()
        if (r.right + 4 >= parent.right) throw Error('文本链接占满列宽')
        const x = r.right + 4,
          y = r.top + r.height / 2
        if (document.elementFromPoint(x, y)?.closest('button')) throw Error('文字旁误命中链接')
        return { x, y }
      })
      await page.mouse.click(point.x, point.y)
      await isTarget()
      await link.click()
      const opened = page.getByRole('region', { name: region })
      await expect(opened.getByRole('heading', { name: linkName, exact: true })).toBeVisible()
      await opened.getByRole('button', { name: '返回' }).click()
    }
    await button('多选').click()
    await row.getByRole('checkbox').check()
    await expect(row.getByRole('checkbox')).toBeChecked()
    await expect(row.locator('button.catalog-text-link')).toHaveCount(0)
    await button('退出多选').click()
  }
  await tab('歌单').click()
  await button('截图歌单').click()
  const givenRow = page.locator('.library-row').filter({ hasText: '冬のはなし' })
  const given = givenRow.getByRole('button', { name: 'Given', exact: true })
  await given.scrollIntoViewIfNeeded()
  const navScroll = () => page.locator('.music-scroll').evaluate((el) => el.scrollTop)
  const savedScroll = await navScroll()
  assert.ok(savedScroll > 100)
  await expect(givenRow.locator('.library-album button')).toHaveCount(0)
  await given.click()
  const artistHome = page.getByRole('region', { name: '歌手主页' }),
    albumHome = page.getByRole('region', { name: '专辑主页' })
  await expect(artistHome.getByRole('heading', { name: 'Given', exact: true })).toBeVisible()
  const audioBefore = await app.evaluate(() => globalThis.audioRequests.length)
  await artistHome.getByRole('button', { name: '播放冬のはなし' }).click()
  await played()
  assert.equal(await app.evaluate(() => globalThis.audioRequests.length), audioBefore)
  await expect(artistHome.getByRole('button', { name: /海へ/ })).toBeVisible()
  await page.screenshot({ path: path.join(root, 'given-home.png') })
  await artistHome.getByRole('button', { name: /海へ/ }).click()
  await albumHome.getByRole('button', { name: '播放', exact: true }).click()
  await expect
    .poll(() => app.evaluate(() => globalThis.audioRequests.length))
    .toBeGreaterThan(audioBefore)
  await played()
  await expect(albumHome.getByRole('heading', { name: '海へ', exact: true })).toBeVisible()
  await page.screenshot({ path: path.join(root, 'given-album.png') })
  await albumHome.getByRole('button', { name: '返回' }).click()
  await expect(artistHome.getByRole('heading', { name: 'Given' })).toBeVisible()
  await artistHome.getByRole('button', { name: '返回' }).click()
  assert.equal(await navScroll(), savedScroll)
  for (const [title, artist] of [
    ['神様のいうとおり', '春間無Nashi'],
    ['三原色', '小幻'],
  ]) {
    if (title === '三原色') await page.setViewportSize({ width: 510, height: 850 })
    await page
      .locator('.library-row')
      .filter({ hasText: artist })
      .getByRole('button', { name: title, exact: true })
      .click()
    await expect(albumHome.getByRole('heading', { name: title, exact: true })).toBeVisible()
    await expect(albumHome.getByText(artist, { exact: true }).first()).toBeVisible()
    await expect(albumHome.getByText('请选择发行版本以查看曲目。')).toBeVisible()
    await albumHome.getByRole('combobox', { name: '发行版本' }).click()
    await expect(page.getByRole('option', { name: /无关同名艺人/ })).toHaveCount(0)
    await page.getByRole('option', { name: /豪华版/ }).click()
    await expect(albumHome.getByRole('combobox')).toContainText('豪华版')
    await expect(albumHome.locator('.release-track-picker li')).toContainText(artist)
    await page.screenshot({ path: path.join(root, title + '-album.png') })
    await albumHome.getByRole('button', { name: '返回' }).click()
  }
  console.log(
    'PASS 同曲版组、逐项播放/时长/下载、关注与跨重启新发行、发行版本切换与缺曲搜索 ' + root,
  )
} finally {
  await app.close()
}
