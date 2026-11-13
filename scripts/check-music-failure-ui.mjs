import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { describeFailure } from '../examples/component-host/music-download-diagnosis.mjs'

await mkdir('tmp', { recursive: true })
const root = await mkdtemp(path.resolve('tmp/music-failure-ui-'))
const profile = path.join(root, 'profile')
const fixtures = path.join(profile, 'fitbay-music')
const store = new MusicStore(fixtures)
store.set('music-guide-v1', 1)
const failures = [
  ['夜航', 'unknown', 'wy', '匹配录音：未声明永久保存许可'],
  ['晨光', 'network', 'tx', '平台目录返回业务码 2001'],
  ['归途', 'storage', '', 'ENOSPC'],
  ['旧版记录', 'preview', 'kg', '匹配录音：只提供试听片段'],
]
const suggestion = (title) => ({ title, artist: '测试艺人', reason: '测试用推荐' })
const batch = store.saveSuggestions(
  '旧版今日推荐',
  failures.map(([title]) => suggestion(title)),
  '待处理',
)
for (const [title, kind, platform, message] of failures) {
  const { id } = store.db
    .prepare('SELECT id FROM items WHERE batch=? AND title=?')
    .get(batch, title)
  const { summary, detail } = describeFailure([
    { platform, source: '测试源', kinds: [kind], message },
  ])
  store.db
    .prepare('UPDATE recommended_items SET error=?,summary=?,diagnosis=? WHERE item=?')
    .run(detail, title === '旧版记录' ? '' : summary, kind, id)
  store.status(id, '待重试')
}
store.db.close()

async function verify(check) {
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
    expect(
      await app.evaluate(({ app, BrowserWindow, screen }) => {
        const left = Math.min(...screen.getAllDisplays().map((d) => d.bounds.x))
        return (
          app.commandLine.hasSwitch('mute-audio') &&
          BrowserWindow.getAllWindows().every((w) => {
            const { x, width } = w.getBounds()
            return x + width <= left && !w.isFocusable()
          })
        )
      }),
    ).toBe(true)
    await page.getByRole('tab', { name: 'AI 推荐' }).click()
    await check(page, page.locator('.music-list'))
  } finally {
    await app.close()
  }
}
await verify(async (page, list) => {
  await expect(list.locator('li')).toHaveCount(0)
  await expect(list.getByText('本次尚无新歌入库')).toBeVisible()
  const details = list.locator('details')
  await expect(details.getByText('查看详情')).toBeVisible()
  await expect(details.locator('p')).toBeHidden()
  await details.locator('summary').click()
  for (const [title, , , message] of failures) {
    await expect(details.locator('p')).toContainText(title)
    await expect(details.locator('p')).toContainText(message)
  }
  await expect(details.locator('p')).toContainText('当前来源仅提供试听')
  await expect(details.locator('p')).toContainText('暂时无法获取QQ 音乐的结果')
  await expect(list.getByRole('button', { name: '重试', exact: true })).toHaveCount(0)
  await page.evaluate(() => {
    delete document.documentElement.dataset.backdrop
  })
  await page.screenshot({ path: path.join(root, '旧推荐诊断.png'), animations: 'disabled' })
})

const mixed = new MusicStore(fixtures)
mixed.saveSuggestions('旧版今日推荐', [suggestion('已保存')], '待处理', batch)
const file = path.resolve('tests/fixtures/local-music/tone.mp3')
mixed.library.upsert({ file, title: '已保存', artist: '测试艺人', album: '', duration: 1 })
const { id } = mixed.db.prepare('SELECT id FROM items WHERE title=?').get('已保存')
const { id: local } = mixed.db.prepare('SELECT id FROM local_tracks WHERE file=?').get(file)
mixed.db.prepare('UPDATE recommended_items SET local=? WHERE item=?').run(local, id)
mixed.status(id, '已入库')
mixed.db.close()
await verify(async (_, list) => {
  await expect(list.locator('li strong')).toHaveText(['已保存'])
  await expect(list.getByRole('button', { name: '播放本次推荐' })).toBeEnabled()
  await expect(list.locator('details summary')).toHaveText('查看详情')
})

const offline = new MusicStore(fixtures)
offline.saveSuggestions('旧版离线推荐', [suggestion('离线候选')], '待匹配')
offline.db.close()
await verify(async (_, list) => {
  await expect(list.locator('li strong')).toHaveText(['离线候选'])
  await expect(list.getByRole('button', { name: '匹配目录' })).toBeVisible()
  await expect(list.locator('details')).toHaveCount(0)
})
console.log('PASS 旧版在线推荐的失败汇总、可播放行及离线曲单兼容', root)
