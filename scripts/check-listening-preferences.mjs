import { openDiscovery } from './discovery-fixture.mjs'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs/promises'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import {
  recordingConstraints,
  recordingRank,
  titleMatch,
} from '../examples/component-host/music-discovery.mjs'
import { writeFixtureRecording } from './music-recording-fixture.mjs'
import { offlineSourceRepository } from './music-source-fixture.mjs'
import { openMusicSettings, selectMusicSettings } from './music-settings-fixture.mjs'

const base = { title: '晨曲', artist: '青禾' }
const row = (name, singer = '青禾') => ({ name, singer })
const prefs = { edition: 'live', cover: 'avoid', instrumental: 'requested' }
const ordinary = recordingConstraints('适合春天的音乐', prefs)
for (const [input, allowStudio, allowLive, rank] of [
  ['现场版也可以', true, true, 'any'],
  ['现场也行', true, true, 'any'],
  ['允许录音室版', true, true, 'any'],
  ['现场和录音室都可以', true, true, 'any'],
  ['优先录音室版', true, true, 'studio'],
  ['现场版优先', true, true, 'live'],
  ['只要现场', false, true, 'live'],
  ['不要现场', true, false, 'live'],
  ['不要录音室版', false, true, 'live'],
  ['只听录音室版', true, false, 'live'],
  ['优先录音室版，现场也行', true, true, 'studio'],
  ['适合活动现场播放的音乐', true, true, 'live'],
  ['适合春天的音乐', true, true, 'live'],
]) {
  const constraints = recordingConstraints(input, prefs)
  const studio = row('晨曲')
  const live = row('晨曲 (Live)')
  assert.equal(!!titleMatch(base, studio, constraints), allowStudio, input)
  assert.equal(!!titleMatch(base, live, constraints), allowLive, input)
  const rankDifference = recordingRank(studio, constraints) - recordingRank(live, constraints)
  assert.equal(Math.sign(rankDifference), { any: 0, studio: -1, live: 1 }[rank], input)
}
assert.ok(recordingRank(row('晨曲 (Live)'), ordinary) < recordingRank(row('晨曲'), ordinary))
assert.equal(titleMatch(base, row('晨曲 (伴奏)'), ordinary), '')
assert.ok(titleMatch(base, row('晨曲 (伴奏)'), recordingConstraints('需要伴奏', prefs)))
assert.equal(titleMatch(base, row('晨曲 (Live)'), recordingConstraints('只听录音室版', prefs)), '')
assert.ok(
  titleMatch(base, row('晨曲 (Cover. 青禾)', '白露'), recordingConstraints('只听翻唱', prefs)),
)
assert.equal(titleMatch(base, row('晨曲'), recordingConstraints('只听翻唱', prefs)), '')
assert.ok(titleMatch(base, row('晨曲'), recordingConstraints('翻唱也可以', prefs)))
assert.ok(
  titleMatch(
    base,
    row('晨曲 (Cover. 青禾)', '白露'),
    recordingConstraints('要录音室版翻唱', prefs),
  ),
)

const mode = process.env.FITBAY_SHORTAGE_TEST || 'keep'
assert.ok(['keep', 'expand', 'auto', 'blank', 'close', 'stop'].includes(mode))
await fs.mkdir('tmp', { recursive: true })
const root = await fs.mkdtemp(path.resolve('tmp/listening-prefs-'))
const profile = path.join(root, 'profile'),
  output = path.join(root, 'songs')
