import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { writeFixtureRecording } from './music-recording-fixture.mjs'

const root = await fs.mkdtemp(path.resolve('tmp/music-scope-search-'))
const profile = path.join(root, 'profile')
const store = new MusicStore(path.join(profile, 'fitbay-music'))
store.set('music-guide-v1', 1)
store.set('music-media-keys', 'off')
const titles = ['夜路轻步', '七里香 Love', '正午重鼓']
for (const [i, title] of titles.entries()) {
  const file = path.join(root, title + '.wav')
  await writeFixtureRecording(file, i + 1, 10)
  store.library.upsert({
    file,
    title,
    artist: ['张佳玲', '周杰伦', '测试乐队'][i],
    album: i === 2 ? '午后专辑' : '散步专辑',
    duration: 10,
    size: (await fs.stat(file)).size,
  })
}
store.library.upsert({
  file: path.join(root, '离线.wav'),
  title: '离线轻拍',
  artist: '已离线',
  album: '离线专辑',
  duration: 9,
})
store.db.prepare('UPDATE local_tracks SET available=0,favorite=1 WHERE title=?').run('离线轻拍')
const tracks = store.library.list()
store.library.createPlaylist(
  '夜行歌单',
  tracks.filter((t) => t.title !== titles[1]).map((t) => t.id),
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
  await app.evaluate(({ app, BaseWindow }) => {
    if (
      !app.commandLine.hasSwitch('mute-audio') ||
      BaseWindow.getAllWindows().some((w) => w.isFocusable())
    )
      throw Error('需要私有静音桌面')
    BaseWindow.getAllWindows()
      .find((w) => w.getTitle() === 'Music')
      .setContentSize(980, 720)
    globalThis.scopeSearchCalls = []
    globalThis.fetch = async (_url, options) => {
      const payload = JSON.parse(JSON.parse(options.body).messages.at(-1).content)
      globalThis.scopeSearchCalls.push(payload)
      const matches = payload.tracks.filter((t) => t.title !== '正午重鼓').map((t) => t.index)
      return Response.json({
        choices: [
          { message: { content: JSON.stringify({ matches: [...matches, 999, -1, ...matches] }) } },
        ],
      })
    }
  })
  await page.evaluate(() => window.music.configureModel('deepseek', 'fixture', 'fixture', false))
  const press = async (element, key = 'Enter') => {
    await element.focus()
    await element.press(key)
  }
  const calls = () => app.evaluate(() => globalThis.scopeSearchCalls)
  const input = page.getByRole('searchbox', { name: '搜索本地歌曲' })
  const toggle = page.getByRole('button', { name: 'AI 搜索', exact: true })
  const rows = page.locator('li.library-row')
  const query = '适合夜里散步、鼓点轻一点'
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await input.fill('散步专辑')
  await expect(rows).toHaveCount(2)
  await input.press('Enter')
  for (const [term, count] of [
    ['测试乐队', 1],
    ['qilixiang', 1],
    ['qlx', 1],
    ['qlxlove', 1],
    ['zhoujielun', 1],
    ['zjl', 2],
  ]) {
    await input.fill(term)
    await expect(rows).toHaveCount(count)
    if (term !== '测试乐队') await expect(rows.filter({ hasText: titles[1] })).toHaveCount(1)
  }
  assert.equal((await calls()).length, 0)
  for (const mode of ['library', 'playlist']) {
    if (mode === 'playlist') {
      await press(page.getByRole('tab', { name: '歌单', exact: true }))
      await press(page.getByRole('button', { name: '夜行歌单', exact: true }))
      await expect(toggle).toHaveAttribute('aria-pressed', 'false')
      await input.fill('qlx')
      await expect(rows).toHaveCount(0)
      await input.fill('zjl')
      await expect(rows).toHaveCount(1)
      await expect(rows.first()).toContainText(titles[0])
      assert.equal((await calls()).length, 1)
    }
    await press(toggle)
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    const previous = (await calls()).length
    await input.fill(query)
    assert.equal((await calls()).length, previous)
    await expect(page.getByRole('button', { name: '提交 AI 搜索' })).toBeEnabled()
    await input.press('Enter')
    await expect(page.getByRole('status').filter({ hasText: 'AI 找到' })).toHaveText(
      'AI 找到 ' + (mode === 'library' ? 2 : 1) + ' 首',
    )
    const payload = (await calls()).at(-1)
    assert.equal(payload.query, query)
    assert.deepEqual(
      payload.tracks.map((t) => t.title).sort(),
      (mode === 'library' ? titles : [titles[0], titles[2]]).toSorted(),
    )
    assert.ok(
      payload.tracks.every((t) => Object.keys(t).sort().join() === 'album,artist,index,title'),
    )
    await expect(rows).toHaveCount(mode === 'library' ? 2 : 1)
    await expect(rows.filter({ hasText: '正午重鼓' })).toHaveCount(0)
    const title = mode === 'library' ? titles[1] : titles[0]
    await press(page.getByRole('button', { name: '播放' + title, exact: true }))
    await expect
      .poll(() => page.locator('audio').evaluate((a) => !a.paused && a.currentTime > 0))
      .toBe(true)
    const state = await page.evaluate(() => window.music.state())
    assert.equal(state.current, tracks.find((t) => t.title === title).id)
    assert.deepEqual(
      [...state.queue].sort(),
      tracks
        .filter(
          (t) =>
            t.available && (mode === 'library' ? t.title !== '正午重鼓' : t.title === '夜路轻步'),
        )
        .map((t) => t.id)
        .sort(),
    )
    await page.screenshot({
      path: path.join(root, mode + '.png'),
      style: ':root {background:var(--base)!important}',
      animations: 'disabled',
    })
  }
  assert.equal((await calls()).length, 2)
  await fs.writeFile(path.join(root, 'calls.json'), JSON.stringify(await calls(), null, 2))
  console.log('PASS scoped AI search, ordinary search, playback and queues', root)
} finally {
  await app.close()
}
