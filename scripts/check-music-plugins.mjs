import { choosePluginFile, pluginFile } from './music-plugin-file-fixture.mjs'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, mkdtemp, writeFile, access } from 'node:fs/promises'
import { musicPlugins } from '../dist/component-prototype/host/music-plugins.mjs'
import { _electron as electron, expect } from '@playwright/test'
import { selectMusicSettings } from './music-settings-fixture.mjs'

const root = await mkdtemp(path.resolve('tmp/music-plugins-'))
// Exercise an older installed version without changing the shipped catalog.
const upgradeProfile = path.join(root, 'upgrade')
const oldDigest = 'a'.repeat(64)
const oldFolder = path.join(upgradeProfile, 'fitbay-music', 'plugins', 'rules-' + oldDigest)
await mkdir(oldFolder, { recursive: true })
const registrations = new Map([['music-plugin-install-rules', oldDigest]])
let chosen = path.join(root, 'bad')
const manager = musicPlugins(upgradeProfile, () => registrations, {
  showOpenDialog: async () => ({ canceled: false, filePaths: [chosen] }),
})
await writeFile(path.join(root, 'bad'), 'bad')
assert.ok(manager.list().find((p) => p.id === 'rules').outdated)
await assert.rejects(manager.install('rules'), /大小/)
await access(oldFolder)
assert.equal(registrations.get('music-plugin-install-rules'), oldDigest)
chosen = pluginFile('rules')
await manager.install('rules')
await assert.rejects(access(oldFolder), { code: 'ENOENT' })
await manager.remove('rules')
assert.ok(manager.list().every((p) => !p.installed))
const args = [
  path.resolve('dist/component-prototype/host'),
  '--mode=music',
  '--mute-audio',
  '--user-data-dir=' + path.join(root, 'profile'),
]
const launch = () =>
  electron.launch({ args, env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' } })
let app = await launch()
try {
  let page = await app.firstWindow()
  const guide = () => page.getByRole('complementary', { name: 'Music 使用引导' })
  await expect(guide()).toBeVisible()
  await page.evaluate(() => delete document.documentElement.dataset.backdrop)
  await guide().getByText('连接方法').click()
  await expect(guide().locator('code')).toContainText('music-source-mcp.mjs')
  await page.screenshot({ path: path.join(root, 'guide.png') })
  await guide().getByText('查看音乐源').click()
  await expect(page.getByRole('button', { name: '音源目录' })).toBeVisible()
  const settings = async () => {
    await page.getByRole('tab', { name: '设置', exact: true }).click()
    await selectMusicSettings(page, '插件')
  }
  await settings()
  const row = (title) =>
    page.locator('article').filter({ has: page.getByText(title, { exact: true }) })
  const catalog = await page.evaluate(() => window.musicPlugins.list())
  assert.equal(catalog.length, 3)
  assert.ok(catalog.every((x) => !x.installed && x.bytes > 0))
  await expect(page.getByRole('tab', { name: '扩展', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '重新查看使用引导' }).click()
  await guide().getByText('下一步').click()
  await guide().getByText('配置模型 API').click()
  await expect(page.getByRole('heading', { name: '模型与推荐' })).toBeVisible()
  await settings()
  await page.getByRole('button', { name: '重新查看使用引导' }).click()
  await guide().getByText('下一步').click()
  await guide().getByText('打开每日推荐').click()
  await expect(page.getByRole('tab', { name: '每日推荐' })).toHaveAttribute('aria-selected', 'true')
  await settings()
  await page.getByRole('button', { name: '重新查看使用引导' }).click()
  await guide().getByText('下一步').click()
  await guide().getByText('下一步').click()
  await guide().getByText('浏览插件').click()
  await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].setSize(940, 650))
  await expect(page.getByRole('navigation', { name: '设置分类' })).toBeVisible()
  await page.screenshot({ path: path.join(root, 'catalog.png') })
  const bad = path.join(root, 'wrong.fitbayplugin')
  await writeFile(bad, 'incorrect')
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, bad)
  const rules = row('智能歌单')
  await rules.getByText('选择插件文件').click()
  await expect(
    page.getByRole('status').filter({ hasText: '安装包大小与当前版本不符' }),
  ).toBeVisible()
  await choosePluginFile(app, 'rules')
  await rules.getByText('选择插件文件').click()
  await rules.getByText('打开', { exact: true }).click()
  await expect(page.getByRole('tab', { name: '扩展', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.locator('.music-extensions').getByRole('textbox').first()).toBeVisible()
  assert.deepEqual(
    await page.evaluate(async () =>
      (await window.musicPlugins.list()).filter((x) => x.installed).map((x) => x.id),
    ),
    ['rules'],
  )
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  await expect(page.getByRole('tab', { name: '扩展', exact: true })).toBeVisible()
  await expect(guide()).toHaveCount(0)
  await settings()
  await row('智能歌单').getByText('卸载', { exact: true }).click()
  await expect(page.getByRole('tab', { name: '扩展', exact: true })).toHaveCount(0)
  await assert.rejects(
    page.evaluate(() => window.musicPlugins.call('rules', 'list')),
    /请先安装/,
  )
  await page.getByRole('button', { name: '重新查看使用引导' }).click()
  await guide().getByText('跳过').click()
  await expect(guide()).toHaveCount(0)
  console.log(
    'PASS 三卡首次引导、真实跳转、重开与跳过；默认未安装、坏包拒绝、按需安装、跨重启与卸载禁用。',
    root,
  )
} finally {
  await app.close()
}
