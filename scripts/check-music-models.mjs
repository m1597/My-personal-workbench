import { writeFixtureRecording } from './music-recording-fixture.mjs'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs/promises'
import { MusicTaste } from '../examples/component-host/music-taste.mjs'
import { once } from 'node:events'
import { MusicStore } from '../components/music/store.mjs'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron, expect } from '@playwright/test'
import {
  artistMatches,
  titleMatch,
  inLibrary,
  searchRecommendation,
  namesRequestedArtist,
} from '../examples/component-host/music-discovery.mjs'
assert.ok(artistMatches('mizuki', '瑞葵(mizuki) / SawanoHiroyuki[nZk]'))
assert.ok(artistMatches('AC/DC', 'AC/DC & Guest'))
assert.ok(artistMatches('Sakuzyo', '削除', [['削除', 'Sakuzyo']]))
assert.ok(
  inLibrary({ title: 'BOW AND ARROW', artist: '米津玄師' }, [
    { title: 'BOW AND ARROW - 米津玄師', artist: '未知艺人' },
  ]),
)
assert.ok(
  inLibrary({ title: 'Song', artist: 'Artist' }, [{ title: 'Artist - Song', artist: 'Artist' }]),
)
assert.equal(
  titleMatch({ title: 'Song', artist: 'Artist' }, { name: 'Song (Live)', singer: 'Artist' }),
  'variant',
)
assert.equal(
  titleMatch({ title: 'Song', artist: 'Artist' }, { name: 'Song', singer: 'Different Artist' }),
  '',
)
assert.equal(namesRequestedArtist('比如 A、B 这类，尽量每位音乐人一首', 'A', true), false)
assert.equal(namesRequestedArtist('ambient', 'A', true), false)
assert.equal(namesRequestedArtist('想听 AC/DC 本人的歌', 'AC/DC'), true)
const song = { title: '群青', artist: 'YOASOBI' }
const cover = { name: '群青（Cover. YOASOBI）', singer: '梨绪Rio' }
assert.equal(titleMatch(song, cover), 'cover')
assert.equal(titleMatch(song, cover, { version: 'original' }), '')
assert.equal(titleMatch(song, cover, { artist: 'YOASOBI' }), '')
assert.equal(titleMatch(song, { name: '群青', singer: '其他艺人' }), '')
assert.equal(titleMatch(song, { name: '群青 - 另一首歌', singer: 'YOASOBI' }), '')
assert.equal(
  titleMatch(
    song,
    { name: '群青 (YOASOBI 5th ANNIVERSARY DOME LIVE 2024 “超現実”)', singer: 'YOASOBI' },
    { version: 'live' },
  ),
  'variant',
)
assert.equal(titleMatch(song, { name: '群青', singer: 'YOASOBI' }, { version: 'live' }), '')
assert.equal(
  titleMatch({ title: 'Blue', artist: 'A' }, { name: '青', titleAliases: ['Blue'], singer: 'A' }),
  'exact',
)
assert.equal(
  titleMatch({ title: 'Blue', artist: 'A' }, { name: '青', titleAliases: ['Blue'], singer: 'B' }),
  '',
)
for (const [a, b] of [
  ['Cover Adele', 'Cover Lionel Richie'],
  ['Alpha Remix', 'Beta Remix'],
  ['Live 2019', 'Live 2023'],
]) {
  const left = { title: 'Hello (' + a + ')', artist: 'Performer' }
  const right = { title: 'Hello (' + b + ')', artist: 'Performer' }
  assert.equal(titleMatch(left, right), '')
  assert.equal(inLibrary(left, [right]), false)
}
const searches = []
const recovered = await searchRecommendation(
  { title: '０１. Blue', artist: 'Artist' },
  'wy',
  async (q, page) => {
    searches.push([q.title, q.artist, page])
    if (q.title === 'blue' && !q.artist)
      return page === 1
        ? { items: [{ name: 'other', singer: 'Artist' }], hasMore: true }
        : [{ name: 'Blue', singer: 'Artist' }]
    return []
  },
  new AbortController().signal,
)
assert.equal(recovered.matches.length, 1)
assert.ok(searches.some(([title, artist, page]) => title === 'blue' && !artist && page === 2))
await fs.mkdir('tmp', { recursive: true })
const root = await fs.mkdtemp(path.resolve('tmp/music-models-')),
  profile = path.join(root, 'profile')
