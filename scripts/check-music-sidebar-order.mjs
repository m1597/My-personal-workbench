import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { recording } from '../components/music/offline-source.mjs'

const root = await mkdtemp(path.resolve('tmp/sidebar-order-'))
const profile = path.join(root, 'profile')
const store = new MusicStore(path.join(profile, 'fitbay-music'))
for (const title of ['A', 'B', 'C']) {
  const dir = path.join(root, title)
  await mkdir(dir)
  const file = path.join(dir, title + '.wav')
  await writeFile(file, recording('fitbay-tone-1'))
  store.library.upsert({ title, file, artist: '临时测试', album: '', duration: 20 })
  store.library.createPlaylist('歌单' + title)
}
store.set('music-guide-v1', '1')
store.set('music-muted', 'on')
store.set('music-media-keys', 'off')
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
  const row = (name) =>
    page.getByRole('complementary', { name: '曲库分类' }).getByRole('button', { name, exact: true })
  const order = () => page.locator('.library-sidebar [draggable=true]').allTextContents()
  const drag = async (from, to, after) => {
    const a = await row(from).boundingBox(),
      b = await row(to).boundingBox()
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height * (after ? 0.8 : 0.2), { steps: 12 })
    await page.mouse.move(b.x + b.width / 2 + 1, b.y + b.height * (after ? 0.8 : 0.2))
    await expect(row(to)).toHaveAttribute('data-insert', after ? 'after' : 'before')
    await page.mouse.up()
  }
  await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].setContentSize(1040, 800))
  await expect(row('A')).toBeVisible()
  await drag('C', 'A', false)
  await expect.poll(order).toEqual(['C', 'A', 'B', '歌单A', '歌单B', '歌单C'])
  await drag('歌单A', '歌单C', true)
  const final = ['C', 'A', 'B', '歌单B', '歌单C', '歌单A']
  await expect.poll(order).toEqual(final)
  await row('B').dragTo(row('歌单A'))
  assert.deepEqual(await order(), final)
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  await expect.poll(order).toEqual(final)
  console.log('PASS 两组上下插入指示、实际拖放、跨组拒绝和冷启动恢复', root)
} finally {
  await app.close()
}
