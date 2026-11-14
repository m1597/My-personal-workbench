import path from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { MusicStore } from '../components/music/store.mjs'

const root = await mkdtemp(path.resolve('tmp/artist-photos-'))
const profile = path.join(root, 'profile')
const store = new MusicStore(path.join(profile, 'fitbay-music'))
const photo = { id: 'b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d', name: 'The Beatles' }
const missing = { id: '00000000-0000-0000-0000-000000000007', name: '无图样本' }
store.set('followed-musicbrainz-artists', JSON.stringify([photo, missing]))
store.set('music-guide-v1', '1')
store.set('lx-bootstrap', 'done')
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
  await app.evaluate(
    ({ app }, { photo, missing }) => {
      if (!app.commandLine.hasSwitch('mute-audio')) throw Error('未静音')
      const original = globalThis.fetch
      globalThis.pictureRequests = 0
      globalThis.fetch = (input, opts) => {
        const url = new URL(input)
        if (url.hostname === 'musicbrainz.org') {
          if (url.searchParams.get('inc') === 'url-rels' && url.pathname.endsWith(photo.id)) {
            globalThis.pictureRequests++
            return original(input, opts)
          }
          if (url.searchParams.get('inc') === 'url-rels' && url.pathname.endsWith(missing.id))
            return Response.json({ relations: [] })
          if (url.pathname.endsWith('/artist/' + missing.id))
            return Response.json({ genres: [{ name: 'rock', count: 5 }] })
          if (url.pathname.endsWith('/artist/'))
            return Response.json({ artists: [{ ...photo, tags: [{ name: 'rock', count: 3 }] }] })
          return Response.json({ 'release-groups': [], recordings: [] })
        }
        return original(input, opts)
      }
    },
    { photo, missing },
  )
  await page.getByRole('tab', { name: '歌手', exact: true }).click()
  const button = (name) => page.getByRole('button', { name, exact: true })
  for (const width of [1080, 420]) {
    await app.evaluate(({ BaseWindow }, width) => {
      const w = BaseWindow.getAllWindows().find((w) => w.getTitle() === 'Music')
      w.setMinimumSize(320, 400)
      w.setContentSize(width, 680)
    }, width)
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(width + 20)
    for (const artist of [photo, missing]) {
      const image = button(artist.name).first().locator('img')
      await expect(image).toHaveAttribute(
        'src',
        artist === photo ? /^data:image\/jpeg/ : /default-artist.webp$/,
        { timeout: 45000 },
      )
      assert.ok(
        await image.evaluate((el) => {
          const ring = el.parentElement,
            r = ring.getBoundingClientRect(),
            a = el.getBoundingClientRect()
          return (
            Math.abs(r.width - r.height) < 1 &&
            Math.abs(a.width - a.height) < 1 &&
            getComputedStyle(ring).borderRadius === '50%' &&
            getComputedStyle(el).objectFit === 'cover'
          )
        }),
      )
    }
    const columns = await page.evaluate(() => {
      const l = document.querySelector('.followed-artists').getBoundingClientRect(),
        r = document.querySelector('.release-news-column').getBoundingClientRect()
      return { left: l.x, right: r.x, top: l.y, bottom: r.y, width: l.width, other: r.width }
    })
    if (width > 500) assert.ok(columns.right > columns.left && columns.width > columns.other * 0.78)
    else assert.ok(columns.bottom > columns.top)
    await page.screenshot({
      path: path.join(root, 'following-' + width + '.png'),
      style: ':root{background:var(--base)!important}',
    })
  }
  const card = button(photo.name).first().locator('img')
  await expect(card).toHaveAttribute('src', /^data:image\/jpeg/, { timeout: 45000 })
  const image = await card.getAttribute('src')
  await card.click()
  const home = page.getByRole('region', { name: '歌手主页' })
  await expect(home.locator('header img')).toHaveAttribute('src', image)
  await page.screenshot({
    path: path.join(root, 'artist-photo.png'),
    style: ':root{background:var(--base)!important}',
  })
  const back = home.getByRole('button', { name: '返回', exact: true })
  await expect(back).toHaveAttribute('title', '返回')
  assert.equal(await back.innerText(), '')
  assert.ok((await back.boundingBox()).width >= 40)
  await back.click()
  await button(missing.name).first().click()
  await expect(home.locator('header img')).toHaveAttribute('src', './default-artist.webp')
  await page.screenshot({
    path: path.join(root, 'artist-fallback.png'),
    style: ':root{background:var(--base)!important}',
  })
  await home.getByRole('button', { name: '返回' }).click()
  const similar = page.getByRole('region', { name: '相似歌手' })
  await expect(similar.locator('img').first()).toHaveAttribute('src', image, { timeout: 10000 })
  assert.equal(await app.evaluate(() => globalThis.pictureRequests), 1)
  console.log('PASS 艺人真实远程照片、无图回退、关注及相似列表共用同一照片', root)
} finally {
  await app.close()
}
