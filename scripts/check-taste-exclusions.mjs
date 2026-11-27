import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { openDiscovery } from './discovery-fixture.mjs'
import { offlineSourceRepository } from './music-source-fixture.mjs'

await fs.mkdir('tmp', { recursive: true })
const root = await fs.mkdtemp(path.resolve('tmp/recommendation-references-'))
const profile = path.join(root, 'profile')
const store = new MusicStore(path.join(profile, 'fitbay-music'))
const output = path.join(root, 'downloads')
await fs.mkdir(output)
store.set('music-guide-v1', 1)
store.set('music-media-keys', 'off')
store.set('music-global-keys', 'off')
store.set('music-recommend-dir', output)
const titles = ['素材录音', '单独收藏', '重叠录音', '目录独有', '旧歌单排除']
for (const [i, title] of titles.entries()) {
  const dir = path.join(root, i < 2 ? '剪辑素材' : '日常曲库')
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, title + '.mp3')
  await fs.copyFile('tests/fixtures/local-music/tone.mp3', file)
  store.library.upsert({ file, title, artist: '试验艺人', album: '试验专辑', duration: 4 })
}
const tracks = store.library.list()
const track = (title) => tracks.find((t) => t.title === title)
store.db.prepare('UPDATE local_tracks SET favorite=1 WHERE id=?').run(track('单独收藏').id)
store.library.createPlaylist('混合歌单', [track('素材录音').id, track('重叠录音').id])
const excludedPlaylist = store.library.createPlaylist('旧隐藏歌单', [track('旧歌单排除').id])
store.set(
  'taste-exclusions',
  JSON.stringify([
    { kind: 'folder', id: track('素材录音').folder.id, name: '剪辑素材' },
    { kind: 'playlist', id: excludedPlaylist, name: '旧隐藏歌单' },
  ]),
)
store.db.close()
const sourceFile = path.join(root, 'source.js')
await fs.writeFile(
  sourceFile,
  `// @name 范围验收源
lx.on('request',()=>[])
lx.send('inited',{sources:{wy:{actions:['search','musicUrl'],qualitys:['320k']}}})`,
)
const app = await electron.launch({
  executablePath: process.env.FITBAY_TEST_MUSIC_EXECUTABLE,
  args: [
    ...(process.env.FITBAY_TEST_MUSIC_EXECUTABLE
      ? []
      : [path.resolve('dist/component-prototype/host'), '--mode=music']),
    '--mute-audio',
    '--user-data-dir=' + profile,
    ...(process.env.FITBAY_TEST_MUSIC_EXECUTABLE
      ? []
      : ['--workbench=' + path.resolve('out/renderer/index.html')]),
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  const page = await app.firstWindow()
  await page.waitForSelector('.music-shell')
  await offlineSourceRepository(app)
  await app.evaluate(({ BaseWindow, dialog, app }, file) => {
    if (
      !app.commandLine.hasSwitch('mute-audio') ||
      BaseWindow.getAllWindows().some((w) => w.isFocusable())
    )
      throw Error('须后台静音')
    BaseWindow.getAllWindows()[0].setContentSize(1200, 840)
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    globalThis.testRecommendations = []
    globalThis.fetch = async (_url, init) => {
      const payload = JSON.parse(JSON.parse(init.body).messages.at(-1).content)
      if (Array.isArray(payload.changes)) {
        const profile = [payload.previous, ...new Set(payload.changes.map((c) => c.title))]
          .filter(Boolean)
          .join('；')
        return Response.json({ choices: [{ message: { content: JSON.stringify({ profile }) } }] })
      }
      globalThis.testRecommendations.push(payload)
      throw Error('已捕获推荐请求')
    }
  }, sourceFile)

  await page.evaluate(async () => {
    await window.music.lxImport()
    await window.music.configureModel('deepseek', 'fixture', 'fixture', false)
  })
  await page.getByRole('tab', { name: '曲库', exact: true }).click()
  await page.getByRole('button', { name: '剪辑素材', exact: true }).click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: '从曲库移除文件夹', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: /参与智能推荐/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await openDiscovery(page, true)
  const references = page.getByRole('group', { name: '本次参考', exact: true })
  const scope = page.getByLabel('本次参考范围', { exact: true })
  const checkbox = (name) => references.getByRole('checkbox', { name, exact: true })
  const submit = page.getByRole('button', { name: '生成推荐', exact: true })
  await expect(checkbox('剪辑素材')).not.toBeChecked()
  await expect(checkbox('混合歌单')).toBeChecked()
  await expect(checkbox('旧隐藏歌单')).not.toBeChecked()
  await expect(checkbox('我的收藏')).toBeChecked()
  await expect(scope).toContainText('3 首')
  const authorization = page.getByRole('button', { name: '前往模型设置', exact: true })
  await expect(authorization).toBeVisible()
  await authorization.click()
  const consent = page.getByRole('checkbox', { name: '允许使用曲库摘要生成推荐偏好' })
  await expect(consent).not.toBeChecked()
  await consent.check()
  await expect(consent).toBeChecked()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(scope).toContainText('3 首')
  await expect(authorization).toHaveCount(0)
  await expect(checkbox('剪辑素材')).not.toBeChecked()
  await page.getByLabel('想让 AI 推荐什么？（选填）').fill('雨天听的歌曲')
  const receipts = []
  async function verifyBatch(expected) {
    const before = await app.evaluate(() => globalThis.testRecommendations.length)
    await submit.click()
    await expect
      .poll(() => app.evaluate(() => globalThis.testRecommendations.length), { timeout: 15000 })
      .toBeGreaterThan(before)
    await expect(submit).toBeEnabled({ timeout: 15000 })
    const request = await app.evaluate(() => globalThis.testRecommendations.at(-1))
    const summary = request.profile || ''
    for (const title of titles)
      assert.equal(summary.includes(title), expected.includes(title), '参考曲目 ' + title)
    assert(!JSON.stringify(request).includes(root))
    assert(!JSON.stringify(request).includes('混合歌单'))
    receipts.push({ expected, summary })
  }
  await verifyBatch(['单独收藏', '重叠录音', '目录独有'])
  await checkbox('日常曲库').uncheck()
  await expect(scope).toContainText('3 首')
  await verifyBatch(['单独收藏', '重叠录音', '素材录音'])
  await page.getByRole('tab', { name: '公开歌单', exact: true }).click()
  await expect(scope).toContainText('3 首')
  await expect(checkbox('日常曲库')).not.toBeChecked()
  await checkbox('我的收藏').uncheck()
  await expect(scope).toContainText('2 首')
  const catalogInput = page.getByRole('textbox', { name: '描述想听的公开歌单' })
  await catalogInput.fill('本次参考的风格')
  const beforeCatalog = await app.evaluate(() => globalThis.testRecommendations.length)
  await catalogInput.press('Enter')
  await expect
    .poll(() => app.evaluate(() => globalThis.testRecommendations.length))
    .toBeGreaterThan(beforeCatalog)
  const catalogRequest = await app.evaluate(() => globalThis.testRecommendations.at(-1))
  assert.equal(catalogRequest.kind, 'publicLists')
  for (const title of titles)
    assert.equal(
      (catalogRequest.profile || '').includes(title),
      ['素材录音', '重叠录音'].includes(title),
    )
  receipts.push({
    kind: catalogRequest.kind,
    expected: ['素材录音', '重叠录音'],
    summary: catalogRequest.profile,
  })
  await page.getByRole('tab', { name: '歌曲', exact: true }).click()
  await expect(checkbox('我的收藏')).not.toBeChecked()
  await expect(scope).toContainText('2 首')
  await checkbox('我的收藏').check()
  await expect(scope).toContainText('3 首')
  await checkbox('日常曲库').check()
  await expect(scope).toContainText('5 首')
  await page.screenshot({
    path: path.join(root, 'reference-selection.png'),
    scale: 'css',
    style: ':root { background: var(--base) !important }',
  })
  await verifyBatch(titles)
  await references.getByRole('button', { name: '清空参考' }).click()
  await expect(scope).toContainText('0 首')
  await verifyBatch([])
  await fs.writeFile(path.join(root, 'requests.json'), JSON.stringify(receipts, null, 2))
  console.log(
    'PASS 授权设置返回、歌曲与公开歌单共享参考/回车、旧选择迁移、跨范围去重、空集与实际请求',
    root,
  )
} finally {
  await app.close()
}
