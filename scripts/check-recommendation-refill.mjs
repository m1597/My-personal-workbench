import { openDiscovery } from './discovery-fixture.mjs'
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
const cancellation = process.env.FITBAY_TEST_RECOMMEND_STOP
if (cancellation === 'consent') store.set('taste-consent', '1')
store.set('lx-bootstrap', 'done')
store.set('music-recommend-dir', output)
store.set('music-media-keys', 'off')
store.set('music-guide-v1', 1)
store.db.close()

const songs = ['晨风', '河岸', '远山', '晚钟', '归途']
const files = {}
for (const [i, song] of songs.entries()) {
  files[song] = path.join(root, song + '.wav')
  await writeFixtureRecording(files[song], 630 + i * 175)
}
const code = path.join(root, 'source.js')
const preview = '海风'
files[preview] = path.join(root, preview + '.wav')
await writeFixtureRecording(files[preview], 43, 24)
await fs.writeFile(
  code,
  `// @name 五首补推测试源
lx.on('request', ({action,info}) => {
  if(action === 'musicUrl') return 'https://1.1.1.1/audio/' + encodeURIComponent(info.musicInfo.name)
  if(action !== 'search') return ''
  const name = info.keyword.split(' ')[0]
  return [{id:name,name,singer:'青禾',picUrl:name==='晨风'?'https://p1.music.126.net/fixture.png':undefined,allowPermanentSave:!name.startsWith('限听')}]
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
      const dns = process.getBuiltinModule('node:dns/promises')
      const lookup = dns.lookup
      dns.lookup = (host, ...args) =>
        host === 'p1.music.126.net'
          ? Promise.resolve([{ address: '1.1.1.1', family: 4 }])
          : lookup(host, ...args)
      process.getBuiltinModule('node:module').syncBuiltinESMExports()
      globalThis.artRequests = 0
      globalThis.transfers = []
      https.request = (url, options, receive) => {
        if (url.href === 'https://p1.music.126.net/fixture.png') {
          globalThis.artRequests++
          const req = new EventEmitter()
          req.end = () =>
            receive(
              Object.assign(fs.createReadStream(files.cover), {
                statusCode: 200,
                headers: { 'content-type': 'image/png' },
                setTimeout() {},
              }),
            )
          return req
        }
        if (url.origin !== 'https://1.1.1.1') throw Error('夹具意外请求')
        const title = decodeURIComponent(url.pathname.slice('/audio/'.length))
        if (!files[title]) throw Error('无授权曲目触发了音频请求')
        globalThis.transfers.push({ title, at: Date.now() })
        const req = new EventEmitter()
        req.end = () => {
          const bytes = fs.statSync(files[title]).size
          const match = /^bytes=(\d+)-(\d*)$/.exec(options.headers.Range ?? '')
          const start = match ? Number(match[1]) : 0
          const end = match?.[2] ? Math.min(Number(match[2]), bytes - 1) : bytes - 1
          const deliver = () =>
            receive(
              Object.assign(fs.createReadStream(files[title], { start, end }), {
                headers: {
                  'content-length': String(end - start + 1),
                  'content-type': 'audio/wav',
                  ...(match && { 'content-range': `bytes ${start}-${end}/${bytes}` }),
                },
                statusCode: match ? 206 : 200,
                setTimeout() {},
              }),
            )
          if (title === songs[4]) {
            globalThis.finishFifth = deliver
            options.signal.addEventListener(
              'abort',
              () => req.emit('error', options.signal.reason),
              { once: true },
            )
          } else deliver()
        }
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
    { files: { ...files, cover: path.resolve('src/renderer/public/fitbay.png') }, code, songs },
  )
  await page.evaluate(async () => {
    await window.music.lxImport()
    await window.music.configureModel('deepseek', 'fixture', 'fixture', false)
  })
  await openDiscovery(page, true)
  await page.getByLabel('推荐首数').fill('5')
  await page.getByLabel('想让 AI 推荐什么？（选填）').fill('只听青禾本人的作品')
  await page.evaluate(() => {
    delete document.documentElement.dataset.backdrop
    const started = performance.now()
    const times = {}
    new MutationObserver(() => {
      const n =
        document
          .querySelector('.music-list:has(.music-batch-status)')
          ?.querySelectorAll('li strong').length ?? 0
      if (n > 0 && !times.firstMs) times.firstMs = Math.round(performance.now() - started)
      if (n === 5 && !times.fiveMs) times.fiveMs = Math.round(performance.now() - started)
    }).observe(document.body, { subtree: true, childList: true, characterData: true })
    window.fixtureTimes = times
  })
  await page.getByRole('button', { name: '生成推荐', exact: true }).click()
  const events = []
  async function capture(step) {
    const state = await page.evaluate(async () => {
      const state = await window.music.state()
      const { id, state: status, message } = state.batches[0]
      const audio = document.querySelector('audio')
      return {
        id,
        status,
        message,
        at: Date.now(),
        songs: state.items
          .filter((row) => row.batch === id)
          .map((row) => [row.id, row.title, row.localId]),
        tab: document.querySelector('[role=tab][aria-selected=true]')?.textContent,
        playing: !audio.paused,
        currentTime: audio.currentTime,
        protocol: audio.currentSrc.split(':')[0],
      }
    })
    events.push({ step, ...state })
    await page.screenshot({
      path: path.join(root, step + '.png'),
      style: ':root {background:var(--base)!important}',
    })
    return state
  }
  const progress = page.locator('.music-batch-status [role="status"]')
  await expect
    .poll(() => app.evaluate(() => typeof globalThis.finishFifth), { timeout: 30000 })
    .toBe('function')
  await expect(progress).toContainText('已入库 4/5')
  const partial = await capture('01-four-saved')
  await openDiscovery(page, false)
  const input = page.getByRole('textbox', { name: '搜索关键词' })
  await expect(input).toHaveValue('只听青禾本人的作品')
  await input.fill(preview)
  await input.press('Enter')
  await page
    .getByRole('listitem')
    .filter({ hasText: preview })
    .dispatchEvent('dblclick')
  await expect
    .poll(() => page.locator('audio').evaluate((a) => !a.paused && a.currentTime > 0))
    .toBe(true)
  await page.getByRole('button', { name: '下载任务' }).click()
  await expect(page.locator('.download-tasks')).toContainText('已下载 4/5 首')
  const online = await capture('02-online-playing')
  assert.equal(online.protocol, 'fitbay-audio')
  await page.keyboard.press('Escape')
  await openDiscovery(page, true)
  await expect(progress).toContainText('已入库 4/5')
  await expect(page.getByLabel('想让 AI 推荐什么？（选填）')).toHaveValue(preview)
  const returned = await capture('03-return-running')
  for (const state of [partial, online, returned]) {
    assert.equal(state.status, 'running')
    assert.equal(state.id, partial.id)
    assert.deepEqual(state.songs, partial.songs)
  }
  if (cancellation) {
    const message = {
      manual: '本次推荐已终止（手动终止）',
      consent: '本次推荐已终止（已撤回审美资料授权）',
      lifecycle: '本次推荐已终止（音乐组件已关闭）',
      crash: '本次推荐已终止（音乐组件渲染进程退出）',
    }[cancellation]
    assert.ok(message)
    if (cancellation === 'manual') await page.getByRole('button', { name: '终止本次推荐' }).click()
    else if (cancellation === 'consent')
      await page.evaluate(() => window.music.setTasteConsent(false))
    else if (cancellation === 'crash') {
      const address = page.url()
      await app.evaluate(({ webContents }, address) => {
        const music = webContents.getAllWebContents().find((wc) => wc.getURL() === address)
        setTimeout(() => music.forcefullyCrashRenderer(), 100)
      }, address)
    } else
      await app.evaluate(({ BaseWindow }) => {
        const window = BaseWindow.getAllWindows().find((w) => w.getTitle() === 'Music')
        setTimeout(() => window.close(), 100)
      })
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(path.join(profile, 'fitbay-music/music.sqlite'), {
      readOnly: true,
      timeout: 3000,
    })
    try {
      await expect
        .poll(
          () =>
            db.prepare('SELECT message FROM recommendation_runs WHERE batch=?').get(partial.id)
              ?.message,
        )
        .toBe(message)
      assert.equal(
        db
          .prepare("SELECT count(*) AS n FROM items WHERE batch=? AND status='已入库'")
          .get(partial.id).n,
        4,
      )
      if (cancellation === 'manual' || cancellation === 'consent') {
        await expect(progress).toContainText(message)
        const cancelled = await capture('04-cancelled')
        assert.deepEqual(cancelled.songs, partial.songs)
      }
      await fs.writeFile(
        path.join(root, 'events.json'),
        JSON.stringify({ cancellation, message, events }, null, 2),
      )
      console.log(cancellation, message, root)
    } finally {
      db.close()
    }
  } else {
    await app.evaluate(() => globalThis.finishFifth())
    await expect(page.locator('.music-batch-status [role="status"]')).toContainText(
      '已入库 5/5，已达到目标首数',
      { timeout: 30000 },
    )
    const times = await page.evaluate(() => window.fixtureTimes)
    const counts = await app.evaluate(() => globalThis.counts)
    const finished = await capture('04-five-saved')
    assert.equal(finished.status, 'completed')
    assert.deepEqual(
      finished.songs.filter(([id]) => partial.songs.some(([old]) => old === id)),
      partial.songs,
    )
    const transfers = await app.evaluate(() => globalThis.transfers)
    assert.deepEqual(
      transfers
        .map((entry) => entry.title)
        .filter((title) => title !== preview)
        .sort(),
      [...songs].sort(),
    )
    assert.deepEqual(
      (await page.locator('.music-list li strong').allTextContents()).sort(),
      [...songs].sort(),
    )
    assert.equal((await fs.readdir(output)).filter((f) => f.endsWith('.wav')).length, 5)
    assert.deepEqual(counts, [5, 5])
    const expectedCover =
      'data:image/png;base64,' +
      (await fs.readFile('src/renderer/public/fitbay.png')).toString('base64')
    const recommendation = page.locator('.music-list li').filter({ hasText: '晨风' }).first()
    await expect(recommendation.locator('.album-art img')).toHaveAttribute('src', expectedCover)
    await recommendation.getByRole('button', { name: '试听晨风', exact: true }).click()
    await expect(page.locator('.music-cover-button img')).toHaveAttribute('src', expectedCover)
    await page.screenshot({ path: path.join(root, '05-recommendation-player-art.png') })
    await openDiscovery(page, false)
    await input.fill('晨风')
    await input.press('Enter')
    await expect(page.locator('.search-cover').first()).toHaveAttribute('src', expectedCover)
    await page.screenshot({ path: path.join(root, '06-search-art.png') })
    assert.equal(await app.evaluate(() => globalThis.artRequests), 1)
    const localId = finished.songs.find(([, title]) => title === '晨风')[2]
    await app.evaluate(() => {
      process.getBuiltinModule('node:https').request = () => {
        throw Error('离线封面验证')
      }
    })
    await page.reload()
    assert.equal(await page.evaluate((id) => window.music.trackCover(id), localId), expectedCover)
    const report = {
      offlineCover: true,
      sameCoverAcrossThreeViews: true,
      ...times,
      counts,
      events,
      transfers,
      root,
    }
    await fs.writeFile(path.join(root, 'timing.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
  }
} finally {
  await app.close()
}
