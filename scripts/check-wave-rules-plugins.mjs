import { checkInstalled, installPublic, uninstallPublic } from './public-music-plugin-fixture.mjs'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { openMusicSettings, selectMusicSettings } from './music-settings-fixture.mjs'

const evidence = await mkdtemp(path.resolve('tmp/music-wave-rules-'))
const profile = path.join(evidence, 'profile')
const store = new MusicStore(path.join(profile, 'fitbay-music'))
function wav(duration) {
  const frames = Math.round(duration * 8000)
  const b = Buffer.alloc(44 + frames * 2)
  b.write('RIFF')
  b.writeUInt32LE(b.length - 8, 4)
  b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20)
  b.writeUInt16LE(1, 22)
  b.writeUInt32LE(8000, 24)
  b.writeUInt32LE(16000, 28)
  b.writeUInt16LE(2, 32)
  b.writeUInt16LE(16, 34)
  b.write('data', 36)
  b.writeUInt32LE(frames * 2, 40)
  for (let i = 0; i < frames; i++)
    b.writeInt16LE(
      Math.round(24000 * Math.sin(i * 0.17) * (0.1 + 0.8 * Math.abs(Math.sin((i / frames) * 7)))),
      44 + i * 2,
    )
  return b
}
for (const [name, duration, origin, days, plays] of [
  ['01 波形测试', 8, 'local', 0, 0],
  ['02 刚收到的推荐', 32, 'daily', 3, 0],
  ['03 已听推荐', 1, 'daily', 2, 1],
  ['04 更早的推荐', 1, 'daily', 45, 0],
  ['05 手动下载', 1, 'download', 4, 0],
]) {
  const file = path.join(evidence, name + '.wav')
  await writeFile(file, wav(duration))
  store.library.upsert({ title: name, artist: '测试曲库', album: '', duration, file })
  const { id } = store.db.prepare('SELECT id FROM local_tracks WHERE file=?').get(file)
  if (origin !== 'local')
    store.db
      .prepare('INSERT INTO recording_copies(version,local,automatic) VALUES(?,?,?)')
      .run(id, id, origin === 'daily' ? 1 : 0)
  store.db
    .prepare('UPDATE local_tracks SET observedAt=? WHERE id=?')
    .run(Date.now() - days * 86400000, id)
  if (plays) store.library.heard(id)
}
for (const ext of ['flac', 'm4a', 'mp3']) {
  store.library.upsert({
    title: '编码 ' + ext,
    artist: '格式测试',
    album: '',
    duration: 2,
    file: path.resolve('tests/fixtures/local-music/tone.' + ext),
  })
}
// The file exists, but its restored index has not yet been associated by the user.
const pendingFile = path.join(evidence, '05 手动下载.wav')
const pendingId = store.db.prepare('SELECT id FROM local_tracks WHERE file=?').get(pendingFile).id
store.db.prepare('UPDATE local_tracks SET awaitingLocation=1,available=0 WHERE id=?').run(pendingId)
store.db.close()
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
let app = await launch()
try {
  let page = await app.firstWindow()
  const button = (name, scope = page) => scope.getByRole('button', { name, exact: true })
  async function settings() {
    await openMusicSettings(page)
    await selectMusicSettings(page, '插件')
  }
  const entry = (name) => page.getByRole('article').filter({ hasText: name })
  const wave = '波形与片段试听',
    rules = '智能歌单'
  await button('跳过').click()
  await settings()
  async function restart() {
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await page.waitForSelector('.music-shell')
    await page.evaluate(() => delete document.documentElement.dataset.backdrop)
    await settings()
  }
  await checkInstalled(page, profile, [])
  await installPublic(app, page, profile, 'wave')
  const readPending = () =>
    page.evaluate((id) => window.musicPlugins.call('wave', 'audio', id), pendingId)
  await assert.rejects(readPending(), /重新定位/)
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, pendingFile)
  await page.evaluate((id) => window.music.relocateLocal(id), pendingId)
  await expect
    .poll(async () => (await readPending().catch(() => null))?.peaks?.length ?? 0)
    .toBeGreaterThan(0)
  await button('打开', entry(wave)).click()
  const plot = page.getByRole('slider', { name: '波形定位' })
  const wavePanel = () => page.getByRole('region', { name: wave, exact: true })
  await expect(wavePanel().locator('.wave-plot svg')).toBeVisible()
  for (const ext of ['flac', 'm4a', 'mp3']) {
    await wavePanel().getByRole('combobox', { name: '分析歌曲' }).click()
    await page.getByRole('option', { name: '编码 ' + ext + ' · 格式测试' }).click()
    await expect(wavePanel().locator('.wave-plot svg')).toBeVisible()
    assert.ok((await wavePanel().locator('svg path').last().getAttribute('d')).length > 100)
  }
  await wavePanel().getByRole('combobox', { name: '分析歌曲' }).click()
  await page.getByRole('option', { name: '01 波形测试 · 测试曲库' }).click()
  let rect = await plot.boundingBox()
  let y = rect.y + rect.height / 2
  await page.mouse.click(rect.x + rect.width * 0.35, y)
  await expect.poll(() => page.locator('audio').evaluate((a) => a.currentTime)).toBeGreaterThan(2.6)
  const speed = page.getByRole('combobox', { name: '试听倍速' })
  async function measuredRate(expected) {
    const actual = await page.locator('audio').evaluate(async (a) => {
      const start = performance.now(),
        from = a.currentTime
      await new Promise((resolve) => setTimeout(resolve, 900))
      return {
        rate: a.playbackRate,
        clock: ((a.currentTime - from) * 1000) / (performance.now() - start),
      }
    })
    console.log('试听倍速', expected, '实测音乐秒/秒', actual.clock.toFixed(3))
    assert.equal(actual.rate, expected)
    assert.ok(Math.abs(actual.clock - expected) < 0.18, JSON.stringify(actual))
  }
  await speed.click()
  await page.getByRole('option', { name: '2×', exact: true }).click()
  await measuredRate(2)
  await speed.click()
  await page.getByRole('option', { name: '0.5×', exact: true }).click()
  await measuredRate(0.5)
  await page.screenshot({ path: path.join(evidence, 'wave-speed.png') })
  await button('恢复 1×').click()
  await measuredRate(1)
  await wavePanel().getByRole('textbox', { name: '标记名称' }).fill('鼓点')
  await button('标记当前位置', wavePanel()).click()
  await expect(wavePanel().getByRole('button', { name: /鼓点/ })).toBeVisible()
  await plot.scrollIntoViewIfNeeded()
  rect = await plot.boundingBox()
  y = rect.y + rect.height / 2
  await page.mouse.move(rect.x + rect.width * 0.2, y)
  await page.mouse.down()
  await page.mouse.move(rect.x + rect.width * 0.32, y, { steps: 6 })
  await page.mouse.up()
  await expect(button('关闭循环', wavePanel())).toHaveAttribute('aria-pressed', 'true')
  await page.locator('audio').evaluate((a) => {
    window.testLoopSeeks = 0
    a.addEventListener('seeked', () => {
      if (a.currentTime > 1.4 && a.currentTime < 1.9) window.testLoopSeeks++
    })
  })
  await expect.poll(() => page.evaluate(() => window.testLoopSeeks)).toBeGreaterThanOrEqual(2)
  await page.evaluate(() => delete document.documentElement.dataset.backdrop)
  await page.screenshot({ path: path.join(evidence, 'wave.png') })
  await button('关闭循环', wavePanel()).click()
  await speed.click()
  await page.getByRole('option', { name: '1.5×', exact: true }).click()
  await settings()
  await expect.poll(() => page.locator('audio').evaluate((a) => a.playbackRate)).toBe(1)
  await restart()
  await checkInstalled(page, profile, ['wave'])
  await button('打开', entry(wave)).click()
  async function existingMark() {
    await wavePanel().getByRole('combobox', { name: '分析歌曲' }).click()
    await page.getByRole('option', { name: '01 波形测试 · 测试曲库' }).click()
    await expect(page.getByRole('button', { name: /鼓点/ })).toBeVisible()
  }
  await existingMark()
  await settings()
  await uninstallPublic(page, profile, 'wave')
  await installPublic(app, page, profile, 'wave')
  await button('打开', entry(wave)).click()
  await existingMark()
  await settings()
  await uninstallPublic(page, profile, 'wave')
  await installPublic(app, page, profile, 'rules')
  await button('打开', entry(rules)).click()
  const smart = page.getByRole('region', { name: rules, exact: true })
  await expect(smart.getByRole('listitem')).toHaveCount(1)
  await expect(smart.getByRole('listitem')).toContainText('02 刚收到的推荐')
  await smart.getByLabel('歌单名称').fill('近月未听推荐')
  await button('保存规则', smart).click()
  await expect(smart.getByText('规则已保存')).toBeVisible()
  await page.screenshot({ path: path.join(evidence, 'rules.png') })
  await app.evaluate(({ BaseWindow }) =>
    BaseWindow.getAllWindows()
      .find((w) => w.getTitle() === 'Music')
      .setContentSize(480, 580),
  )
  await smart.getByRole('combobox', { name: '歌曲来源' }).click()
  await page.screenshot({ path: path.join(evidence, 'rules-menu-small.png') })
  await page.keyboard.press('Escape')
  await app.evaluate(({ BaseWindow }) =>
    BaseWindow.getAllWindows()
      .find((w) => w.getTitle() === 'Music')
      .setContentSize(840, 620),
  )
  await button('试听02 刚收到的推荐', smart).click()
  await expect
    .poll(() => page.locator('audio').evaluate((a) => a.currentTime > 0 && !a.paused))
    .toBe(true)
  await expect(smart.getByRole('listitem')).toHaveCount(0, { timeout: 45000 })
  await smart.getByRole('combobox', { name: '有效播放次数' }).click()
  await page.getByRole('option', { name: '至少', exact: true }).click()
  await smart.getByRole('spinbutton', { name: '次数', exact: true }).fill('1')
  await expect(smart.getByRole('listitem')).toHaveCount(2)
  await settings()
  await restart()
  await checkInstalled(page, profile, ['rules'])
  await button('打开', entry(rules)).click()
  await expect(page.getByLabel('歌单名称')).toHaveValue('近月未听推荐')
  await settings()
  await uninstallPublic(page, profile, 'rules')
  await installPublic(app, page, profile, 'rules')
  await button('打开', entry(rules)).click()
  await expect(page.getByLabel('歌单名称')).toHaveValue('近月未听推荐')
  await expect(page.locator('.smart-playlists li')).toHaveCount(0)
  await settings()
  await uninstallPublic(page, profile, 'rules')
  console.log(
    'PASS 四格式波形、定位、框选 A–B 实际循环、标记；规则三条件、实际播放达标自动更新；公开地址下载、重启可用、逐项卸载重装保留资料。' +
      evidence,
  )
} finally {
  await app.close()
}
