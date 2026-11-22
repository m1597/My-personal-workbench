import { openDiscovery, openMusicSurface } from './discovery-fixture.mjs'
import assert from 'node:assert/strict'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
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
const docked = process.argv.includes('--docked')
const testRetry = process.argv.includes('--retry-failed')
const testChart = testRetry && process.argv.includes('--chart')
if (testChart) {
  store.set('music-pref-requestWeight', '100')
  store.set('music-pref-edition', 'live')
}
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
if (testChart) {
  files['归途 (Live)'] = path.join(root, 'live.wav')
  await writeFixtureRecording(files['归途 (Live)'], 1901)
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
  ${testChart ? "if(name==='归途') return [name+' (Live)',name].map(title=>({id:title,name:title,singer:'青禾',allowPermanentSave:true}))" : ''}
  return [{id:name,name,singer:'青禾',picUrl:name==='晨风'?'https://p1.music.126.net/fixture.png':undefined,allowPermanentSave:!name.startsWith('限听')}]
})
lx.send('inited',{sources:{wy:{actions:['search','musicUrl'],qualitys:['320k']}}})`,
)
const app = await electron.launch({
  args: [
    path.resolve(
      process.argv.slice(2).find((arg) => !arg.startsWith('--')) ?? 'dist/component-prototype/host',
    ),
    docked ? '--mode=workbench' : '--mode=music',
    '--mute-audio',
    '--user-data-dir=' + profile,
    '--workbench=' + path.resolve('out/renderer/index.html'),
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
async function verify() {
  const page = await openMusicSurface(app, docked)
  await offlineSourceRepository(app)
  await app.evaluate(
    ({ app, BaseWindow, dialog }, { files, code, songs, testRetry, testChart }) => {
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
        if (url.hostname === 'p1.music.126.net') {
          globalThis.artRequests++
          const req = new EventEmitter()
          req.end = () =>
            receive(
              Object.assign(
                fs.createReadStream(url.pathname === '/other.png' ? files.other : files.cover),
                {
                  statusCode: 200,
                  headers: { 'content-type': 'image/png' },
                  setTimeout() {},
                },
              ),
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
          if (title === songs[4] && testRetry && !globalThis.retryRestored) {
            receive(
              Object.assign(process.getBuiltinModule('node:stream').Readable.from([]), {
                statusCode: 503,
                headers: {},
                setTimeout() {},
              }),
            )
          } else if (title === songs[4] && !testRetry) {
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
        if (testChart && new URL(_url).hostname === 'aweme.snssdk.com')
          return Response.json({
            status_code: 0,
            release_date: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
            music_list: songs.map((title, i) => ({
              music_info: { title, author: '青禾' },
              heat: 99 - i,
            })),
          })
        const { count, excluded = [] } = JSON.parse(
          JSON.parse(options.body).messages.at(-1).content,
        )
        globalThis.counts.push(count)
        if (testRetry && globalThis.counts.length > 1) throw Error('当前没有更多候选')
        const titles = (testRetry ? songs : catalog)
          .filter((title) => !excluded.some((s) => s.title === title))
          .slice(0, count)
        await new Promise((r) => setTimeout(r, 1200))
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  requestedArtist: '青禾',
                  songs: titles.map((title) => ({
                    title,
                    artist: '青禾',
                    // A malformed candidate must not discard the four playable ones.
                    reason: title === '限听一' ? undefined : '同艺人作品',
                    ...(title === songs[0] ? { unusedMetadata: 'ignored' } : {}),
                  })),
                }),
              },
            },
          ],
        })
      }
    },
    {
      files: {
        ...files,
        cover: path.resolve('src/renderer/public/fitbay.png'),
        other: path.resolve('examples/component-host/transport-icons.png'),
      },
      code,
      songs,
      testRetry,
      testChart,
    },
  )
  await page.evaluate(async () => {
    await window.music.lxImport()
    await window.music.configureModel('deepseek', 'fixture', 'fixture', false)
  })
  await openDiscovery(page, true)
  await page.getByLabel('推荐首数').fill('5')
  await page
    .getByLabel('想让 AI 推荐什么？（选填）')
    .fill(testChart ? '抖音热榜，只听青禾本人的作品' : '只听青禾本人的作品')
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
  await page.getByLabel('推荐首数').press('Enter')
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
  if (testRetry) {
    const retry = page.getByRole('button', { name: '仅重试失败歌曲（1）' })
    await expect(progress).toContainText('已入库 4/5', { timeout: 45000 })
    await expect(retry).toBeEnabled({ timeout: 45000 })
    const previous = await capture('01-retry-partial')
    await page.locator('.music-failure-details summary').click()
    await expect(page.locator('.music-failure-details')).toContainText(songs[4])
    await retry.click()
    await expect(progress).toContainText('失败歌曲重试已结束', { timeout: 45000 })
    await expect(retry).toBeEnabled()
    const stillFailed = await capture('02-retry-unavailable')
    assert.deepEqual(stillFailed.songs, previous.songs)
    if (testChart) {
      const db = new DatabaseSync(path.join(profile, 'fitbay-music', 'music.sqlite'))
      try {
        const { id, matchConstraints } = db
          .prepare(`SELECT i.id,r.matchConstraints FROM items i
          JOIN recommended_items r ON r.item=i.id WHERE i.batch=? AND i.title=?`)
          .get(previous.id, songs[4])
        const constraints = JSON.parse(matchConstraints)
        assert.equal(constraints.exactChart, true)
        assert.equal(constraints.editionPreference, 'any')
        assert.equal(constraints.artist, '青禾')
        // A pre-migration batch only has its original text. It must still reject the live substitute.
        db.prepare('UPDATE recommended_items SET matchConstraints=NULL WHERE item=?').run(id)
      } finally {
        db.close()
      }
      assert.ok(
        !(await app.evaluate(() => globalThis.transfers.some((r) => r.title.endsWith('(Live)')))),
      )
    }
    const before = await app.evaluate(() => {
      globalThis.retryRestored = true
      return { transfers: globalThis.transfers.length, models: globalThis.counts.length }
    })
    await retry.evaluate((button) => {
      button.click()
      button.click()
    })
    await expect(progress).toContainText('已入库 5/5', { timeout: 45000 })
    await expect(retry).toHaveCount(0)
    const after = await capture('03-retry-restored')
    assert.equal(after.id, previous.id)
    for (const row of previous.songs)
      assert.deepEqual(
        after.songs.find(([id]) => id === row[0]),
        row,
      )
    const retried = await app.evaluate(
      (_, offset) => ({
        titles: [...new Set(globalThis.transfers.slice(offset).map((r) => r.title))],
        models: globalThis.counts.length,
      }),
      before.transfers,
    )
    assert.deepEqual(retried, { titles: [songs[4]], models: before.models })
    await fs.writeFile(path.join(root, 'retry.json'), JSON.stringify({ events, retried }, null, 2))
    console.log('PASS 原批次仅重试失败歌曲，成功记录、模型调用次数保持不变', root)
    return
  }
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
  await page.getByRole('listitem').filter({ hasText: preview }).dispatchEvent('dblclick')
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
    const frame = recommendation.locator('.music-track-icon'),
      button = frame.getByRole('button')
    const icon = button.locator('.fui-Button__icon')
    const bounds = await frame.boundingBox()
    assert.deepEqual(await button.boundingBox(), bounds)
    assert.deepEqual(await frame.locator('img').boundingBox(), bounds)
    async function checkCover(name, opacity) {
      await expect(icon).toHaveCSS('opacity', opacity)
      await expect(button).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await frame.screenshot({ path: path.join(root, 'cover-' + name + '.png') })
    }
    await page.mouse.move(1, 1)
    await checkCover('rest', '0')
    await button.hover()
    await checkCover('hover', '1')
    await page.mouse.move(1, 1)
    await button.focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(button).toBeFocused()
    await checkCover('focus', '1')
    await button.click()
    await page.mouse.move(1, 1)
    await page.keyboard.press('Tab')
    await expect(button).toHaveAttribute('aria-label', '暂停晨风')
    await checkCover('playing', '1')
    await expect(page.locator('.music-cover-button img')).toHaveAttribute('src', expectedCover)
    await page.screenshot({ path: path.join(root, '05-recommendation-player-art.png') })
    await page.getByRole('button', { name: '打开歌词页', exact: true }).click()
    await expect(page.locator('.record-art-current .album-art img')).toHaveAttribute(
      'src',
      expectedCover,
    )
    await page.screenshot({
      path: path.join(root, 'lyrics-art.png'),
      style: ':root {background:var(--base)!important}',
    })
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await openDiscovery(page, false)
    await input.fill('晨风')
    await input.press('Enter')
    await expect(page.locator('.search-cover').first()).toHaveAttribute('src', expectedCover)
    await page.screenshot({ path: path.join(root, '06-search-art.png') })
    assert.equal(await app.evaluate(() => globalThis.artRequests), 1)
    const localId = finished.songs.find(([, title]) => title === '晨风')[2]
    // A second source uses the same recording ID, then changes its image on a new search.
    const second = path.join(root, 'source-b.js')
    await fs.writeFile(
      second,
      (await fs.readFile(code, 'utf8'))
        .replace('五首补推测试源', '另一个封面源')
        .replace(
          "picUrl:name==='晨风'?'https://p1.music.126.net/fixture.png':undefined",
          "picUrl: info.keyword.includes('新版')?'https://p1.music.126.net/fixture.png':'https://p1.music.126.net/other.png'",
        ),
    )
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    }, second)
    const otherCover =
      'data:image/png;base64,' +
      (await fs.readFile('examples/component-host/transport-icons.png')).toString('base64')
    const secondImage = await page.evaluate(async () => {
      await window.music.lxImport()
      const {
        items: [item],
      } = await window.music.lxSearch({ title: '晨风', artist: '青禾' }, 'wy')
      const id = await window.music.rememberOnline(item.key, '320k')
      return { id, image: await window.music.searchCover(item.key), local: item.localId }
    })
    assert.equal(secondImage.image, otherCover)
    assert.equal(secondImage.local, undefined)
    assert.equal(await page.evaluate((id) => window.music.trackCover(id), localId), expectedCover)
    assert.equal(
      await page.evaluate((id) => window.music.trackCover(id), secondImage.id),
      otherCover,
    )
    assert.equal(
      await page.evaluate(async () => {
        const {
          items: [item],
        } = await window.music.lxSearch({ title: '晨风 新版', artist: '' }, 'wy')
        return window.music.searchCover(item.key)
      }),
      expectedCover,
    )
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
      sameLyricsCover: true,
      ...times,
      counts,
      events,
      transfers,
      root,
    }
    await fs.writeFile(path.join(root, 'timing.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
  }
}
try {
  await verify()
} finally {
  await app.close()
}
