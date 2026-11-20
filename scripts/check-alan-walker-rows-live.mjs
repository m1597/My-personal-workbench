import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import { _electron as electron, expect } from '@playwright/test'
import { isolateRecommendationProfile } from './isolate-recommendation-profile.mjs'

const root = await fs.mkdtemp(path.resolve('tmp/alan-walker-rows-'))
const profile = path.join(root, 'profile')
const directory = path.join(profile, 'fitbay-music')
await fs.mkdir(directory, { recursive: true })
const file = path.join(directory, 'music.sqlite')
const original = new DatabaseSync(path.resolve('local/desktop-profile/fitbay-music/music.sqlite'), {
  readOnly: true,
})
try {
  await backup(original, file)
} finally {
  original.close()
}
const db = new DatabaseSync(file)
const getSong = db.prepare(
  'SELECT id,title,artist,album,file FROM local_tracks WHERE title=? AND available=1 LIMIT 1',
)
const initial = getSong.get('Faded'),
  song = getSong.get('All Falls Down')
try {
  assert.ok(initial && song?.album && song.artist)
  isolateRecommendationProfile(db, directory)
  for (const t of [initial, song]) {
    const copy = path.join(root, t.id + path.extname(t.file))
    await fs.copyFile(t.file, copy)
    db.prepare(
      'UPDATE local_tracks SET file=?,path_key=?,available=1,awaitingLocation=0 WHERE id=?',
    ).run(copy, copy.toLowerCase(), t.id)
  }
  const set = db.prepare('INSERT OR REPLACE INTO state(key,value) VALUES(?,?)')
  for (const pair of [
    ['music-guide-v1', '1'],
    ['music-global-keys', 'off'],
    ['music-media-keys', 'off'],
    ['music-muted', 'on'],
    ['lx-bootstrap', 'done'],
  ])
    set.run(...pair)
} finally {
  db.close()
}

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
  assert.ok(
    await app.evaluate(
      ({ app, BaseWindow }) =>
        app.commandLine.hasSwitch('mute-audio') &&
        BaseWindow.getAllWindows().every((w) => !w.isFocusable()),
    ),
  )
  const button = (scope, name) => scope.getByRole('button', { name, exact: true })
  const query = page.getByRole('searchbox', { name: '搜索本地歌曲' })

  const evidence = []
  for (const width of [1000, 420]) {
    await page.setViewportSize({ width, height: 680 })
    await query.fill(song.title)
    const row = page.locator('.library-row').filter({ hasText: song.title }).first()
    await button(row, 'Alan Walker').click()
    const artist = page.getByRole('region', { name: '歌手主页', exact: true })
    const collected = artist.locator('.catalog-recording').filter({ hasText: song.title }).first()
    if ((await collected.locator('.row-play').getAttribute('aria-label')).startsWith('播放'))
      await collected.locator('.row-play').click()
    const audio = page.locator('audio')
    await expect.poll(() => audio.evaluate((a) => !a.paused && a.currentTime > 0)).toBe(true)
    await button(collected, '暂停' + song.title).click()
    await expect.poll(() => audio.evaluate((a) => a.paused)).toBe(true)
    await button(collected, '播放' + song.title).click()
    const recordings = artist
      .getByRole('region', { name: '全部歌曲' })
      .locator('.highlight-recording')
    let external = ''
    try {
      await recordings.first().waitFor({ state: 'attached', timeout: 45000 })
    } catch {
      external = (await artist.textContent()) || ''
    }
    let geometry
    if (await recordings.count()) {
      const first = recordings.first()
      geometry = await first.evaluate((el) => {
        const rect = (sel) => {
          const r = el.querySelector(sel).getBoundingClientRect()
          return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }
        }
        return {
          play: rect('.row-play'),
          title: rect('.catalog-song-title'),
          credits: rect('.catalog-song-text > small'),
          actions: rect('.search-result-actions'),
        }
      })
      assert.ok(
        geometry.play.right <= geometry.title.x + 1 &&
          geometry.title.bottom <= geometry.credits.y + 1 &&
          geometry.title.right <= geometry.actions.x + 1,
        JSON.stringify(geometry),
      )
      await first.scrollIntoViewIfNeeded()
      await page.screenshot({ path: path.join(root, width + '-recordings.png') })
    }
    const albumLink = artist
      .locator('.catalog-releases .catalog-text-link')
      .filter({ hasText: song.title })
      .first()
    await albumLink.evaluate((el) => el.scrollIntoView({ block: 'center' }))
    const scroller = page.locator('.music-scroll')
    const before = await scroller.evaluate((el) => el.scrollTop)
    await albumLink.click()
    const album = page.getByRole('region', { name: '专辑主页', exact: true })
    await expect(album.getByRole('heading', { name: song.title, exact: true })).toBeVisible()
    await page.screenshot({ path: path.join(root, width + '-album.png') })
    await button(album, '返回').click()
    await expect(artist).toBeVisible()
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(before)
    await page.screenshot({ path: path.join(root, width + '-returned.png') })
    evidence.push({
      width,
      album: song.title,
      artist: 'Alan Walker',
      before,
      after: await scroller.evaluate((el) => el.scrollTop),
      geometry,
      external,
      recordings: await recordings.count(),
      playing: await audio.evaluate((a) => !a.paused),
    })
    await button(artist, '返回').click()
  }
  await fs.writeFile(path.join(root, '验收.json'), JSON.stringify(evidence, null, 2))
  console.log(root, evidence)
} finally {
  await app.close()
}
