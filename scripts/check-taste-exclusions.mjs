import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { openMusicSettings, selectMusicSettings } from './music-settings-fixture.mjs'

await fs.mkdir('tmp', { recursive: true })
const root = await fs.mkdtemp(path.resolve('tmp/taste-exclusions-'))
const profile = path.join(root, 'profile')
const library = path.join(profile, 'fitbay-music')
const store = new MusicStore(library)
store.set('music-guide-v1', 1)
store.set('music-media-keys', 'off')
for (const [folder, title] of [
  ['剪辑素材', '片头配乐'],
  ['个人曲库', '广告配乐'],
  ['个人曲库', '夜间爵士'],
]) {
  const dir = path.join(root, folder)
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, title + '.mp3')
  await fs.copyFile('tests/fixtures/local-music/tone.mp3', file)
  store.library.upsert({ file, title, artist: '测试艺人', album: '测试专辑', duration: 4 })
}
const tracks = store.library.list()
store.library.createPlaylist(
  '工程备用',
  tracks.filter((t) => t.title === '广告配乐').map((t) => t.id),
)
store.db.close()
const app = await electron.launch({
  args: [
    path.resolve('dist/component-prototype/host'),
    '--mode=music',
    '--mute-audio',
    '--user-data-dir=' + profile,
    '--workbench=' + path.resolve('out/renderer/index.html'),
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  const page = await app.firstWindow()
  await app.evaluate(({ app, BaseWindow }) => {
    BaseWindow.getAllWindows()
      .find((w) => w.getTitle() === 'Music')
      .setContentSize(1100, 760)
    if (
      !app.commandLine.hasSwitch('mute-audio') ||
      BaseWindow.getAllWindows().some((w) => w.isFocusable())
    )
      throw Error('测试窗口需要后台静音')
    globalThis.requests = []
    globalThis.fetch = async (_url, req) => {
      const data = JSON.parse(JSON.parse(req.body).messages.at(-1).content)
      globalThis.requests.push(data)
      const profile = [data.previous, ...data.changes.map((r) => r.title + ' ' + r.signal)]
        .filter(Boolean)
        .join('；')
      return Response.json({ choices: [{ message: { content: JSON.stringify({ profile }) } }] })
    }
  })
  await page.evaluate(async () => {
    await window.music.configureModel('deepseek', 'fixture', 'fixture', false)
    await window.music.setTasteConsent(true)
  })
  const summary = async () =>
    JSON.parse(await fs.readFile(path.join(library, 'music-taste.json'), 'utf8').catch(() => '{}'))
      .text
  await expect.poll(summary).toContain('广告配乐 主动加入自建歌单')
  const screenshot = async (name) =>
    page.screenshot({
      path: path.join(root, name + '.png'),
      animations: 'disabled',
      style: ':root { background:var(--base)!important }',
    })
  const tab = async (name) => page.getByRole('tab', { name, exact: true }).click()
  await tab('曲库')
  await screenshot('00-library')
  await page.getByRole('button', { name: '剪辑素材', exact: true }).click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: '不参与智能推荐' })).toBeVisible()
  await screenshot('01-folder-menu')
  await page.getByRole('menuitem', { name: '不参与智能推荐' }).click()
  await expect.poll(summary).not.toContain('片头配乐')
  await tab('歌单')
  await page.getByRole('button', { name: '工程备用', exact: true }).click({ button: 'right' })
  await screenshot('02-playlist-menu')
  await page.getByRole('menuitem', { name: '不参与智能推荐' }).click()
  await expect.poll(summary).toBe('夜间爵士 曲库新增')
  const rebuilt = await app.evaluate(() => globalThis.requests.at(-1))
  assert.equal(rebuilt.previous, '')
  assert.deepEqual(
    rebuilt.changes.map((row) => row.title),
    ['夜间爵士'],
  )
  await tab('曲库')
  await page.getByRole('button', { name: '剪辑素材', exact: true }).click()
  await page.getByRole('button', { name: '管理歌单片头配乐' }).click()
  await page.getByRole('checkbox', { name: '我的收藏' }).check()
  await expect.poll(summary).toContain('片头配乐 主动收藏')
  assert.ok(!(await summary()).includes('片头配乐 曲库新增'))
  await page.keyboard.press('Escape')
  await openMusicSettings(page)
  await selectMusicSettings(page, '模型与推荐')
  await expect(page.getByRole('button', { name: '恢复参与智能推荐：剪辑素材' })).toBeVisible()
  await screenshot('03-settings')
  await page.getByRole('button', { name: '恢复参与智能推荐：工程备用' }).click()
  await expect.poll(summary).toContain('广告配乐 主动加入自建歌单')
  assert.ok(!(await summary()).includes('片头配乐 曲库新增'))
  await page.getByRole('button', { name: '恢复参与智能推荐：剪辑素材' }).click()
  await expect.poll(summary).toContain('片头配乐 曲库新增')
  const requests = await app.evaluate(() => globalThis.requests)
  assert.ok(!JSON.stringify(requests).includes('工程备用'))
  await fs.writeFile(path.join(root, 'requests.json'), JSON.stringify(requests, null, 2))
  console.log(
    'PASS folder/playlist exclusion, rebuilt summary, explicit favorite, settings restoration',
    root,
  )
} finally {
  await app.close()
}
