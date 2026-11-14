import path from 'node:path'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { recording } from '../components/music/offline-source.mjs'

const root = await mkdtemp(path.resolve('tmp/library-row-layout-')),
  profile = path.join(root, 'profile'),
  store = new MusicStore(path.join(profile, 'fitbay-music'))
for (const title of ['曲库单击', '备用曲目']) {
  const file = path.join(root, title + '.wav')
  await writeFile(file, recording('fitbay-tone-1'))
  store.library.upsert({ file, title, artist: '实测', album: '', duration: 20 })
}
store.set('music-guide-v1', 1)
store.db.close()
const app = await electron.launch({
  args: [
    path.resolve('dist/component-prototype/host'),
    '--mode=music',
    '--user-data-dir=' + profile,
    '--mute-audio',
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  const page = await app.firstWindow()
  for (const width of [920, 410]) {
    await app.evaluate(
      ({ BaseWindow }, width) => BaseWindow.getAllWindows()[0].setContentSize(width, 630),
      width,
    )
    const row = page
      .locator('.library-row')
      .filter({ has: page.getByText('曲库单击', { exact: true }) })
    const drag = row.locator('.track-actions [data-audio-drag]')
    await expect(drag).toBeVisible()
    assert.equal(await drag.getAttribute('draggable'), 'true')
    await expect(row.locator('.library-track-title .library-track-location')).toHaveText('本地')
    const dimensions = await page.evaluate(() => {
      const t = document.querySelector('.library-title'),
        rect = (el) => {
          const r = el.getBoundingClientRect()
          return [r.x, r.y, r.width, r.height]
        }
      const [recent, multi] = Array.from(t.querySelectorAll('button')).slice(-2)
      return {
        heading: rect(t.querySelector('h2')),
        recent: rect(recent),
        multi: rect(multi),
        actions: rect(document.querySelector('.track-actions')),
        width: document.documentElement.clientWidth,
      }
    })
    assert.ok(dimensions.heading[0] < dimensions.recent[0])
    assert.equal(dimensions.recent[1], dimensions.multi[1])
    assert.equal(dimensions.recent[3], dimensions.multi[3])
    assert.ok(dimensions.multi[0] - dimensions.recent[0] - dimensions.recent[2] <= 10)
    assert.ok(dimensions.actions[0] + dimensions.actions[2] <= dimensions.width)
    await page.screenshot({
      path: path.join(root, width + '.png'),
      style: ':root{background:var(--base)!important}',
    })
    console.log(width, dimensions)
    if (width === 920) {
      await row.locator('.library-name strong').dispatchEvent('click', { detail: 1 })
      await expect
        .poll(() => page.locator('audio').evaluate((a) => !a.paused && a.currentTime > 0.1))
        .toBe(true)
    }
  }
  console.log(root)
} finally {
  await app.close()
}
