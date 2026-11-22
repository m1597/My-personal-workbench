import { _electron, expect } from '@playwright/test'
import path from 'node:path'
import { copyFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { toolkitConnections } from '../components/toolkit/toolkit-connections.mjs'
import { openConnections } from '../examples/component-host/api-connections.mjs'
import assert from 'node:assert/strict'
const profile = await mkdtemp(path.resolve('tmp/toolkit-choices-'))
await mkdir(path.join(profile, 'toolkit'))
await writeFile(
  path.join(profile, 'toolkit/settings.json'),
  JSON.stringify(
    Object.fromEntries(
      ['capture', 'selection', 'color'].map((k) => [
        k,
        { enabled: k === 'capture', key: 'Control+Alt+F12' },
      ]),
    ),
  ),
)
const db = openConnections(profile)
db.write('default', { endpoint: 'http://localhost:9132/v1', model: 'shared-text', vision: false })
const facade = toolkitConnections({
  shared: profile,
  packaged: false,
  legacy: {},
  onChange() {},
  onMigrated() {},
})
assert.equal((await facade.resolve('translation')).model, 'shared-text')
await assert.rejects(() => facade.resolve('vision'), /TOOLKIT_CONFIG_vision/)
const env = { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' }
let kit, host
const b = (p, name) => p.getByRole('button', { name, exact: true })
async function openSettings(p) {
  await b(p, '设置').click()
  const categories = b(p, '设置分类')
  if (await categories.isVisible()) await categories.click()
  await b(p, 'API 与模型').click()
}
async function select(p, label, option) {
  await p.getByRole('combobox', { name: label, exact: true }).click()
  await p.getByRole('option', { name: option, exact: true }).click()
}
try {
  kit = await _electron.launch({
    args: ['components/toolkit', '--workbench-profile=' + profile],
    env,
  })
  const page = await kit.firstWindow()
  page.on('pageerror', (e) => console.error(e.message))
  await page.setViewportSize({ width: 340, height: 660 })
  await openSettings(page)
  await expect(page.getByLabel('模型名')).toHaveValue('shared-text')
  await expect(page.getByLabel('服务地址')).toHaveJSProperty('readOnly', true)
  await page.getByRole('combobox', { name: '连接', exact: true }).click()
  await expect(page.getByRole('listbox')).toBeVisible()
  await page.screenshot({ path: path.join(profile, 'standalone-open.png') })
  await page.getByRole('option', { name: '单独配置', exact: true }).click()
  await page.getByLabel('模型名').fill('only-toolkit')
  await b(page, '保存 API 配置').click()
  await expect.poll(() => db.read('toolkit.translation')?.source).toBe('dedicated')
  assert.equal(db.read('default').model, 'shared-text')
  assert.equal((await facade.resolve('translation')).model, 'only-toolkit')
  await select(page, '用途', '视觉问答')
  await expect(page.getByLabel('模型名')).toHaveValue('')
  await page.getByRole('combobox', { name: '连接', exact: true }).click()
  await expect(page.getByRole('option', { name: /复用.*shared-text/ })).toHaveCount(0)
  await page.getByRole('combobox', { name: '连接', exact: true }).press('Escape')
  db.write('default', {
    expectedId: db.read('default').id,
    endpoint: 'http://localhost:9132/v1',
    model: 'shared-vision',
    vision: true,
  })
  await expect(page.getByLabel('模型名')).toHaveValue('shared-vision')
  host = await _electron.launch({
    args: [
      'dist/component-prototype/host',
      '--mode=workbench',
      '--user-data-dir=' + profile,
      '--workbench=' + path.resolve('out/renderer/index.html'),
    ],
    env,
  })
  const shell = await host.firstWindow()
  shell.on('pageerror', (e) => console.error(e.message))
  await b(shell, '组件').click()
  await shell.locator('#window-menu').getByText('工具集', { exact: true }).click()
  const panel = shell.locator('.toolkit-panel')
  await openSettings(panel)
  await expect(panel.getByLabel('模型名')).toHaveValue('only-toolkit')
  await panel.getByRole('combobox', { name: '连接', exact: true }).click()
  await expect(panel.getByRole('listbox')).toBeVisible()
  await panel.screenshot({ path: path.join(profile, 'dock-open.png') })
  await panel.getByRole('option', { name: '继承工作台默认连接', exact: true }).click()
  await b(panel, '保存 API 配置').click()
  await expect.poll(() => db.read('toolkit.translation')?.source).toBe('default')
  await select(page, '用途', '翻译与文字问答')
  await expect(page.getByLabel('模型名')).toHaveValue('shared-vision')
  await b(page, '返回').click()
  const waiting = kit.waitForEvent('window')
  await b(page, '框选屏幕').click()
  const overlay = await waiting
  await overlay.locator('.screen img').waitFor()
  await overlay.mouse.move(100, 100)
  await overlay.mouse.down()
  await overlay.mouse.move(360, 285)
  await overlay.mouse.up()
  await b(overlay, '标注').click()
  await select(overlay, '标注形状', '矩形')
  await expect(overlay.getByRole('combobox', { name: '标注形状' })).toHaveText('矩形')
  await b(overlay, '取消标注').click()
  await overlay.keyboard.press('Escape').catch((error) => {
    if (!overlay.isClosed()) throw error
  })
  await expect.poll(() => overlay.isClosed()).toBe(true)
  await kit.close()
  kit = await _electron.launch({
    args: ['components/toolkit', '--workbench-profile=' + profile, '--toolkit-page=pairs'],
    env,
  })
  const pairs = await kit.firstWindow()
  const image = path.join(profile, 'sample.png'),
    prompt = path.join(profile, 'script.txt')
  await copyFile('docs/images/toolkit-runtime/annotated-paste.png', image)
  await writeFile(prompt, 'demo')
  // Only the native file-picker response is supplied. File reads and rename preview use the component.
  await kit.evaluate(
    ({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths })
    },
    [image, prompt],
  )
  await b(pairs, '选择文件').click()
  await select(pairs, 'sample.png 的提示词', 'script.txt')
  await b(pairs, '预览名称').click()
  await expect(b(pairs, '确认重命名')).toBeEnabled()
  console.log('PASS file pairing dropdown and rename preview')
  console.log('PASS screenshot annotation shape and Esc cleanup')
  console.log(
    'PASS independent and docked dropdowns, overrides, restoring default, vision capability and cross-window refresh',
    profile,
  )
} finally {
  await host?.close()
  await kit?.close()
  facade.close()
  db.close()
}
