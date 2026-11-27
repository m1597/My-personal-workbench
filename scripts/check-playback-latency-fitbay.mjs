import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { sourceCatalog } from '../examples/component-host/lx-source-catalog.mjs'
import { recording } from '../components/music/offline-source.mjs'
const root = await mkdtemp(path.resolve('tmp/fitbay-playback-timing-')),
  profile = path.join(root, 'profile')
console.log(root)
const srcDB = new DatabaseSync(process.env.FITBAY_TEST_LIVE_LIBRARY, { readOnly: true })
const src = JSON.parse(
  srcDB.prepare("select payload from music_sources where id='pdone:helloworld'").get().payload,
)
srcDB.close()
const store = new MusicStore(path.join(profile, 'fitbay-music'))
sourceCatalog(store.db).install(src, null, true)
store.set('music-guide-v1', 1)
const tone = path.join(root, '切换用.wav')
await writeFile(tone, recording('fitbay-tone-1'))
store.library.upsert({ file: tone, title: '切换用', artist: '夹具', album: '', duration: 20 })
const list = store.library.createPlaylist('计时歌单')
store.library.setMembership(list, store.library.list()[0].id, true)
store.db.close()
const launch = () =>
  electron.launch({
    args: [
      path.resolve(process.env.FITBAY_TEST_HOST || 'dist/component-prototype/host'),
      '--mode=music',
      '--user-data-dir=' + profile,
      '--mute-audio',
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
let app = await launch()
const measures = []
async function listen() {
  await app.evaluate(({ app }) => {
    if (!app.commandLine.hasSwitch('mute-audio')) throw Error('必须静音')
    globalThis.timings = []
    process
      .getBuiltinModule('node:diagnostics_channel')
      .channel('fitbay.music.playback')
      .subscribe((e) => globalThis.timings.push({ ...e, t: Date.now() }))
  })
  const page = await app.firstWindow()
  await page.evaluate(() => {
    globalThis.plays = []
    document.addEventListener(
      'playing',
      (e) => globalThis.plays.push({ time: Date.now(), duration: e.target.duration }),
      true,
    )
  })
  return page
}
async function measure(page, target, label) {
  await app.evaluate(() => (globalThis.timings.length = 0))
  await page.evaluate(() => (globalThis.plays.length = 0))
  const t = Date.now()
  await target.press('Enter')
  await expect
    .poll(
      () => page.evaluate(() => globalThis.plays.find((e) => e.duration > 120 && e.duration < 130)),
      { timeout: 45000 },
    )
    .toBeTruthy()
  const frames = await app.evaluate(() => globalThis.timings)
  const playing = await page.evaluate(() => globalThis.plays.at(-1))
  const events = frames.map((e) => [e.stage, e.t - t])
  events.push(['playing', playing.time - t])
  const record = { label, events, duration: playing.duration, source: src.name }
  measures.push(record)
  console.log(record)
  await writeFile(path.join(root, 'evidence.json'), JSON.stringify(measures, null, 2))
}
try {
  let page = await listen()
  await page.getByRole('tab', { name: '找歌', exact: true }).press('Enter')
  await page.getByRole('tab', { name: '普通搜索', exact: true }).press('Enter')
  const pane = page.getByRole('region', { name: '搜索音乐' })
  const input = pane.getByRole('textbox')
  await input.fill('Monkeys Spinning Monkeys Kevin MacLeod')
  await pane.getByRole('tab', { name: 'QQ 音乐' }).press('Enter')
  const target = pane
    .locator('li.search-recording')
    .filter({ hasText: 'Kevin MacLeod' })
    .filter({ hasText: 'Monkeys Spinning Monkeys' })
    .first()
  for (let i = 0; i < 3; i++) {
    if (await target.count()) break
    await input.press('Enter')
    try {
      await expect(target).toBeAttached({ timeout: 9000 })
    } catch {}
  }
  if (!(await target.isVisible()))
    await pane
      .locator('details')
      .filter({ hasText: 'Monkeys Spinning Monkeys' })
      .first()
      .locator('summary')
      .press('Enter')
  await measure(page, target, '找歌冷首播')
  await page.evaluate(async (list) => {
    await window.music.setMembership(list, (await window.music.state()).current, true)
  }, list)
  await app.close()
  app = await launch()
  page = await listen()
  await page.getByRole('tab', { name: '歌单', exact: true }).press('Enter')
  await page.getByRole('button', { name: '歌单导航', exact: true }).press('Enter')
  await page.getByRole('button', { name: '计时歌单', exact: true }).press('Enter')
  const play = page.getByRole('button', { name: '播放Monkeys Spinning Monkeys', exact: true })
  await measure(page, play, '重启后歌单冷首播')
  await page.getByRole('button', { name: '播放切换用', exact: true }).press('Enter')
  await expect
    .poll(() => page.locator('audio').evaluate((a) => !a.paused && a.duration === 20))
    .toBe(true)
  await measure(page, play, '切走后重播')
  await page.locator('audio').evaluate((a) => (a.currentTime = 82))
  await expect
    .poll(() => page.locator('audio').evaluate((a) => !a.paused && a.currentTime > 82.15))
    .toBe(true)
  assert.equal(
    measures[2].events.some((e) => e[0] === 'cached-headers'),
    !process.env.FITBAY_TEST_BASELINE,
  )
} finally {
  await app.close()
}
