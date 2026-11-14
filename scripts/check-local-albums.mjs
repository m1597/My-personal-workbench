import { openMusicSettings } from './music-settings-fixture.mjs'
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
async function writeTrack(dir, title, artist, album, albumArtist, disc, track, picture) {
  const fields = {
    TIT2: title,
    TALB: album,
    TPE1: artist,
    TPOS: String(disc),
    TRCK: String(track),
  }
  if (albumArtist) fields.TPE2 = albumArtist
  const frames = Object.entries(fields).map(([name, value]) =>
    frame(name, Buffer.concat([Buffer.from([0]), Buffer.from(value, 'latin1')])),
  )
  if (picture)
    frames.push(
      frame('APIC', Buffer.concat([Buffer.from('\0image/png\0\x03\0', 'latin1'), picture])),
    )
  const tags = Buffer.concat(frames)
  const header = Buffer.from([73, 68, 51, 3, 0, 0, 0, 0, 0, 0])
  for (let i = 0; i < 4; i++) header[9 - i] = (tags.length >>> (7 * i)) & 127
  await writeFile(path.join(dir, title + '.mp3'), Buffer.concat([header, tags, audio]))
}
for (const [title, artist, albumArtist, disc, track, picture] of [
  ['Nightfall', 'Northern Trio', 'Northern Trio', 2, 1, false],
  ['Overture', 'Guest', 'Northern Trio', 1, 1, false],
  ['Interlude', 'Northern Trio', 'Northern Trio', 1, 2, true],
  ['Low Tide', 'South Duo', '', 1, 1, false],
]) {
  await writeTrack(library, title, artist, 'Echo', albumArtist, disc, track, picture && cover)
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
  await openMusicSettings(page)
  await page.getByRole('button', { name: '添加文件夹' }).click()
  await page.getByRole('tab', { name: '曲库' }).click()
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
  await expect(duoCard.locator('img')).toHaveAttribute('src', './default-cover.png')
  await expect(trioCard.locator('img')).toHaveAttribute('src', embedded)
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
  await page.locator('.album-tracks li').first().click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: '查看文件所在位置' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '播放整张', exact: true }).click()
  await expect.poll(async () => (await state()).queue).toEqual(trio.tracks)
  const player = page.locator('audio')
  await expect.poll(() => player.evaluate((a) => !a.paused && a.currentTime > 0)).toBe(true)
  await expect(page.locator('.music-player .music-disc img')).toHaveAttribute('src', embedded)
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
  await page.getByRole('button', { name: '播放Overture', exact: true }).click()
  await page.getByRole('button', { name: '打开歌词页' }).click()
  const playerPage = page.getByRole('region', { name: '播放页' })
  await expect(playerPage.locator('.album-art img')).toHaveAttribute('src', embedded)
  await expect(playerPage.getByRole('status')).toHaveText('暂无歌词')
  await page.screenshot({
    scale: 'css',
    path: path.join(root, 'now-playing-embedded.png'),
  })
  await playerPage.getByRole('button', { name: '返回', exact: true }).click()
  await page.getByRole('button', { name: '播放Low Tide', exact: true }).click()
  await expect(page.locator('.music-player .music-disc img')).toHaveAttribute(
    'src',
    './default-cover.png',
  )
  await page.getByRole('button', { name: '打开歌词页' }).click()
  await expect(playerPage.locator('.album-art img')).toHaveAttribute('src', './default-cover.png')
  await page.screenshot({
    scale: 'css',
    path: path.join(root, 'now-playing-default.png'),
  })
  await playerPage.getByRole('button', { name: '返回', exact: true }).click()
  await page.getByRole('button', { name: '专辑', exact: true }).click()
  await duoCard.click()
  await expect(detail.locator('.album-art img')).toHaveAttribute('src', './default-cover.png')
  const extra = path.join(root, 'covers')
  await mkdir(extra)
  const names = ['Daybreak', 'Noon', 'Dusk', 'Midnight']
  for (const [i, name] of names.entries()) {
    const picture = await page.evaluate(
      ([name, i]) => {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 128
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = ['#264966', '#8b542d', '#5c3d63', '#283b50'][i]
        ctx.fillRect(0, 0, 128, 128)
        ctx.fillStyle = '#faf2d8'
        ctx.beginPath()
        ctx.arc(35 + i * 18, 35, 16, 0, 2 * Math.PI)
        ctx.fill()
        ctx.font = '16px serif'
        ctx.fillText(name, 10, 108)
        return canvas.toDataURL().split(',')[1]
      },
      [name, i],
    )
    await writeTrack(extra, name, 'Seasons', name, '', 1, 1, Buffer.from(picture, 'base64'))
  }
  await app.evaluate(({ dialog, BaseWindow }, dir) => {
    BaseWindow.getAllWindows()[0].setContentSize(1040, 720)
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
  }, extra)
  await openMusicSettings(page)
  await page.getByRole('button', { name: '添加文件夹' }).click()
  await expect.poll(async () => (await state()).localTracks.length).toBe(8)
  const byTitle = new Map((await state()).localTracks.map((t) => [t.title, t.id]))
  const ids = ['Overture', 'Nightfall', 'Low Tide', ...names].map((name) => byTitle.get(name))
  await page.evaluate(async (ids) => {
    await window.music.createPlaylist('四季', ids)
    await window.music.createPlaylist('单封面', ids.slice(0, 2))
    await window.music.createPlaylist('无封面', [ids[2]])
    await window.music.createPlaylist('双封面', ids.slice(0, 4))
  }, ids)
  await page.reload()
  await page.getByRole('tab', { name: '歌单', exact: true }).click()
  const choose = (name) => page.getByRole('button', { name, exact: true }).click()
  const images = page.locator('.playlist-cover img')
  for (const [list, expected] of [
    ['无封面', [null]],
    ['单封面', [ids[0]]],
    ['双封面', [ids[0], ids[3], null, null]],
    ['四季', [ids[0], ...ids.slice(3, 6)]],
  ]) {
    await choose(list)
    await expect(images).toHaveCount(expected.length)
    for (const [i, id] of expected.entries()) {
      const src = id
        ? await page.evaluate((track) => window.music.trackCover(track), id)
        : './default-cover.png'
      await expect(images.nth(i)).toHaveAttribute('src', src)
    }
    await page.screenshot({
      path: path.join(root, list + '.png'),
      style: ':root {background:var(--base) !important}',
    })
  }
  await page.getByRole('searchbox', { name: '搜索本地歌曲' }).fill('Noon')
  await expect(page.locator('.library-title')).toContainText('1 / 7 首歌曲')
  const seconds = (await state()).localTracks
    .filter((t) => ids.includes(t.id))
    .reduce((sum, t) => sum + t.duration, 0)
  await expect(page.locator('.library-title')).toContainText(
    '总时长 ' + Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0'),
  )
  await choose('播放全部')
  await expect.poll(async () => (await state()).queue).toEqual(ids)
  assert.deepEqual(await app.evaluate(() => globalThis.albumNetworkAttempts), [])
  assert.deepEqual(externalRequests, [])
  console.log(
    'PASS 同名专辑按艺人区分、共用内嵌封面、缺图占位、盘序曲序、整张连续播放、歌曲列表及窄窗口。',
    root,
  )
} finally {
  await app.close()
}
