import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { recording } from '../components/music/offline-source.mjs'
import {
  downloadLrc,
  saveLyrics,
  lyricPath,
  localLines,
} from '../examples/component-host/music-lyrics.mjs'
import { openMusicSettings, selectMusicSettings } from './music-settings-fixture.mjs'

const root = await mkdtemp(path.resolve('tmp/music-player-options-'))
const profile = path.join(root, 'profile')
const file = path.join(root, '海岸.wav'),
  original = '[00:00.00]The shore\n[00:10.00]The sea',
  translation = '[00:00.00]海岸\n[00:10.00]海面'
await writeFile(file, recording('fitbay-tone-1'))
const store = new MusicStore(path.join(profile, 'fitbay-music'))
store.library.upsert({ file, title: '海岸', artist: '测试', album: '', duration: 20 })
const id = store.library.list()[0].id
store.set('music-guide-v1', 1)
store.checkpoint(id, 6)
store.set('play-queue', JSON.stringify([id]))
const bilingual = downloadLrc(original, translation, true)
assert.equal(
  downloadLrc('[offset:100]\n[00:01.200]original', '[00:01.100]译文', true),
  '[00:01.100]original\r\n[00:01.100]译文\r\n',
)
assert.equal(downloadLrc(original, translation, false), original)
assert.deepEqual(downloadLrc(bilingual, '', false).split('\r\n').filter(Boolean), [
  '[00:00.000]The shore',
  '[00:10.000]The sea',
])
const longLine = 'The last stars above the quiet water '.repeat(4).trim()
const fixture = `${bilingual}[00:11.000]${longLine}\r\n[00:12.000]The sky\r\n[00:12.000]天空\r\n`
await saveLyrics(store.db, file, async () => fixture)
assert.equal(await readFile(lyricPath(file), 'utf8'), fixture)
assert.deepEqual(await localLines(file, undefined, true), [
  [0, 'The shore', '海岸'],
  [10, 'The sea', '海面'],
  [11, longLine],
  [12, 'The sky', '天空'],
])
store.db.close()
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
  let page = await app.firstWindow()
  await page.locator('.music-transport').waitFor()
  assert.equal(await page.locator('audio').evaluate((a) => a.paused), true)
  await expect(page.locator('.music-transport strong')).toHaveText('海岸')
  const choose = async (label, name) => {
    await page.getByRole('combobox', { name: label, exact: true }).click()
    await page.getByRole('option', { name, exact: true }).click()
  }
  await openMusicSettings(page)
  await selectMusicSettings(page, '歌词')
  await expect(page.getByRole('combobox', { name: '桌面歌词语言' })).toHaveText('原文')
  await choose('桌面歌词字号', '30 px')
  await choose('显示行数', '双行')
  await choose('桌面歌词语言', '原文加译文')
  await expect(page.getByLabel('桌面歌词预览')).toHaveCSS('font-size', '30px')
  await page.getByLabel('桌面歌词预览').scrollIntoViewIfNeeded()
  await page.screenshot({
    path: path.join(root, '歌词设置.png'),
    style: ':root{background:var(--base)!important}',
  })
  const open = app.waitForEvent('window')
  await page.getByRole('button', { name: '桌面歌词', exact: true }).click()
  const overlay = await open
  await page.getByRole('button', { name: /^(播放|从 .* 秒继续)$/ }).click()
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  const groups = overlay.locator('.lyric-group')
  for (const [mode, count] of [
    ['双行', 2],
    ['单行', 1],
  ]) {
    await choose('显示行数', mode)
    await page.locator('audio').evaluate((audio) => {
      audio.currentTime = 9
    })
    await expect(groups.first().locator('.lyric-original')).toHaveText('The shore')
    await expect(groups.first().locator('.lyric-translation')).toHaveText('海岸')
    await expect(groups).toHaveCount(count)
    await expect(overlay.locator('strong')).toHaveCSS('font-size', '30px')
    if (count === 2) await expect(groups.nth(1)).toHaveCSS('opacity', '0.66')
    const capture = overlay.evaluate(
      () =>
        new Promise((resolve) => {
          const samples = []
          const timer = setInterval(() => {
            const row = document.querySelector('.lyric-group')
            samples.push([row?.dataset.id, row && getComputedStyle(row).transform])
            if (samples.length >= 75) {
              clearInterval(timer)
              resolve(samples)
            }
          }, 40)
        }),
    )
    await page.locator('audio').evaluate((audio) => audio.play())
    for (const [i, word] of ['The sea', longLine].entries()) {
      await expect(groups.first().locator('.lyric-original')).toHaveText(word)
      if (i === 1)
        await page.locator('audio').evaluate((audio) => {
          audio.pause()
          audio.currentTime = 11.25
        })
      await overlay.screenshot({
        path: path.join(root, `${mode}-${i}.png`),
        style: ':root{background:#202227}',
      })
    }
    await expect(groups.first().locator('.lyric-translation')).toHaveCount(0)
    const wrapping = () =>
      groups
        .first()
        .locator('.lyric-original')
        .evaluate((el) => {
          const rect = el.getBoundingClientRect()
          return (
            rect.height > parseFloat(getComputedStyle(el).lineHeight) * 1.5 &&
            rect.bottom <= innerHeight + 1
          )
        })
    await expect.poll(wrapping, { message: '长句应在窗口内换行' }).toBe(true)
    const samples = await capture
    await writeFile(path.join(root, `${mode}-frames.json`), JSON.stringify(samples))
    const sliding = new Set(
      samples.filter(([, transform]) => transform && transform !== 'none').map(([id]) => id),
    )
    assert.ok(sliding.size >= 2, '应观察到至少两次歌词组滑动')
    await page.locator('audio').evaluate((audio) => {
      audio.pause()
      audio.currentTime = 6
    })
  }
  await page.getByRole('button', { name: '桌面歌词', exact: true }).click()
  await selectMusicSettings(page, '下载')
  await expect(page.getByLabel('同时保存同名 LRC 歌词文件')).toBeChecked()
  await page.getByLabel('有译文时同时保存译文').check()
  await selectMusicSettings(page, '播放')
  await choose('再次打开 Music 时', '从上次进度续播')
  const detected = await page.evaluate(async () =>
    (await navigator.mediaDevices.enumerateDevices())
      .filter((x) => x.kind === 'audiooutput')
      .map((x) => ({ id: x.deviceId, label: x.label })),
  )
  console.log(
    '实际系统输出设备',
    detected.map((d) => d.label || '(无名称)'),
  )
  const actual = detected.find((d) => d.id && !['default', 'communications'].includes(d.id))
  if (actual) {
    await choose('播放输出设备', actual.label)
    await expect.poll(() => page.locator('audio').evaluate((a) => a.sinkId)).toBe(actual.id)
    await choose('播放输出设备', '跟随系统')
  }
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  const audio = () => page.locator('audio')
  await expect.poll(() => audio().evaluate((a) => a.paused)).toBe(false)
  assert.ok(await audio().evaluate((a) => a.currentTime >= 5.9))
  const state = await page.evaluate(() => window.music.state())
  assert.deepEqual(state.queue, [id])
  await page.evaluate(() => window.musicWindow.present('background'))
  const before = await audio().evaluate((a) => a.currentTime)
  await expect.poll(() => audio().evaluate((a) => a.currentTime)).toBeGreaterThan(before + 0.25)
  await page.evaluate(() => window.musicWindow.present('full'))
  await openMusicSettings(page)
  await selectMusicSettings(page, '播放')
  await choose('再次打开 Music 时', '从上次歌曲开头播放')
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  await expect.poll(() => audio().evaluate((a) => a.paused)).toBe(false)
  assert.ok(await audio().evaluate((a) => a.currentTime < 3))
  await openMusicSettings(page)
  await selectMusicSettings(page, '播放')
  await page.evaluate(() => {
    globalThis.testOutputList = [
      { kind: 'audiooutput', deviceId: 'default', label: '默认 - 耳机', groupId: 'a' },
      { kind: 'audiooutput', deviceId: 'usb-test', label: '测试耳机', groupId: 'a' },
    ]
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', {
      value: async () => globalThis.testOutputList,
    })
    Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', {
      value: async function (id) {
        Object.defineProperty(this, 'sinkId', { value: id, configurable: true })
      },
    })
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'))
  })
  await choose('播放输出设备', '测试耳机')
  await expect.poll(() => audio().evaluate((a) => a.sinkId)).toBe('usb-test')
  await page.getByLabel('耳机或选定输出设备断开时暂停').check()
  await expect
    .poll(() => page.evaluate(async () => (await window.music.state()).prefs.unplug))
    .toBe('pause')
  await page.screenshot({
    path: path.join(root, '输出与恢复.png'),
    style: ':root{background:var(--base)!important}',
  })
  await page.evaluate(() => {
    globalThis.testOutputList = [
      { kind: 'audiooutput', deviceId: 'default', label: '默认 - 扬声器', groupId: 'b' },
    ]
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'))
  })
  await expect.poll(() => audio().evaluate((a) => a.paused)).toBe(true)
  await expect.poll(() => audio().evaluate((a) => a.sinkId)).toBe('')
  await choose('播放输出设备', '跟随系统')
  const endpoints = [
    { kind: 'audiooutput', deviceId: 'usb-test', label: '测试耳机', groupId: 'a' },
    { kind: 'audiooutput', deviceId: 'speaker-test', label: '测试扬声器', groupId: 'b' },
  ]
  async function deviceChange(defaultIndex, connected) {
    await page.evaluate(
      async ({ defaultIndex, connected, endpoints }) => {
        const physical = endpoints[defaultIndex]
        globalThis.testOutputList = [
          { ...physical, deviceId: 'default', label: '默认 - ' + physical.label },
          ...connected.map((i) => endpoints[i]),
        ]
        navigator.mediaDevices.dispatchEvent(new Event('devicechange'))
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      },
      { defaultIndex, connected, endpoints },
    )
  }
  await deviceChange(0, [0, 1])
  await audio().evaluate((a) => a.play())
  await deviceChange(1, [0, 1])
  const clockAt = await audio().evaluate((a) => a.currentTime)
  await expect.poll(() => audio().evaluate((a) => a.currentTime)).toBeGreaterThan(clockAt + 0.2)
  await deviceChange(0, [0, 1])
  await deviceChange(1, [1])
  await expect.poll(() => audio().evaluate((a) => a.paused)).toBe(true)
  console.log('PASS 歌词设置、双语 LRC、重启三种策略、后台与输出设备断开', root)
} finally {
  await app.close()
}
