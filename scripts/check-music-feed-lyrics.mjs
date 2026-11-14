import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
await mkdir('tmp', { recursive: true })
const root = await mkdtemp(path.resolve('tmp/feed-lyrics-ui-'))
console.log(root)
const profile = path.join(root, 'profile')
const store = new MusicStore(path.join(profile, 'fitbay-music'))
store.set('music-guide-v1', '1')
store.set('music-muted', 'on')
const aid = '10000000-0000-0000-0000-000000000001',
  bid = '10000000-0000-0000-0000-000000000002'
store.set(
  'followed-musicbrainz-artists',
  JSON.stringify([
    { id: aid, name: '青禾' },
    { id: bid, name: '山雀' },
  ]),
)
// One-pixel warm and cool PNGs exercise the same embedded cover decoder as real artwork.
const pictures = [
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN4Vm4NAAPfAZk6qrVNAAAAAElFTkSuQmCC',
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMQD14LAAGcARirKHD3AAAAAElFTkSuQmCC',
]
const original = await readFile('tests/fixtures/local-music/tone.mp3')
const tagSize = original.subarray(6, 10).reduce((n, b) => n * 128 + b, 0)
const audio = original.subarray(10 + tagSize)
for (const [idx, title] of ['暖阳', '深海', '云端'].entries()) {
  const file = path.join(root, title + '.mp3')
  const frames = []
  if (idx < 2)
    for (const type of idx === 0 ? [3, 8] : [3]) {
      const bytes = Buffer.concat([
        Buffer.from([0]),
        Buffer.from('image/png'),
        Buffer.from([0, type, 0]),
        Buffer.from(pictures[idx], 'base64'),
      ])
      const f = Buffer.alloc(10)
      f.write('APIC')
      f.writeUInt32BE(bytes.length, 4)
      frames.push(f, bytes)
    }
  const tags = Buffer.concat(frames),
    head = Buffer.from([73, 68, 51, 3, 0, 0, 0, 0, 0, 0])
  for (let i = 0; i < 4; i++) head[9 - i] = (tags.length >>> (7 * i)) & 127
  await writeFile(file, Buffer.concat([head, tags, audio]))
  await writeFile(
    path.join(root, title + '.lrc'),
    '[00:00.00]沿着岸边慢慢走\n[00:08.00]星光落在水面\n[00:16.00]再听一遍',
  )
  store.library.upsert({
    file,
    title,
    album: title,
    artist: '青禾',
    albumArtist: '青禾',
    duration: 20,
  })
}
store.db.close()
const app = await electron.launch({
  args: [
    path.resolve('dist/component-prototype/host'),
    '--mode=music',
    '--mute-audio',
    '--user-data-dir=' + profile,
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  const page = await app.firstWindow()
  await page.waitForSelector('.music-shell')
  await app.evaluate(({ BaseWindow, app }) => {
    if (!app.commandLine.hasSwitch('mute-audio')) throw Error('静音开关缺失')
    BaseWindow.getAllWindows()[0].setContentSize(960, 680)
    globalThis.fetch = async (url) => {
      if (url.origin === 'https://musicbrainz.org' && url.pathname === '/ws/2/recording')
        return Response.json({ recordings: [] })
      if (url.origin !== 'https://musicbrainz.org' || url.pathname !== '/ws/2/release-group')
        throw Error('非预期请求')
      const id = '10000000-0000-0000-0000-000000000001'
      const historic = {
        'artist-credit': [{ artist: { id, name: '青禾' } }],
        id: '20000000-0000-0000-0000-000000000001',
        title: '暖阳',
        'primary-type': 'Album',
        'first-release-date': '2001-08-10',
      }
      return Response.json({ 'release-groups': [historic] })
    }
  })
  await page.evaluate(() => {
    document.documentElement.style.backgroundColor = 'var(--base)'
  })
  const shot = (name) => page.screenshot({ path: path.join(root, name + '.png') })
  const btn = (name) => page.getByRole('button', { name, exact: true })
  await page.getByRole('tab', { name: '歌手', exact: true }).click()
  await expect(page.getByText('近 90 天暂无新发行。')).toBeVisible()
  await expect(btn('青禾').locator('img')).toHaveAttribute('src', /^data:image/)
  await expect(btn('山雀').locator('img')).toHaveAttribute('src', './default-artist.webp')
  await expect
    .poll(() =>
      btn('山雀')
        .locator('img')
        .evaluate((img) => img.naturalWidth),
    )
    .toBe(256)
  await shot('动态关注')
  await btn('青禾').click()
  const group = page.getByRole('region', { name: '歌手主页', exact: true })
  await expect(group.getByRole('button', { name: /暖阳.*2001/ })).toBeVisible()
  await group.locator('.catalog-release-link').scrollIntoViewIfNeeded()
  await expect(group.locator('.album-art img')).toHaveAttribute('src', /^data:image/)
  await shot('往年发行')
  await group.getByRole('button', { name: '返回' }).click()
  await expect(btn('管理关注')).toHaveCount(0)
  await expect(btn('取消关注青禾')).toBeVisible()
  await page.getByRole('tab', { name: '曲库', exact: true }).click()
  for (const [idx, title] of ['暖阳', '深海', '云端'].entries()) {
    await btn('播放' + title).click()
    await btn('打开歌词页').click()
    await expect(page.getByRole('region', { name: '同步歌词' })).toBeVisible()
    await expect(page.locator('.record-art-current .album-art img')).toHaveAttribute(
      'src',
      idx < 2 ? /^data:image/ : './default-cover.png',
    )
    await expect(page.locator('.record-art-layer')).toHaveCount(1)
    await page.locator('.record-art-current').evaluate(async (layer) => {
      await Promise.all(layer.getAnimations().map((animation) => animation.finished))
    })
    await shot(title)
    const pane = page.locator('.now-playing-lyric-pane')
    await expect(pane).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(pane).toHaveCSS('border-top-width', '0px')
    await expect(pane).toHaveCSS('border-radius', '0px')
    const contrast = await pane.evaluate((glass) => {
      // Canvas resolves the theme's color-mix and alpha composition in Chromium's sRGB space.
      const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
      const luminance = () => {
        const [red, green, blue] = [...ctx.getImageData(0, 0, 1, 1).data].map((byte) => {
          const channel = byte / 255
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue
      }
      const viewport = glass.querySelector('.now-playing-lyrics')
      const line = viewport.querySelector('button:not([aria-current])')
      ctx.fillStyle = getComputedStyle(document.documentElement).backgroundColor
      ctx.fillRect(0, 0, 1, 1)
      ctx.fillStyle = getComputedStyle(glass).backgroundColor
      ctx.fillRect(0, 0, 1, 1)
      const background = luminance()
      ctx.fillStyle = getComputedStyle(line).color
      ctx.globalAlpha = Number(getComputedStyle(line).opacity)
      ctx.fillRect(0, 0, 1, 1)
      return (luminance() + 0.05) / (background + 0.05)
    })
    console.log(title, '非高亮歌词对比度', contrast.toFixed(2))
    assert.ok(contrast >= 4.5, title + '歌词对比不足')
    if (idx === 0) {
      await btn('下一首').click()
      await expect(page.locator('.now-playing-record h2')).not.toHaveText(title)
      await expect(page.locator('.record-art-layer')).toHaveCount(1)
    }
    await btn('返回').click()
  }
  console.log('PASS 无近期发行、艺人头像、历年专辑、暖冷色切换与默认图歌词对比度', root)
} finally {
  await app.close()
}
