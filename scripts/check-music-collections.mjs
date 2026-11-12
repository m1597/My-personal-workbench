import { mkdir, mkdtemp, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { _electron as electron, expect } from '@playwright/test'
import { recording } from '../components/music/offline-source.mjs'
import { dragMusicIn } from './music-drag-fixture.mjs'

const evidence = await mkdtemp(path.resolve('tmp/music-collections-'))
const root = path.join(evidence, '我的音乐')
const wave = recording('fitbay-tone-1')
const titles = ['晨间', '海边', '雨夜']
const directories = ['录音/春天', '录音/夏天', '现场']
for (const [i, title] of titles.entries()) {
  const dir = path.join(root, directories[i])
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, title + '.wav'), wave)
}
const launch = () =>
  electron.launch({
    args: [
      path.resolve('dist/component-prototype/host'),
      '--mode=music',
      '--workbench=' + path.resolve('out/renderer/index.html'),
      '--user-data-dir=' + path.join(evidence, 'profile'),
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
let app = await launch()
try {
  let page = await app.firstWindow()
  const resize = (width) =>
    app.evaluate(
      ({ BaseWindow }, width) =>
        BaseWindow.getAllWindows()
          .find((w) => w.getTitle() === 'Music')
          .setContentSize(width, 600),
      width,
    )
  await resize(1040)
  await app.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] })
  }, root)
  await page.getByRole('button', { name: '添加文件夹' }).click()
  await expect(page.locator('.library-row')).toHaveCount(3)
  const button = (name) => page.getByRole('button', { name, exact: true })
  await button('展开我的音乐').click()
  await button('展开录音').click()
  await button('春天').click()
  await expect(page.locator('.library-name strong')).toHaveText(['晨间'])
  for (const name of ['通勤', '收藏']) {
    await button('新建歌单').click()
    await page.getByLabel('歌单名称').fill(name)
    await button('创建').click()
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  }
  await button('全部歌曲').click()
  for (const [song, lists] of [
    ['晨间', ['通勤', '收藏']],
    ['雨夜', ['通勤']],
  ]) {
    await button('管理歌单' + song).click()
    for (const list of lists) await page.getByLabel(list, { exact: true }).check()
    await page.keyboard.press('Escape')
  }
  await button('通勤').click()
  await expect(page.locator('.library-name strong')).toHaveText(['晨间', '雨夜'])
  await button('播放晨间').click()
  await expect
    .poll(() => page.evaluate(async () => (await window.music.state()).queue.length))
    .toBe(2)
  await page.evaluate(() => {
    delete document.documentElement.dataset.backdrop
  })
  await page.screenshot({ path: path.join(evidence, 'standalone.png') })
  await resize(400)
  await expect(button('曲库导航')).toBeVisible()
  await expect(page.locator('.library-sidebar')).not.toBeVisible()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: path.join(evidence, 'narrow.png') })
  await dragMusicIn(app)
  const shell = app.windows().find((p) => p.url().includes('/renderer/index.html'))
  await expect(page.locator('[data-surface="embedded"]')).toBeVisible()
  await expect(page.getByRole('heading', { name: '通勤' })).toBeVisible()
  const tab = shell.locator('[data-tab-panel-id="component-music"] .dv-default-tab-content')
  await expect(tab).toHaveCount(1)
  assert.equal(await tab.evaluate((el) => getComputedStyle(el, '::before').width), '16px')
  await shell.evaluate(() => {
    delete document.documentElement.dataset.backdrop
  })
  async function captureDock(prefix) {
    await page.screenshot({
      path: path.join(evidence, prefix + '-content.png'),
      omitBackground: true,
    })
    await shell.screenshot({ path: path.join(evidence, prefix + '-shell.png') })
    const bounds = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].contentView.children.at(-1).getBounds(),
    )
    await writeFile(path.join(evidence, prefix + '-bounds.json'), JSON.stringify(bounds))
  }
  await captureDock('docked')
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.setMinimumSize(380, 480)
    w.setContentSize(440, 620)
  })
  await expect(button('曲库导航')).toBeVisible()
  await expect(page.locator('.music-player')).toBeInViewport()
  await captureDock('narrow-dock')
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  await button('曲库导航').click()
  await button('收藏').click()
  await expect(page.locator('.library-name strong')).toHaveText(['晨间'])
  await resize(1040)
  await button('展开我的音乐').click()
  await button('现场').click()
  await button('从曲库移除雨夜').click()
  await expect(page.getByRole('heading', { name: '全部歌曲', exact: true })).toBeVisible()
  await expect(page.locator('.library-row')).toHaveCount(2)
  for (const [i, title] of titles.entries())
    assert.equal((await stat(path.join(root, directories[i], title + '.wav'))).size, wave.length)
  console.log('PASS 文件夹层级、跨目录和多歌单、队列、重启与原件。截图 ' + evidence)
} finally {
  await app.close()
}
