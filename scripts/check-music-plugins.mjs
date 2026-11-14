import { checkDefaultCatalog } from './public-music-plugin-fixture.mjs'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'

await mkdir('tmp', { recursive: true })
const root = await mkdtemp(path.resolve('tmp/music-guide-'))
const profile = path.join(root, 'profile')
const store = new MusicStore(path.join(profile, 'fitbay-music'))
const digest = 'a'.repeat(64)
store.set('music-plugin-install-rules', digest)
store.db.close()
const previous = path.join(profile, 'fitbay-music/plugins', 'rules-' + digest)
await mkdir(previous, { recursive: true })
const oldFile = path.join(previous, 'panel.js')
await writeFile(oldFile, 'window.legacyPluginStarted = true')
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
    await app.evaluate(({ app, BrowserWindow, screen }) => {
      const left = Math.min(...screen.getAllDisplays().map((d) => d.bounds.x))
      return (
        app.commandLine.hasSwitch('mute-audio') &&
        BrowserWindow.getAllWindows().every(
          (w) => !w.isFocusable() && w.getBounds().x + w.getBounds().width <= left,
        )
      )
    }),
  )
  const guide = () => page.getByRole('complementary', { name: 'Music 使用引导' })
  const help = page.getByRole('button', { name: '使用引导', exact: true })
  const steps = [
    'import',
    'library',
    'playlists',
    'sources',
    'online',
    'ai-toggle',
    'model',
    'recommend',
    'weight',
    'tasks',
    'artist',
    'playback',
    'plugins',
    'mcp',
  ]
  const next = () => guide().getByRole('button', { name: '下一步' }).click()
  await expect(guide()).toBeVisible()
  await expect(help).toBeVisible()
  await page.evaluate(() => delete document.documentElement.dataset.backdrop)
  async function checkStep(id, size) {
    const target = page.locator('[data-guide-active="true"]')
    await expect(target).toHaveAttribute('data-guide-anchor', id)
    await expect(target).toBeInViewport({ ratio: 0.99 })
    await expect(guide()).toBeInViewport({ ratio: 0.99 })
    await expect
      .poll(async () => {
        const a = await target.boundingBox()
        const b = await guide().boundingBox()
        return (
          !!a &&
          !!b &&
          (a.y + a.height <= b.y ||
            b.y + b.height <= a.y ||
            a.x + a.width <= b.x ||
            b.x + b.width <= a.x)
        )
      })
      .toBe(true)
    if (id === 'recommend')
      await expect(page.getByRole('tab', { name: '找歌' })).toHaveAttribute('aria-selected', 'true')
    else if (['sources', 'model', 'mcp', 'plugins', 'import'].includes(id))
      await expect(page.locator('.music-settings')).toBeVisible()
    if (id === 'mcp') {
      await expect(page.locator('.music-settings h2')).toHaveText('外部 Agent 连接（可选）')
      await expect(target).toBeVisible()
      const command = page.locator('.music-mcp-connection code')
      await expect(command).toContainText('music-source-mcp.mjs')
      await expect(page.locator('.music-mcp-connection')).toContainText('从最近播放找出上一首')
      await expect(page.locator('.music-mcp-connection')).toContainText('包括在线引用')
      await expect(target).toBeInViewport({ ratio: 0.99 })
    }
    await page.screenshot({
      animations: 'disabled',
      path: path.join(root, 'guide-' + size + '-' + id + '.png'),
    })
  }

  for (const [i, id] of steps.entries()) {
    if (i) await next()
    await checkStep(id, 'regular')
  }
  await guide().getByRole('button', { name: '完成' }).click()
  for (const name of ['曲库', '歌单', '找歌', '歌手']) {
    const tab = page.getByRole('tab', { name, exact: true })
    await tab.click()
    await expect(page.getByRole('tab', { name: '扩展', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '插件', exact: true })).toHaveCount(0)
    const controls = page.locator('.music-view-actions button')
    assert.deepEqual(
      await controls.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label'))),
      ['下载任务', '使用引导', '更多音乐操作', '只显示播放栏', '隐藏到后台'],
    )
    await help.hover()
    await expect(page.getByRole('tooltip')).toContainText('使用引导')
    await page.screenshot({
      path: path.join(root, 'help-' + name + '.png'),
      animations: 'disabled',
    })
    await help.click()
    await expect(guide()).toContainText('把音乐加入曲库')
    await guide().getByRole('button', { name: '跳过' }).click()
    await expect(tab).toHaveAttribute('aria-selected', 'true')
  }
  await app.evaluate(({ BaseWindow }) => {
    const w = BaseWindow.getAllWindows()[0]
    w.setMinimumSize(360, 320)
    w.setContentSize(420, 480)
  })
  await page.getByRole('button', { name: '更多音乐操作' }).click()
  await page.getByRole('menuitem', { name: '使用引导' }).click()
  for (const [i, id] of steps.entries()) {
    if (i) await next()
    await checkStep(id, 'small')
  }
  await guide().getByRole('button', { name: '完成' }).click()
  const catalog = await checkDefaultCatalog(page)
  assert.equal(catalog.find((p) => p.id === 'rules').outdated, true)
  assert.equal(await page.evaluate(() => window.legacyPluginStarted), undefined)
  assert.equal(
    await app.evaluate(({ webContents }, url) => {
      const music = webContents.getAllWebContents().find((w) => w.getURL() === url)
      return music.session.protocol.isProtocolHandled('fitbay-plugin')
    }, page.url()),
    true,
  )
  assert.equal(await readFile(oldFile, 'utf8'), 'window.legacyPluginStarted = true')
  console.log('PASS 四页顶栏、十四步引导、窄窗、旧插件不加载且原文件保留', root)
} finally {
  await app.close()
}
