import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { recording } from '../components/music/offline-source.mjs'
const root = await mkdtemp(path.resolve('tmp/wrapped-lyrics-'))
const profile = path.join(root, 'profile')
const folder = path.join(root, 'music')
await mkdir(folder)
const store = new MusicStore(path.join(profile, 'fitbay-music'))
store.set('music-guide-v1', '1')
store.set('music-muted', 'on')
const file = path.join(folder, '折行.wav')
await writeFile(file, recording('fitbay-tone-1'))
store.library.upsert({ file, title: '折行', artist: '测试', album: '', duration: 20 })
const lyrics = [
  '決めつけばかり 自惚れを着た チープなhokoriで 音荒げても',
  '棚に隠した 哀れな 恥に濡れた鏡の中',
  '都会の傷だけひけらかして 手軽な強さで勝取る術を',
  'どれだけ磨いでも気はやつれる ふらついた思想通りだ',
]
await writeFile(
  path.join(folder, '折行.lrc'),
  lyrics.map((s, i) => `[00:0${i * 2}]${s}`).join('\n'),
)
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
  await page.waitForSelector('.library-name')
  await app.evaluate(({ BaseWindow }) =>
    BaseWindow.getAllWindows()
      .find((w) => w.getTitle() === 'Music')
      .setContentSize(510, 540),
  )
  await page.getByRole('button', { name: '播放折行', exact: true }).click()
  await page.getByRole('button', { name: '打开歌词页' }).click()
  const pane = page.getByRole('region', { name: '同步歌词' })
  await expect(pane.getByRole('button')).toHaveCount(4)
  const measure = () =>
    pane.evaluate((el) =>
      [...el.children].map((row) => {
        const range = document.createRange()
        range.selectNodeContents(row)
        const rects = [...range.getClientRects()].map((r) => [r.top, r.bottom])
        const cs = getComputedStyle(row)
        return { rects, height: row.clientHeight, font: cs.fontSize, line: cs.lineHeight }
      }),
    )
  const capture = (name) =>
    page.screenshot({
      path: path.join(root, name + '.png'),
      style: ':root { background:var(--base) !important }',
    })
  await capture('自动跟随')
  const bounds = await measure()
  console.log(
    '日文歌词各句实际行数',
    bounds.map((row) => row.rects.length),
    root,
  )
  assert.ok(bounds.filter((r) => r.rects.length > 1).length >= 3)
  for (const row of bounds)
    for (let i = 1; i < row.rects.length; i++)
      assert.ok(row.rects[i][0] >= row.rects[i - 1][1] - 1, '折行文字边界发生重叠')
  const box = await pane.boundingBox()
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: box.x + 20,
    y: box.y + 35,
    deltaY: 140,
    deltaX: 0,
  })
  await expect(page.getByRole('button', { name: '回到当前歌词' })).toBeVisible()
  await capture('手动阅读')
  await page.getByRole('button', { name: '回到当前歌词' }).click()
  await expect(pane.locator('[aria-current]')).toHaveText(lyrics[1], { timeout: 6000 })
  await expect(pane.locator('[aria-current]')).toHaveText(lyrics[2], { timeout: 6000 })
  await capture('换句')
  await app.evaluate(({ BaseWindow }) =>
    BaseWindow.getAllWindows()
      .find((window) => window.getTitle() === 'Music')
      .setContentSize(1160, 690),
  )
  await pane.evaluate((element) => {
    element.style.maxWidth = '325px'
  })
  const enlarged = await measure()
  assert.ok(enlarged.some((row) => row.rects.length >= 3))
  const glyphs = enlarged.flatMap((row) => row.rects)
  for (let i = 1; i < glyphs.length; i++)
    assert.ok(glyphs[i][0] >= glyphs[i - 1][1] - 1, '大字号日文折行或相邻歌词重叠')
  await capture('大字号折行')
} finally {
  await app.close()
}
