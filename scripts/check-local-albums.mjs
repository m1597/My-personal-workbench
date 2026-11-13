import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'

await mkdir('tmp', { recursive: true })
const root = await mkdtemp(path.resolve('tmp/local-albums-'))
const profile = path.join(root, 'profile')
const library = path.join(root, 'albums')
await mkdir(library)
const store = new MusicStore(path.join(profile, 'fitbay-music'))
store.set('music-guide-v1', '1')
store.set('music-muted', 'on')
store.set('music-media-keys', 'off')
store.db.close()
const original = await readFile('tests/fixtures/local-music/tone.mp3')
assert.equal(original.toString('ascii', 0, 3), 'ID3')
const tagSize = original.subarray(6, 10).reduce((n, byte) => n * 128 + byte, 0)
const audio = original.subarray(10 + tagSize)
const cover = await readFile('src/renderer/public/fitbay.png')
function frame(name, bytes) {
  const header = Buffer.alloc(10)
  header.write(name)
  header.writeUInt32BE(bytes.length, 4)
  return Buffer.concat([header, bytes])
}
for (const [title, artist, albumArtist, disc, track, picture] of [
  ['Nightfall', 'Northern Trio', 'Northern Trio', 2, 1, false],
  ['Overture', 'Guest', 'Northern Trio', 1, 1, false],
  ['Interlude', 'Northern Trio', 'Northern Trio', 1, 2, true],
  ['Low Tide', 'South Duo', '', 1, 1, false],
]) {
  const fields = {
    TIT2: title,
    TALB: 'Echo',
    TPE1: artist,
    TPOS: String(disc),
    TRCK: String(track),
  }
  if (albumArtist) fields.TPE2 = albumArtist
  const frames = Object.entries(fields).map(([name, value]) =>
    frame(name, Buffer.concat([Buffer.from([0]), Buffer.from(value, 'latin1')])),
  )
  if (picture)
    frames.push(frame('APIC', Buffer.concat([Buffer.from('\0image/png\0\x03\0', 'latin1'), cover])))
  const tags = Buffer.concat(frames)
  const header = Buffer.from([73, 68, 51, 3, 0, 0, 0, 0, 0, 0])
  for (let i = 0; i < 4; i++) header[9 - i] = (tags.length >>> (7 * i)) & 127
  await writeFile(path.join(library, title + '.mp3'), Buffer.concat([header, tags, audio]))
}
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
try {
  const page = await app.firstWindow()
  await page.waitForSelector('.music-shell')
  await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].setContentSize(1040, 720))
  await app.evaluate(({ dialog, session, app }, library) => {
    if (!app.commandLine.hasSwitch('mute-audio')) throw Error('静音开关缺失')
    globalThis.albumNetworkAttempts = []
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*'] },
      (details, callback) => {
        globalThis.albumNetworkAttempts.push(new URL(details.url).hostname)
        callback({ cancel: true })
      },
    )
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [library] })
  }, library)

  const externalRequests = []
  page.on('request', (request) => {
    if (/^https?:/i.test(request.url())) externalRequests.push(request.url())
  })
  await page.context().setOffline(true)
  // A renderer screenshot excludes DWM; use the component's actual dark fallback for captures.
  await page.evaluate(() => {
    document.documentElement.style.backgroundColor = getComputedStyle(
      document.documentElement,
    ).getPropertyValue('--base')
  })
  await page.getByRole('tab', { name: '设置' }).click()
  await page.getByRole('button', { name: '添加文件夹' }).click()
  await page.getByRole('tab', { name: '本地曲库' }).click()
  await expect(page.locator('.library-row')).toHaveCount(4)
  const albums = await page.evaluate(() => window.music.albums())
  const trio = albums.find((a) => a.artist === 'Northern Trio' && a.title === 'Echo')
  const duo = albums.find((a) => a.artist === 'South Duo' && a.title === 'Echo')
  assert.ok(trio && duo)
  assert.equal(albums.length, 2)
  assert.equal(trio.tracks.length, 3)
  assert.equal(duo.tracks.length, 1)
  assert.equal(await page.evaluate((id) => window.music.albumCover(id), duo.id), null)
  const embedded = await page.evaluate((id) => window.music.albumCover(id), trio.id)
  assert.ok(embedded.startsWith('data:image/'))
  await page.getByRole('button', { name: '专辑', exact: true }).click()
  const grid = page.getByRole('region', { name: '专辑列表' })
  const trioCard = grid.getByRole('button', { name: 'Echo · Northern Trio', exact: true })
  const duoCard = grid.getByRole('button', { name: 'Echo · South Duo', exact: true })
  await expect(trioCard).toBeVisible()
  await expect(duoCard).toBeVisible()
  await expect
    .poll(() =>
      trioCard
        .locator('img')
        .evaluateAll((images) => images.filter((i) => i.complete && i.naturalWidth > 0).length),
    )
    .toBe(1)
  assert.equal(await duoCard.locator('img').count(), 0)
  await page.screenshot({ scale: 'css', path: path.join(root, 'albums.png') })
  await trioCard.click()
  const detail = page.getByRole('region', { name: '专辑曲目' })
  const state = () => page.evaluate(() => window.music.state())
  const titles = new Map((await state()).localTracks.map((r) => [r.id, r.title]))
  assert.deepEqual(
    trio.tracks.map((id) => titles.get(id)),
    ['Overture', 'Interlude', 'Nightfall'],
  )
  for (const title of ['Overture', 'Interlude', 'Nightfall'])
    await expect(detail.getByText(title, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '播放整张', exact: true }).click()
  await expect.poll(async () => (await state()).queue).toEqual(trio.tracks)
  const player = page.locator('audio')
  await expect.poll(() => player.evaluate((a) => !a.paused && a.currentTime > 0)).toBe(true)
  await page.screenshot({ scale: 'css', path: path.join(root, 'album-detail.png') })
  await player.evaluate((a) => {
    a.currentTime = a.duration - 0.12
  })
  await expect.poll(async () => (await state()).current).toBe(trio.tracks[1])
  await page.getByRole('button', { name: '返回专辑', exact: true }).click()
  await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].setContentSize(580, 580))
  await expect(duoCard).toBeVisible()
  await page.screenshot({ scale: 'css', path: path.join(root, 'albums-small.png') })
  await page.getByRole('button', { name: '歌曲', exact: true }).click()
  await expect(page.locator('.library-row')).toHaveCount(4)
  assert.deepEqual((await state()).queue, trio.tracks)
  assert.deepEqual(await app.evaluate(() => globalThis.albumNetworkAttempts), [])
  assert.deepEqual(externalRequests, [])
  console.log(
    'PASS 同名专辑按艺人区分、共用内嵌封面、缺图占位、盘序曲序、整张连续播放、歌曲列表及窄窗口。',
    root,
  )
} finally {
  await app.close()
}