const fixtureStore = new MusicStore(path.join(profile, 'fitbay-music'))
fixtureStore.library.upsert({
  title: '已同意的摘要',
  artist: '测试艺人',
  album: '私人专辑',
  duration: 4,
  file: path.resolve('tests/fixtures/local-music/tone.mp3'),
})
const output = path.join(root, 'recommended')
await fs.mkdir(output)
const profileSignals = []
const controlledTaste = new MusicTaste(fixtureStore, root, async (_data, signal) => {
  profileSignals.push(signal)
  await once(signal, 'abort')
  signal.throwIfAborted()
})
controlledTaste.consent(true)
const dedicatedCancel = new AbortController()
const dedicated = controlledTaste.refresh(dedicatedCancel.signal)
dedicatedCancel.abort()
await dedicated
assert.equal(profileSignals[0].aborted, true)
const background = controlledTaste.refresh()
const waitingCancel = new AbortController()
const wait = controlledTaste.refresh(waitingCancel.signal)
waitingCancel.abort()
await assert.rejects(wait, { name: 'AbortError' })
assert.equal(profileSignals[1].aborted, false)
controlledTaste.consent(false)
await background
fixtureStore.db.close()
const launch = () =>
  electron.launch({
    args: [
      path.resolve('dist/component-prototype/host'),
      '--mode=music',
      '--mute-audio',
      '--user-data-dir=' + profile,
      '--workbench=' + path.resolve('out/renderer/index.html'),
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
const app = await launch()
try {
  const page = await app.firstWindow()
  await page.getByRole('tab', { name: '每日推荐' }).click()
  await page.getByLabel('描述你想听什么').fill('雨天的爵士乐')
  await app.evaluate(() => {
    globalThis.providerFixtures = true
    globalThis.modelCalls = []
    globalThis.fetch = async (url, req) => {
      const body = JSON.parse(req.body)
      const id = new URL(url).hostname.split('.')[1]
      globalThis.modelCalls.push({ id, body, headers: req.headers, url })
      if (globalThis.failMode === 'auth') return new Response('{}', { status: 401 })
      if (globalThis.failMode === 'cancel')
        return new Promise((_, reject) =>
          req.signal.addEventListener('abort', () => reject(req.signal.reason), { once: true }),
        )
      const songs = Array.from({ length: 5 }, (_, i) => ({
        title:
          (globalThis.cancelTracks
            ? '取消歌曲'
            : globalThis.rightsTracks
              ? '权限歌曲'
              : globalThis.providerFixtures
                ? id + '歌曲'
                : globalThis.queueTracks
                  ? '队列歌曲'
                  : '样例歌曲') + i,
        artist: i === 0 ? 'AC/DC' : '测试艺人',
        reason: '适合雨天',
      }))
      const result = JSON.stringify(body).includes('可复用的中文音乐品味资料')
        ? { profile: '偏爱氛围音乐与柔和节奏' }
        : { songs }
      const content = globalThis.failMode === 'invalid' ? '{}' : JSON.stringify(result)
      let data
      if (id === 'openai')
        data = { output: [{ type: 'message', content: [{ type: 'output_text', text: content }] }] }
      else if (id === 'anthropic') data = { content: [{ type: 'text', text: content }] }
      else if (id === 'googleapis')
        data = { candidates: [{ content: { parts: [{ text: content }] } }] }
      else data = { choices: [{ message: { content } }] }
      return Response.json(data)
    }
  })
  const unavailable = path.join(root, 'unavailable.js')
  await fs.writeFile(
    unavailable,
    `// @name 协议验收
lx.on('request',()=>[]); lx.send('inited',{sources:{wy:{actions:['search','musicUrl'],qualitys:['320k']}}})`,
  )
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, unavailable)
  await page.evaluate(() => window.music.lxImport())
  for (const [index, id] of ['deepseek', 'openai', 'claude', 'gemini'].entries()) {
    await page.evaluate(async (id) => {
      const p = (await window.music.state()).models.providers.find((p) => p.id === id)
      await window.music.configureModel(id, p.model, 'fixture-' + id, false)
    }, id)
    await page.reload()
    await page.getByRole('tab', { name: '每日推荐' }).click()
    if (!index) {
      await app.evaluate(({ dialog }, directory) => {
        globalThis.folderRequests = []
        dialog.showOpenDialog = async (options) => {
          globalThis.folderRequests.push(options)
          return globalThis.folderRequests.length === 1
            ? { canceled: true, filePaths: [] }
            : { canceled: false, filePaths: [directory] }
        }
      }, output)
      await page.getByRole('button', { name: '生成推荐' }).click()
      await expect.poll(() => app.evaluate(() => globalThis.folderRequests.length)).toBe(1)
      await expect(page.getByRole('button', { name: '生成推荐' })).toBeEnabled()
      await expect(page.getByLabel('描述你想听什么')).toHaveValue('雨天的爵士乐')
      assert.equal(await app.evaluate(() => globalThis.modelCalls.length), 0)
      const cancelled = await page.evaluate(() => window.music.state())
      assert.equal(cancelled.batches.length, 0)
      assert.equal(cancelled.prefs.recommendDir, '')
      assert.deepEqual(await fs.readdir(output), [])
    }
    await page.getByRole('button', { name: '生成推荐' }).click()
    await expect
      .poll(() => page.evaluate(async () => (await window.music.state()).batches.length))
      .toBe(index + 1)
    const requests = await app.evaluate(() => globalThis.folderRequests)
    assert.equal(requests.length, 2)
    assert.ok(
      requests.every(
        (r) => r.title === '选择推荐下载目录' && r.properties.includes('openDirectory'),
      ),
    )
    assert.equal((await page.evaluate(() => window.music.state())).prefs.recommendDir, output)
    await expect(page.getByRole('button', { name: '生成推荐', exact: true })).toBeEnabled({
      timeout: 60000,
    })
    const call = await app.evaluate(() => globalThis.modelCalls.at(-1))
    assert.ok(
      call.url.startsWith(
        {
          deepseek: 'https://api.deepseek.com/',
          openai: 'https://api.openai.com/',
          claude: 'https://api.anthropic.com/',
          gemini: 'https://generativelanguage.googleapis.com/',
        }[id],
      ),
    )
    assert.equal(
      call.headers.Authorization ?? call.headers['x-api-key'] ?? call.headers['x-goog-api-key'],
      (['openai', 'deepseek'].includes(id) ? 'Bearer ' : '') + 'fixture-' + id,
    )
    assert.ok(JSON.stringify(call.body).includes('雨天的爵士乐'))
    assert.ok(!JSON.stringify(call.body).includes('summary'))
    await expect(page.locator('.music-list ol li')).toHaveCount(0)
  }
  await app.evaluate(() => {
    globalThis.providerFixtures = false
  })
  const state = await page.evaluate(() => window.music.state())
  assert.equal(state.items.filter((r) => r.daily).length, 0)
  assert.ok(!JSON.stringify(state).includes('fixture-'))
  const db = new DatabaseSync(path.join(profile, 'fitbay-music/music.sqlite'), { readOnly: true })
  const saved = db
    .prepare("select value from state where key='recommendation-providers'")
    .get().value
  assert.ok(!saved.includes('fixture-'))
  assert.equal(Object.keys(JSON.parse(saved).accounts).length, 4)
  db.close()
  for (const mode of ['auth', 'invalid', 'cancel']) {
    await app.evaluate((_e, m) => {
      globalThis.failMode = m
    }, mode)
    const callCount = await app.evaluate(() => globalThis.modelCalls.length)
    const gen = page.evaluate(() =>
      window.music
        .generate('测试失败路径')
        .then(async (id) => (await window.music.state()).batches.find((b) => b.id === id).message),
    )
    if (mode === 'cancel') {
      await expect.poll(() => app.evaluate(() => globalThis.modelCalls.length)).toBe(callCount + 1)
      await page.evaluate(() => window.music.stopGeneration())
    }
    assert.match(await gen, mode === 'auth' ? /401/ : mode === 'invalid' ? /五首/ : /终止|取消/)
  }
  await app.evaluate(() => {
    globalThis.failMode = ''
  })
  const source = path.join(root, 'source.js')
  await fs.writeFile(
    source,
    `// @name 自动保存源
    lx.on('request',({action,info})=>{
      if(action==='musicUrl') return 'https://1.1.1.1/daily.mp3?title='+encodeURIComponent(info.musicInfo.name);
      const [name,artist]=info.keyword.split(' ');
      const row={id:name,name,singer:artist,albumName:'原版'};
      if(name.endsWith('2')) return [row,{...row,id:name+'-live',albumName:'现场'}];
      if(name.endsWith('3')) return [{...row,allowPermanentSave:false}];
      return [row]
    });
    lx.send('inited',{sources:{wy:{allowPermanentSave:true,actions:['search','musicUrl'],qualitys:['320k']}}})
  `,
  )
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, source)
  await page.evaluate(() => window.music.lxImport())
  const recordings = []
  for (let n = 0; n < 24; n++) {
    const file = path.join(root, 'take-' + n + '.wav')
    await writeFixtureRecording(file, n + 1)
    recordings.push(file)
  }
  await app.evaluate((_e, recordings) => {
    const https = process.getBuiltinModule('node:https'),
      fs = process.getBuiltinModule('node:fs'),
      { EventEmitter } = process.getBuiltinModule('node:events')
    const original = https.request
    globalThis.transfers = 0
    https.request = (url, opts, done) => {
      if (url.origin !== 'https://1.1.1.1' || url.pathname !== '/daily.mp3')
        return original(url, opts, done)
      const file = recordings[globalThis.transfers++]
      const req = new EventEmitter()
      const deliver = () => {
        if (globalThis.slowTransfer && url.searchParams.get('title') === '传输中终止') {
          const { PassThrough } = process.getBuiltinModule('node:stream')
          const stream = Object.assign(new PassThrough(), {
            statusCode: 200,
            headers: {},
            setTimeout() {},
          })
          done(stream)
          stream.write(fs.readFileSync(file).subarray(0, 128))
          return
        }
        done(
          Object.assign(fs.createReadStream(file), {
            statusCode: 200,
            headers: {},
            setTimeout() {},
          }),
        )
      }
      req.end = () => {
        if (globalThis.holdTransfer && url.searchParams.get('title') === '队列歌曲4')
          globalThis.releaseTransfer = deliver
        else deliver()
      }
      return req
    }
  }, recordings)
  const calls = () => app.evaluate(() => globalThis.modelCalls)
  await page.evaluate(() => window.music.setTasteConsent(true))
  const docfile = path.join(profile, 'fitbay-music/music-taste.json')
  await expect.poll(() => fs.readFile(docfile, 'utf8').catch(() => '')).toContain('偏爱氛围')
  const initial = await fs.readFile(docfile, 'utf8')
  const last = JSON.stringify((await calls()).at(-1).body)
  assert.ok(
    last.includes('私人专辑') &&
      last.includes('曲库新增') &&
      !last.includes('tone.mp3') &&
      !last.includes(root),
  )
  const before = (await calls()).length
  await page.getByLabel('描述你想听什么').fill('')
  await page.getByRole('button', { name: '生成推荐' }).click()
  await expect(page.locator('.music-list ol li').filter({ hasText: '已入库' })).toHaveCount(4, {
    timeout: 15000,
  })
  await expect(page.getByRole('button', { name: '生成推荐', exact: true })).toBeEnabled()
  assert.ok((await calls()).length > before + 1)
  const denied = await page.evaluate(async () => (await window.music.state()).batches[0])
  assert.match(denied.details, /明确禁止永久保存/)
  const row = page.locator('.music-list ol li').first()
  await row.getByRole('button', { name: /试听/ }).click()
  await expect.poll(() => page.locator('audio').evaluate((el) => el.currentTime)).toBeGreaterThan(0)
  await page.getByRole('tab', { name: '本地曲库' }).click()
  const library = await page.evaluate(() => window.music.state())
  const list = library.playlists.find((p) => p.system)
  assert.equal(list.name, '歌曲推荐')
  assert.equal(list.tracks.length, 4)
  assert.equal((await fs.readdir(output)).length, 4)
  assert.equal((await page.evaluate(() => window.music.getTasteStatus())).pending, 0)
  const transfers = await app.evaluate(() => globalThis.transfers)
  await page.getByRole('tab', { name: '每日推荐' }).click()
  const artistBatch = await page.evaluate(() => window.music.generate('AC/DC', 'artist', false))
  const artistResult = await page.evaluate(
    async (id) => (await window.music.state()).items.filter((r) => r.batch === id),
    artistBatch,
  )
  assert.deepEqual(artistResult, [])
  assert.equal(await app.evaluate(() => globalThis.transfers), transfers)
  await page.evaluate(async (local) => {
    const p = await window.music.createPlaylist('不发送的私人歌单')
    await window.music.setMembership(p, local, true)
  }, list.tracks[0])
  await app.evaluate(() => {
    globalThis.failMode = 'auth'
  })
  await expect
    .poll(() => page.evaluate(async () => (await window.music.getTasteStatus()).status))
    .toBe('待重试')
  assert.equal(await fs.readFile(docfile, 'utf8'), initial)
  assert.equal((await page.evaluate(() => window.music.getTasteStatus())).pending, 1)
  await app.evaluate(() => {
    globalThis.failMode = ''
  })
  await page.evaluate(() => window.music.generate('AC/DC', 'artist', false))
  const update = JSON.stringify(
    (await calls()).findLast(
      (call) =>
        JSON.stringify(call.body).includes('主动加入自建歌单') &&
        JSON.stringify(call.body).includes('私人专辑'),
    ).body,
  )
  assert.ok(
    update.includes('主动加入自建歌单') &&
      !update.includes('不发送的私人歌单') &&
      !update.includes('tone.mp3'),
  )
  assert.equal((await page.evaluate(() => window.music.getTasteStatus())).pending, 0)
  await page.evaluate(() => window.music.setTasteConsent(false))
  const revoked = (await calls()).length
  await page.evaluate(() => window.music.generate('爵士', 'style'))
  assert.ok((await calls()).length > revoked)
  assert.ok(!JSON.stringify((await calls()).at(-1).body).includes('偏爱氛围音乐与柔和节奏'))
  // A source that publishes ordinary playback URLs, without storage rights, requires an explicit track grant.
  let restricted = (await fs.readFile(source, 'utf8')).replace(
    'allowPermanentSave:true,actions',
    'actions',
  )
  restricted = restricted.replace(
    "if(name.endsWith('2'))",
    "if(name.endsWith('1'))return [{...row,allowPermanentSave:true}]; if(name.endsWith('2'))",
  )
  await fs.writeFile(source, restricted)
  await page.evaluate(() => window.music.lxImport())
  // Exercise per-track permission without the explicitly licensed alternative from the previous case.
  const settingsDb = new DatabaseSync(path.join(profile, 'fitbay-music/music.sqlite'))
  settingsDb
    .prepare('DELETE FROM music_sources WHERE id!=?')
    .run((await page.evaluate(() => window.music.lxSources())).active)
  settingsDb.close()
  await app.evaluate(() => {
    globalThis.rightsTracks = true
  })
  const mixed = await page.evaluate(() => window.music.generate('权限测试', 'style'))
  const rightsRows = await page.evaluate(
    async (batch) => (await window.music.state()).items.filter((r) => r.batch === batch),
    mixed,
  )
  assert.equal(rightsRows.find((r) => r.title.endsWith('1')).status, '已入库')
  assert.equal(rightsRows.length, 1)
  assert.match(
    await page.evaluate(
      async (id) => (await window.music.state()).batches.find((b) => b.id === id).details,
      mixed,
    ),
    /未声明永久保存许可/,
  )
  assert.equal(await app.evaluate(() => globalThis.transfers), transfers + 1)
  await page.reload()
  await page.getByRole('tab', { name: '每日推荐' }).click()
  await page.evaluate(() => {
    delete document.documentElement.dataset.backdrop
  })
  await page.screenshot({ path: path.join(root, 'daily.png') })
  const history = await page.evaluate(() => window.music.state())
  const tasteBefore = await fs.readFile(docfile, 'utf8')
  const filesBefore = await fs.readdir(output)
  await page.getByRole('tab', { name: '本地曲库' }).click()
  const nav = page.getByRole('button', { name: '曲库导航' })
  if (await nav.isVisible()) await nav.click()
  await page.getByRole('button', { name: '歌曲推荐', exact: true }).click()
  const localId = rightsRows.find((r) => r.title === '权限歌曲1').localId
  const localTrack = history.localTracks.find((t) => t.id === localId)
  const listIndex = history.playlists.find((p) => p.system).tracks.indexOf(localId)
  assert.ok(listIndex >= 0)
  const libraryRow = page.locator('.library-row').nth(listIndex)
  await libraryRow.getByText(localTrack.title, { exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: '不感兴趣', exact: true }).click()
  await expect
    .poll(() =>
      page.evaluate(
        async (id) =>
          (await window.music.state()).localTracks.find((t) => t.id === id)?.notInterested,
        localId,
      ),
    )
    .toBe(true)
  const afterFeedback = await page.evaluate(() => window.music.state())
  assert.ok(afterFeedback.localTracks.find((t) => t.id === localId).notInterested)
  assert.deepEqual(afterFeedback.playlists, history.playlists)
  assert.deepEqual(await fs.readdir(output), filesBefore)
  assert.equal(await fs.readFile(docfile, 'utf8'), tasteBefore)
  await page.reload()
  const retry = await page.evaluate(() => window.music.generate('风格测试', 'style'))
  await expect
    .poll(() =>
      page.evaluate(
        async (b) =>
          (await window.music.state()).items
            .filter((r) => r.batch === b && !['正在匹配', '正在保存', '待处理'].includes(r.status))
            .map((r) => r.title)
            .sort(),
        retry,
      ),
    )
    .toEqual([])
  // A changed source recording ID cannot reintroduce an already recommended song.
  await fs.writeFile(
    source,
    restricted.replace('id:name,name,singer', 'id:name+"-second-take",name,singer'),
  )
  await page.evaluate(() => window.music.lxImport())
  const variant = await page.evaluate(() => window.music.generate('版本测试', 'style'))
  const repeat = await page.evaluate(
    async (b) => (await window.music.state()).items.filter((r) => r.batch === b),
    variant,
  )
  assert.deepEqual(repeat, [])
  assert.equal(await app.evaluate(() => globalThis.transfers), transfers + 1)
  await fs.writeFile(
    source,
    `// @name 本批播放验收
    lx.on('request',({action,info})=>{
      if(action==='musicUrl') return 'https://1.1.1.1/daily.mp3?title='+encodeURIComponent(info.musicInfo.name);
      const [name,singer]=info.keyword.split(' ');
      return [{id:name,name,singer,allowPermanentSave:true}]
    });
    lx.send('inited',{sources:{wy:{allowPermanentSave:true,actions:['search','musicUrl'],qualitys:['320k']}}})`,
  )
  await page.evaluate(() => window.music.lxImport())
  await app.evaluate(() => {
    globalThis.rightsTracks = false
    globalThis.queueTracks = true
    globalThis.holdTransfer = true
  })
  await page.getByRole('tab', { name: '每日推荐' }).click()
  await page.getByRole('button', { name: '生成推荐', exact: true }).click()
  await expect(page.getByText(/已下载 4\/5/)).toBeVisible({
    timeout: 30000,
  })
  const visibleTitles = await page.locator('.music-list ol li strong').allTextContents()
  assert.deepEqual(
    visibleTitles,
    Array.from({ length: 4 }, (_, i) => '队列歌曲' + i),
  )
  const expectedQueue = await page.evaluate(async () => {
    const state = await window.music.state()
    return state.items
      .filter((r) => r.batch === state.batches[0].id && r.localId)
      .map((r) => r.localId)
  })
  assert.equal(expectedQueue.length, 4)
  await page.getByRole('button', { name: '播放本次推荐' }).click()
  await expect
    .poll(() => page.evaluate(async () => (await window.music.state()).queue))
    .toEqual(expectedQueue)
  await expect
    .poll(() => page.locator('audio').evaluate((el) => !el.paused && el.currentTime > 0))
    .toBe(true)
  await expect(page.getByRole('button', { name: '终止本次推荐' })).toBeVisible()
  await page.screenshot({
    path: path.join(root, '四首播放中.png'),
    style: ':root { background: var(--base) !important }',
  })
  await app.evaluate(() => globalThis.releaseTransfer())
  await expect(page.getByText(/已下载 5\/5/)).toBeVisible()
  assert.deepEqual(
    await page.evaluate(async () => (await window.music.state()).queue),
    expectedQueue,
  )
  await fs.writeFile(
    source,
    `// @name 可取消源
 lx.on('request',async()=>{await new Promise(done=>setTimeout(done,5000));return []});lx.send('inited',{sources:{wy:{actions:['search','musicUrl'],qualitys:['320k']}}})`,
  )
  await page.evaluate(() => window.music.lxImport())
  await app.evaluate(() => {
    globalThis.cancelTracks = true
  })
  const cancelled = page.evaluate(() => window.music.generate('测试整批取消', 'auto', false, 2))
  await expect
    .poll(() => page.evaluate(async () => (await window.music.state()).batches[0].state))
    .toBe('running')
  await page.evaluate(() => window.music.stopGeneration())
  const stopped = await page.evaluate(
    async (id) => {
      const s = await window.music.state()
      return [s.batches.find((b) => b.id === id), s.items.filter((r) => r.batch === id)]
    },
    await cancelled,
  )
  assert.equal(stopped[0].state, 'cancelled')
  assert.equal(stopped[0].targetCount, 2)
  assert.deepEqual(stopped[1], [])
  // One successfully published recording survives a provider quota error on replenishment.
  await fs.writeFile(
    source,
    `// @name 目标数量验收
    lx.on('request',({action,info})=>{
      if(action==='musicUrl') return 'https://1.1.1.1/daily.mp3?title='+encodeURIComponent(info.musicInfo.name)
      const [name,singer]=info.keyword.split(' ')
      return [{name,singer,id:name,allowPermanentSave:true}]
    })
    lx.send('inited',{sources:{wy:{actions:['search','musicUrl'],qualitys:['320k']}}})`,
  )
  await page.evaluate(() => window.music.lxImport())
  await app.evaluate(() => {
    let round = 0
    globalThis.fetch = async (_url, req) => {
      const input = JSON.parse(JSON.parse(req.body).contents[0].parts[0].text)
      if (round++) {
        globalThis.additionalInput = input
        return new Response('{}', { status: 429 })
      }
      return Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    songs: [{ title: '额度测试', artist: '独唱艺人', reason: '指定作品' }],
                  }),
                },
              ],
            },
          },
        ],
      })
    }
  })
  const blocked = await page.evaluate(async () => {
    const id = await window.music.generate('只想听独唱艺人本人的歌', 'auto', false, 8)
    const s = await window.music.state()
    return {
      batch: s.batches.find((r) => r.id === id),
      rows: s.items.filter((r) => r.batch === id),
    }
  })
  assert.equal(blocked.batch.state, 'blocked')
  assert.match(blocked.batch.message, /429/)
  assert.equal(blocked.batch.targetCount, 8)
  assert.equal(blocked.rows.length, 1)
  const nextInput = await app.evaluate(() => globalThis.additionalInput)
  assert.deepEqual(nextInput.recentArtists, ['独唱艺人'])
  assert.equal(nextInput.preference, '只想听独唱艺人本人的歌')
  await app.evaluate(() => {
    globalThis.diversityCalls = []
    globalThis.fetch = async (_url, req) => {
      const input = JSON.parse(JSON.parse(req.body).contents[0].parts[0].text)
      globalThis.diversityCalls.push(input)
      const artists = input.preference.includes('本人')
        ? ['其他人', '歌手甲', '歌手甲', '歌手甲']
        : input.recentArtists?.length
          ? ['歌手乙', '歌手丙']
          : ['歌手甲', '歌手甲', '歌手甲']
      const songs = artists.map((artist, n) => ({
        artist,
        title: input.preference + '曲' + artist + n,
        reason: '测试',
      }))
      return Response.json({
        candidates: [
          { content: { parts: [{ text: JSON.stringify({ requestedArtist: '歌手甲', songs }) }] } },
        ],
      })
    }
  })
  const sample = async (preference) =>
    page.evaluate(async (preference) => {
      const id = await window.music.generate(preference, 'auto', false, 3)
      const state = await window.music.state()
      return state.items.filter((r) => r.batch === id).map((r) => r.artist)
    }, preference)
  assert.deepEqual(await sample('比如歌手甲这一类，想听不同的音乐人'), [
    '歌手甲',
    '歌手乙',
    '歌手丙',
  ])
  assert.deepEqual(await sample('听歌手甲本人的歌'), ['歌手甲', '歌手甲', '歌手甲'])
  assert.equal(await app.evaluate(() => globalThis.diversityCalls.length), 3)
  await app.evaluate(() => {
    globalThis.slowTransfer = true
    globalThis.stopTestCalls = 0
    globalThis.fetch = async () => {
      const songs =
        ++globalThis.stopTestCalls === 1
          ? [
              { title: '终止前保留', artist: '甲' },
              { title: '传输中终止', artist: '乙' },
            ]
          : [{ title: '新批歌曲', artist: '丙' }]
      return Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    songs: songs.map((row) => ({ ...row, reason: '测试' })),
                  }),
                },
              ],
            },
          },
        ],
      })
    }
  })
  await page.getByRole('tab', { name: '每日推荐' }).click()
  const target = page.getByRole('textbox', { name: '推荐首数' })
  await target.fill('2')
  await page.getByRole('button', { name: '生成推荐', exact: true }).click()
  await expect(page.getByText(/已下载 1\/2/)).toBeVisible()
  const partFiles = async () => (await fs.readdir(output)).filter((f) => f.endsWith('.part'))
  await expect
    .poll(async () => {
      const files = await partFiles()
      return files.length ? (await fs.stat(path.join(output, files[0]))).size : 0
    })
    .toBe(128)
  await page.getByRole('button', { name: '终止本次推荐', exact: true }).click()
  await expect(page.getByText('已下载 1/2，本次推荐已终止')).toBeVisible()
  assert.deepEqual(await partFiles(), [])
  const checkpoint = async () => ({
    files: await fs.readdir(output),
    operations: await app.evaluate(() => [globalThis.stopTestCalls, globalThis.transfers]),
    songs: await page.locator('.music-list li strong').allTextContents(),
  })
  const stoppedState = await checkpoint()
  assert.deepEqual(stoppedState.songs, ['终止前保留'])
  await new Promise((resolve) => setTimeout(resolve, 1200))
  assert.deepEqual(await checkpoint(), stoppedState)
  await page.screenshot({
    path: path.join(root, '终止本次推荐.png'),
    style: ':root {background:var(--base) !important}',
  })
  await target.fill('1')
  await page.getByRole('button', { name: '生成推荐', exact: true }).click()
  await expect(page.getByText('已下载 1/1，已达到目标首数')).toBeVisible()
  assert.deepEqual(await page.locator('.music-list li strong').allTextContents(), ['新批歌曲'])
  console.log('PASS 传输写入128字节后从页面终止，保留1/2、清理临时文件、停止后无新写入，新批1/1')
  await fs.writeFile(
    source,
    `// @name 同作版本验收
    lx.on('request',({action,info})=>{
      if(action==='musicUrl')return 'https://1.1.1.1/daily.mp3?title='+encodeURIComponent(info.musicInfo.name)
      const [title]=info.keyword.split(' ')
      if(title==='截短测试')return [{id:title,name:title,singer:'原唱',allowPermanentSave:true,durationSeconds:245}]
      if(title==='同作验收')return [
        {id:'denied',name:title,singer:'原唱',allowPermanentSave:false},
        {id:'unrelated',name:title,singer:'同名他人',allowPermanentSave:true},
        {id:'cover',name:title+' (Cover. 原唱)',singer:'实际表演者',albumName:'实际录音专辑',allowPermanentSave:true}
      ]
      return []
    })
    lx.send('inited',{sources:{wy:{actions:['search','musicUrl'],qualitys:['320k']}}})`,
  )
  await page.evaluate(() => window.music.lxImport())
  const isolateDb = new DatabaseSync(path.join(profile, 'fitbay-music/music.sqlite'))
  isolateDb
    .prepare('DELETE FROM music_sources WHERE id!=?')
    .run((await page.evaluate(() => window.music.lxSources())).active)
  isolateDb.close()
  await app.evaluate(() => {
    globalThis.versionCalls = 0
    globalThis.fetch = async () =>
      Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    songs: [
                      {
                        title: ++globalThis.versionCalls === 1 ? '截短测试' : '同作验收',
                        artist: '原唱',
                        reason: '实际录音',
                      },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      })
  })
  const versionBatch = await page.evaluate(async () => {
    const id = await window.music.generate('新歌', 'auto', false, 1)
    const s = await window.music.state()
    return {
      batch: s.batches.find((r) => r.id === id),
      rows: s.items.filter((r) => r.batch === id),
    }
  })
  assert.equal(versionBatch.batch.state, 'completed')
  assert.match(versionBatch.batch.details, /音频时长与所选完整录音不符/)
  assert.deepEqual(
    versionBatch.rows.map((r) => [r.title, r.artist, r.recordingAlbum]),
    [['同作验收 (Cover. 原唱)', '实际表演者', '实际录音专辑']],
  )
  assert.equal(await app.evaluate(() => globalThis.versionCalls), 2)
  // Unique new model titles cannot keep a batch spending indefinitely if every source denies them.
  await fs.writeFile(
    source,
    `// @name 无法保存
    lx.on('request',({info})=>{const [name,singer]=info.keyword.split(' ');return [{id:name,name,singer,allowPermanentSave:false}]})
    lx.send('inited',{sources:{wy:{actions:['search','musicUrl'],qualitys:['320k']}}})`,
  )
  await page.evaluate(() => window.music.lxImport())
  const sourcesDb = new DatabaseSync(path.join(profile, 'fitbay-music/music.sqlite'))
  sourcesDb
    .prepare('DELETE FROM music_sources WHERE id!=?')
    .run((await page.evaluate(() => window.music.lxSources())).active)
  sourcesDb.close()
  await app.evaluate(() => {
    globalThis.stalledCalls = 0
    globalThis.fetch = async () =>
      Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    songs: [
                      {
                        artist: '样本',
                        title: '未授权' + ++globalThis.stalledCalls,
                        reason: '测试',
                      },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      })
  })
  const stalled = await page.evaluate(async () => {
    const id = await window.music.generate('新歌', 'auto', false, 1)
    const s = await window.music.state()
    return [s.batches.find((r) => r.id === id), s.items.filter((r) => r.batch === id)]
  })
  assert.equal(stalled[0].state, 'blocked')
  assert.match(stalled[0].message, /连续 6 轮/)
  assert.deepEqual(stalled[1], [])
  assert.equal(await app.evaluate(() => globalThis.stalledCalls), 6)
  console.log(
    'PASS 四家服务协议、无授权禁发、审美增量和重试、自动下载复用、歧义、试听和系统歌单。' + root,
  )
} finally {
  await app.close()
}
const reopened = await launch()
try {
  const p = await reopened.firstWindow()
  assert.equal((await p.evaluate(() => window.music.state())).prefs.recommendDir, output)
  assert.equal((await p.evaluate(() => window.music.getTasteStatus())).consented, false)
  assert.ok((await p.evaluate(() => window.music.state())).localTracks.some((t) => t.notInterested))
  assert.equal(
    (await p.evaluate(() => window.music.state())).playlists.find((s) => s.system).tracks.length,
    20,
  )
} finally {
  await reopened.close()
}
