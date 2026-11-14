import assert from 'node:assert/strict'
import { copyFile, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'

const root = await mkdtemp(path.resolve('tmp/discovery-layout-'))
const profile = path.join(root, 'profile')
const store = new MusicStore(path.join(profile, 'fitbay-music'))
store.set('music-guide-v1', 1)
const artistId = '10000000-0000-0000-0000-000000000001'
store.set('followed-musicbrainz-artists', JSON.stringify([{ id: artistId, name: '青禾' }]))
store.set('music-search-history', JSON.stringify(['Given', '春天的歌', 'Aimer']))
const titles = ['晨风', '河岸', '青鸟', '远山', '归途']
const batch = store.saveSuggestions(
  '晨间通勤',
  titles.map((title) => ({
    title,
    artist: '青禾',
    reason: '轻快的节奏，适合晨间通勤。',
  })),
  '待处理',
  undefined,
  5,
)
for (const title of titles) {
  const file = path.join(root, title + '.mp3')
  await copyFile('tests/fixtures/local-music/tone.mp3', file)
  store.library.upsert({ file, title, artist: '青禾', album: '晨间', duration: 2 })
  const { id } = store.db.prepare('SELECT id FROM items WHERE title=?').get(title)
  const { id: local } = store.db.prepare('SELECT id FROM local_tracks WHERE file=?').get(file)
  store.db.prepare('UPDATE recommended_items SET local=? WHERE item=?').run(local, id)
  store.status(id, '已入库')
}
store.db
  .prepare(
    "UPDATE recommendation_runs SET state='completed',message='已达到目标首数' WHERE batch=?",
  )
  .run(batch)
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
  await app.evaluate(() => {
    globalThis.fetch = async (input) => {
      const url = new URL(input)
      if (url.pathname.includes('/artist/'))
        return Response.json({
          relations: [
            {
              type: 'collaboration',
              artist: { id: '20000000-0000-0000-0000-000000000002', name: '山雀' },
            },
          ],
        })
      if (url.pathname.endsWith('/release-group')) return Response.json({ 'release-groups': [] })
      return new Response(null, { status: 404 })
    }
  })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
  })
  const box = async (selector) => {
    const loc = page.locator(selector).first()
    await expect(loc).toBeVisible()
    return loc.boundingBox()
  }
  for (const width of [1260, 420]) {
    await app.evaluate(({ BaseWindow }, width) => {
      const w = BaseWindow.getAllWindows().find((w) => w.getTitle() === 'Music')
      w.setMinimumSize(360, 320)
      w.setContentSize(width, 740)
    }, width)
    for (const [name, selector] of [
      ['在线找歌', '.download-search'],
      ['智能推荐', '.music-compose'],
      ['歌手', '.followed-artists'],
    ]) {
      await page.getByRole('tab', { name, exact: true }).click()
      const frame = await box(selector)
      if (width > 740) {
        const anchor = await box('.music-navigation [role=tab]')
        assert.ok(Math.abs(frame.x - anchor.x) < 24, name + ' 正文与导航起点错位')
      }
      if (name === '在线找歌') {
        const platforms = page.getByRole('tablist', { name: '搜索平台' })
        for (const platform of ['酷狗音乐', 'QQ 音乐', '网易云音乐']) {
          await platforms.getByRole('tab', { name: platform }).click()
          const states = await platforms.getByRole('tab').evaluateAll((tabs) =>
            tabs.map((tab) => {
              const style = getComputedStyle(tab)
              return {
                selected: tab.getAttribute('aria-selected') === 'true',
                background: style.backgroundColor,
                border: style.borderTopColor,
                width: style.borderTopWidth,
                underline: getComputedStyle(tab, '::after').content,
              }
            }),
          )
          assert.equal(states.filter((tab) => tab.selected).length, 1)
          for (const tab of states) {
            assert.equal(tab.background, 'rgba(0, 0, 0, 0)')
            assert.equal(tab.underline, 'none')
            assert.ok(parseFloat(tab.width) > 0 && parseFloat(tab.width) <= 1)
            assert.equal(tab.border === 'rgba(0, 0, 0, 0)', !tab.selected)
          }
        }
        const recent = await box('.search-history')
        assert.ok(
          width > 740 ? recent.x >= frame.x + frame.width : recent.y >= frame.y + frame.height,
        )
      }
      if (name === '智能推荐') {
        await expect(page.locator('.music-list .daily-row-state')).toHaveCount(5)
        const cover = await box('.music-list .album-art'),
          title = await box('.music-list li strong'),
          status = await box('.daily-row-state')
        assert.ok(cover.x < title.x && title.x < status.x)
        if (width > 740) {
          const head = await box('.music-section-head h2'),
            start = await box('.music-play-batch')
          assert.ok(Math.abs(head.y - start.y) < 20)
        }
      }
      if (name === '歌手') {
        await expect(page.locator('.similar-artists')).toContainText('山雀')
        await expect(page.getByText('近 90 天暂无新发行。')).toBeVisible()
        const news = await box('.release-news-column')
        assert.ok(width > 740 ? news.x >= frame.x + frame.width : news.y >= frame.y + frame.height)
      }
      assert.ok(
        await page
          .locator('main.music-scroll')
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      )
      await page.screenshot({
        path: path.join(root, width + '-' + name + '.png'),
        animations: 'disabled',
      })
    }
  }
  console.log('PASS 三个实际页面的宽窄布局、封面播放和正文对齐', root)
} finally {
  await app.close()
}
