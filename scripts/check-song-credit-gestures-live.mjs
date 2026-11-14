import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import { _electron as electron, expect } from '@playwright/test'
import { isolateRecommendationProfile } from './isolate-recommendation-profile.mjs'

const root = await fs.mkdtemp(path.resolve('tmp/song-credit-gestures-'))
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
const initial = getSong.get('Beautiful World'),
  song = getSong.get('One Last Kiss')
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
  const row = page
    .locator('.library-row')
    .filter({ has: page.locator('.library-name strong', { hasText: song.title }) })
    .first()
  const now = page.locator('.music-title-row strong').first()
  const audio = page.locator('audio')
  const time = () => audio.evaluate((a) => a.currentTime)
  const evidence = []
  for (const kind of ['歌手', '专辑']) {
    const title = kind === '歌手' ? song.artist : song.album
    const home = page.getByRole('region', { name: kind + '主页', exact: true })
    for (const double of [false, true]) {
      await query.fill(initial.title)
      const starter = button(page, '播放' + initial.title).first()
      if (await starter.count()) await starter.click()
      await expect(now).toHaveText(initial.title)
      await expect.poll(() => audio.evaluate((a) => !a.paused && a.currentTime > 0)).toBe(true)
      await query.fill(song.title)
      const link =
        kind === '歌手'
          ? button(row, title)
          : row.locator('.library-album').getByRole('button', { name: title, exact: true })
      if (double) {
        await link.dblclick({ delay: 120 })
        await expect(now).toHaveText(song.title)
        const before = await time()
        await expect.poll(time).toBeGreaterThan(before + 1)
        await expect(query).toHaveValue(song.title)
        await expect(link).toBeVisible()
        await expect(home).toHaveCount(0)
        evidence.push({
          kind,
          gesture: '双击',
          before,
          after: await time(),
          playing: await now.textContent(),
          list: await query.inputValue(),
        })
      } else {
        await link.click()
        await expect(home.getByRole('heading', { name: title, exact: true })).toBeVisible()
        await expect(now).toHaveText(initial.title)
        evidence.push({ kind, gesture: '单击', home: title, playing: await now.textContent() })
        await page.getByRole('tab', { name: '曲库', exact: true }).click()
      }
    }
  }
  await fs.writeFile(path.join(root, '验收.json'), JSON.stringify(evidence, null, 2))
  console.log(root, evidence)
} finally {
  await app.close()
}
