import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { openMusicSettings, selectMusicSettings } from './music-settings-fixture.mjs'

await mkdir('tmp', { recursive: true })
const root = await mkdtemp(path.resolve('tmp/song-path-'))
const profile = path.join(root, 'profile')
const pack = path.resolve('dist/song-path-offline/plugin-packs/path.fitbayplugin')
const store = new MusicStore(path.join(profile, 'fitbay-music'))
store.set('music-guide-v1', 1)
store.set('music-media-keys', 'off')
// Equal amplitude and dynamics, monotonically increasing brightness.
const songs = [
  ['起点', 120],
  ['过渡低音', 510],
  ['过渡高音', 1000],
  ['终点', 1580],
]
for (const [title, frequency] of songs) {
  const bytes = Buffer.alloc(44 + 8000 * 4 * 2)
  bytes.write('RIFF')
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(8000, 24)
  bytes.writeUInt32LE(16000, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(bytes.length - 44, 40)
  for (let i = 0; i < 32000; i++)
    bytes.writeInt16LE(
      Math.round(19000 * Math.sin((i * frequency * 2 * Math.PI) / 8000)),
      44 + i * 2,
    )
  const file = path.join(root, title + '.wav')
  await writeFile(file, bytes)
  store.library.upsert({ title, artist: '音色夹具', album: '', duration: 4, file })
}
const ids = songs.map(
  ([title]) => store.db.prepare('SELECT id FROM local_tracks WHERE title=?').get(title).id,
)
store.db.close()
const launch = () =>
  electron.launch({
    args: [
      path.resolve('dist/component-prototype/host'),
      '--mode=music',
      '--mute-audio',
      '--host-resolver-rules=MAP * ~NOTFOUND',
      '--user-data-dir=' + profile,
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
let app = await launch()
async function offlinePage() {
  const page = await app.firstWindow()
  await app.evaluate(({ app, BaseWindow, dialog, session, webContents }, pack) => {
    for (const partition of new Set([
      session.defaultSession,
      ...webContents.getAllWebContents().map((w) => w.session),
    ])) {
      partition.enableNetworkEmulation({ offline: true })
    }
    function noNetwork() {
      throw Error('测试已断开外部网络')
    }
    globalThis.fetch = noNetwork
    for (const protocol of ['node:http', 'node:https']) {
      const client = process.getBuiltinModule(protocol)
      client.request = noNetwork
      client.get = noNetwork
    }
    if (
      !app.commandLine.hasSwitch('mute-audio') ||
      BaseWindow.getAllWindows().some((w) => w.isFocusable())
    )
      throw Error('后台静音要求未满足')
    BaseWindow.getAllWindows()
      .find((w) => w.getTitle() === 'Music')
      .setContentSize(990, 710)
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [pack] })
  }, pack)
  const unreachable = await app.evaluate(async ({ session }) => {
    try {
      await session.defaultSession.fetch('https://example.org/', { cache: 'no-store' })
      return false
    } catch {
      return true
    }
  })
  assert.equal(unreachable, true)
  return page
}
try {
  let page = await offlinePage()
  await openMusicSettings(page)
  await selectMusicSettings(page, '插件')
  let card = page.getByRole('article').filter({ hasText: '歌曲过渡' })
  const button = (title, scope = page) => scope.getByRole('button', { name: title, exact: true })
  await expect(card).toContainText('未安装')
  await expect(card.getByRole('button', { name: /下载/ })).toHaveCount(0)
  await button('选择插件文件', card).click()
  await expect(card).toContainText('已安装')
  const shot = async (name) =>
    page.screenshot({
      path: path.join(root, name + '.png'),
      animations: 'disabled',
      style: ':root {background:var(--base)!important}',
    })
  await shot('01-installed')
  await app.close()
  app = await launch()
  page = await offlinePage()
  await openMusicSettings(page)
  await selectMusicSettings(page, '插件')
  card = page.getByRole('article').filter({ hasText: '歌曲过渡' })
  await expect(card).toContainText('已安装')
  await button('打开', card).click()
  async function select(label, song) {
    await page.getByRole('combobox', { name: label, exact: true }).click()
    await page.getByRole('option', { name: song + ' · 音色夹具', exact: true }).click()
  }
  await select('起点歌曲', '起点')
  await select('终点歌曲', '终点')
  await page.getByRole('spinbutton', { name: '中间曲数' }).fill('2')
  await button('生成过渡队列').click()
  await expect(page.getByRole('list', { name: '过渡队列' }).getByRole('listitem')).toHaveText(
    songs.map(([title]) => title + ' · 音色夹具'),
  )
  await button('播放过渡队列').click()
  await expect
    .poll(() => page.locator('audio').evaluate((a) => !a.paused && a.currentTime > 0))
    .toBe(true)
  const state = await page.evaluate(() => window.music.state())
  assert.deepEqual(state.queue, ids)
  assert.equal(state.current, ids[0])
  await shot('02-playing')
  await expect
    .poll(() => page.evaluate(async () => (await window.music.state()).current), { timeout: 8000 })
    .toBe(ids[1])
  const digest = createHash('sha256')
    .update(await readFile(pack))
    .digest('hex')
  await writeFile(
    path.join(root, 'verification.json'),
    JSON.stringify(
      {
        digest,
        offline: true,
        restart: true,
        songs: songs.map(([title]) => title),
        automaticNext: true,
      },
      null,
      2,
    ),
  )
  console.log('PASS offline installation, feature order, playback and automatic next', digest, root)
} finally {
  await app.close()
}