await fs.mkdir(output)
const store = new MusicStore(path.join(profile, 'fitbay-music'))
store.set('music-guide-v1', 1)
store.set('music-media-keys', 'off')
store.set('music-quality', 'flac')
store.set('music-manual-dir', output)
store.set('music-recommend-dir', output)
store.set('taste-consent', 1)
const referenceFile = path.join(root, '室内乐参考.wav')
await writeFixtureRecording(referenceFile, 260)
store.library.upsert({
  file: referenceFile,
  title: '室内乐参考',
  artist: '测试艺人',
  album: '',
  duration: 1,
})
store.db.close()
const songs = ['晨光', '街角', '踏歌', '清波', '流云', '深林']
const files = {}
for (const [i, title] of songs.entries()) {
  files[title] = path.join(root, title + '.wav')
  await writeFixtureRecording(files[title], 423 + i * 177)
  files[title + ' (Live)'] = files[title]
}
const code = path.join(root, 'source.js')
await fs.writeFile(
  code,
  `// @name 独立音质和推荐范围夹具
lx.on('request',({action,info})=>{
 if(action==='musicUrl')return 'https://1.1.1.1/audio/'+encodeURIComponent(info.musicInfo.name)+'?quality='+info.type
 if(action==='search'){const name=info.keyword.split(' ')[0];return (name==='深林'?[name]:[name,name+' (Live)']).map(title=>({name:title,singer:'青禾',id:title,allowPermanentSave:true}))}
 return ''
})
lx.send('inited',{sources:{wy:{actions:['search','musicUrl'],qualitys:['flac','320k','128k']}}})`,
)
const launch = () =>
  electron.launch({
    args: [
      path.resolve('dist/component-prototype/host'),
      '--mode=music',
      '--mute-audio',
      '--user-data-dir=' + profile,
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
let app = await launch()
try {
  const page = await app.firstWindow()
  await offlineSourceRepository(app)
  await app.evaluate(
    ({ app, BaseWindow, dialog }, { files, code, songs, previewFile, downloadFile }) => {
      assertBackground()
      function assertBackground() {
        if (
          !app.commandLine.hasSwitch('mute-audio') ||
          BaseWindow.getAllWindows().some((w) => w.isFocusable())
        )
          throw Error('后台静音夹具要求未满足')
      }
      BaseWindow.getAllWindows()
        .find((w) => w.getTitle() === 'Music')
        .setContentSize(1020, 740)
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [code] })
      const fs = process.getBuiltinModule('node:fs'),
        https = process.getBuiltinModule('node:https'),
        { EventEmitter } = process.getBuiltinModule('node:events')
      globalThis.transfers = []
      globalThis.prompts = []
      https.request = (url, options, done) => {
        if (url.hostname !== '1.1.1.1') throw Error('意外网络请求')
        const title = decodeURIComponent(url.pathname.slice('/audio/'.length)),
          file =
            title === '深林'
              ? url.searchParams.get('quality') === '128k'
                ? previewFile
                : downloadFile
              : files[title]
        const size = fs.statSync(file).size
        const match = /^bytes=(\d+)-(\d*)$/.exec(options.headers.Range ?? '')
        const start = match ? Number(match[1]) : 0,
          end = match?.[2] ? Math.min(Number(match[2]), size - 1) : size - 1
        globalThis.transfers.push([title, url.searchParams.get('quality')])
        const req = new EventEmitter()
        req.end = () =>
          done(
            Object.assign(fs.createReadStream(file, { start, end }), {
              statusCode: match ? 206 : 200,
              headers: {
                'content-type': file.endsWith('.mp3')
                  ? 'audio/mpeg'
                  : file.endsWith('.flac')
                    ? 'audio/flac'
                    : 'audio/wav',
                'content-length': String(end - start + 1),
                ...(match && { 'content-range': `bytes ${start}-${end}/${size}` }),
              },
              setTimeout() {},
            }),
          )
        return req
      }
      globalThis.fetch = async (_url, opts) => {
        const p = JSON.parse(JSON.parse(opts.body).messages.at(-1).content)
        if (!p.scope)
          return Response.json({
            choices: [{ message: { content: JSON.stringify({ profile: '偏爱轻声室内乐' }) } }],
          })
        globalThis.prompts.push(p)
        const titles =
          p.scope === 'related'
            ? songs.slice(2, 5)
            : !p.preference
              ? songs.slice(0, 5)
              : songs.slice(0, 2)
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  directExhausted: !!p.preference && p.scope === 'direct',
                  songs: titles.map((title) => ({
                    title,
                    artist: '青禾',
                    reason: p.scope === 'related' ? '相近的节奏' : '符合主题',
                  })),
                }),
              },
            },
          ],
        })
      }
    },
    {
      files,
      code,
      songs,
      previewFile: path.resolve('tests/fixtures/local-music/tone.mp3'),
      downloadFile: path.resolve('tests/fixtures/local-music/tone.flac'),
    },
  )
  await page.evaluate(async () => {
    await window.music.lxImport()
    await window.music.configureModel('deepseek', 'fixture', 'fixture', false)
  })
  const shot = (name) =>
    page.screenshot({
      path: path.join(root, name + '.png'),
      animations: 'disabled',
      style: ':root {background:var(--base)!important}',
    })
  await openMusicSettings(page)
  await selectMusicSettings(page, '模型与推荐')
  async function choose(label, name) {
    await page.getByRole('combobox', { name: label, exact: true }).click()
    await page.getByRole('option', { name, exact: true }).click()
  }
  if (mode === 'auto') await choose('直接相关歌曲不足时', '自动补充相近歌曲')
  await choose('录音版本', '优先现场')
  await choose('翻唱', '尽量避开翻唱')
  await shot('01-recommend-settings')
  await selectMusicSettings(page, '下载')
  await expect(page.getByRole('combobox', { name: '试听音质' })).toContainText('快速试听')
  await expect(page.getByRole('combobox', { name: '下载音质' })).toContainText('flac')
  await shot('02-quality-settings')
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await openDiscovery(page, true)
  await page
    .getByLabel('想让 AI 推荐什么？（选填）')
    .fill(
      mode === 'blank'
        ? ''
        : mode === 'expand'
          ? '适合雨后散步的音乐，现场也行'
          : '适合雨后散步的音乐',
    )
  await page.getByRole('button', { name: '生成推荐', exact: true }).click()
  const progress = page.locator('.music-batch-progress [role=status]')
  if (['keep', 'expand', 'close', 'stop'].includes(mode)) {
    await expect(progress).toContainText('已入库 2/5，直接相关', { timeout: 20000 })
    await shot('03-ask')
    if (mode === 'close' || mode === 'stop') {
      if (mode === 'stop') await page.getByRole('button', { name: '终止本次推荐' }).click()
      await app.close()
      app = await launch()
      const reopened = await app.firstWindow()
      await openDiscovery(reopened, true)
      await expect(reopened.locator('.music-batch-progress [role=status]')).toContainText(
        '已入库 2/5',
      )
      const state = await reopened.evaluate(() => window.music.state())
      assert.equal(state.batches[0].state, 'cancelled')
      assert.equal(state.items.length, 2)
      await expect(reopened.getByRole('button', { name: '扩大到相近歌曲' })).toHaveCount(0)
      await reopened.screenshot({ path: path.join(root, '04-restarted.png') })
      await fs.writeFile(
        path.join(root, 'report.json'),
        JSON.stringify({ mode, batch: state.batches[0] }, null, 2),
      )
      console.log('PASS', mode, root)
    } else
      await page
        .getByRole('button', { name: mode === 'keep' ? '保留当前结果' : '扩大到相近歌曲' })
        .click()
  }
  if (mode !== 'close' && mode !== 'stop') {
    await expect(progress).toContainText(
      mode === 'keep' ? '已入库 2/5，已保留' : '已入库 5/5，已达到',
      { timeout: 20000 },
    )
    await shot('04-finished')
    const prompts = await app.evaluate(() => globalThis.prompts)
    assert.deepEqual(
      [...new Set(prompts.map((p) => p.scope))],
      mode === 'auto' || mode === 'expand' ? ['direct', 'related'] : ['direct'],
    )
    assert.equal(prompts[0].profile, '偏爱轻声室内乐')
    assert.ok(
      (await app.evaluate(() => globalThis.transfers)).some(
        ([title]) => title === (mode === 'expand' ? '晨光' : '晨光 (Live)'),
      ),
    )
    if (mode === 'keep') {
      await openDiscovery(page, false)
      const input = page.getByRole('textbox', { name: '搜索关键词' })
      await input.fill('深林')
      await input.press('Enter')
      const row = page.getByRole('listitem').filter({ hasText: '深林' })
      await row.dispatchEvent('dblclick')
      await expect
        .poll(() => page.locator('audio').evaluate((a) => !a.paused && a.currentTime > 0))
        .toBe(true)
      await row.getByRole('button', { name: '下载', exact: true }).click()
      await expect
        .poll(() =>
          page.evaluate(async () =>
            (await window.music.state()).localTracks.some((t) => t.title === '试音 flac'),
          ),
        )
        .toBe(true)
      const requests = await app.evaluate(() =>
        globalThis.transfers.filter(([title]) => title === '深林'),
      )
      assert.deepEqual([...new Set(requests.map(([, q]) => q))], ['128k', 'flac'])
      assert.deepEqual(
        await fs.readFile(path.join(output, '青禾 - 深林.flac')),
        await fs.readFile('tests/fixtures/local-music/tone.flac'),
      )
      await shot('05-preview-download')
    }
    await fs.writeFile(
      path.join(root, 'report.json'),
      JSON.stringify(
        { mode, prompts, transfers: await app.evaluate(() => globalThis.transfers) },
        null,
        2,
      ),
    )
    console.log('PASS', mode, root)
  }
} finally {
  await app.close()
}
