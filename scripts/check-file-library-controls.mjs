import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, mkdtemp, writeFile, copyFile, readdir, readFile } from 'node:fs/promises'
import { _electron, expect } from '@playwright/test'
await mkdir('tmp', { recursive: true })
const dir = await mkdtemp(path.resolve('tmp/file-controls-')),
  profile = path.join(dir, 'profile'),
  root = path.join(dir, 'assets'),
  out = path.join(root, 'output')
await mkdir(out, { recursive: true })
await mkdir(path.join(profile, 'prompt-library'), { recursive: true })
await writeFile(
  path.join(profile, 'prompt-library/preferences.json'),
  JSON.stringify({ defaultRoot: root, shortcut: 'Control+Alt+Shift+F12' }),
)
for (const f of ['a', 'b'])
  await copyFile('src/renderer/public/fitbay.png', path.join(root, f + '.png'))
for (let i = 0; i < 50; i++) await writeFile(path.join(root, 'note' + i + '.txt'), 'sample')
const dist = path.resolve('dist/component-prototype'),
  env = { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' }
const kit = await _electron.launch({
  args: [path.resolve('components/toolkit'), '--workbench-profile=' + profile],
  env,
})
let files
try {
  const tool = await kit.firstWindow()
  files = await _electron.launch({
    args: [
      path.join(dist, 'host'),
      '--mode=prompts',
      '--workbench=' + path.join(dist, 'workbench/index.html'),
      '--user-data-dir=' + profile,
    ],
    env,
  })
  const ui = await files.firstWindow(),
    rows = ui.locator('.entries'),
    button = (page, name) => page.getByRole('button', { name, exact: true })
  await button(ui, 'note0.txt').press('Space')
  const preview = ui.getByRole('dialog', { name: '文本预览' })
  await expect(preview).toContainText('sample')
  await preview.press('Space')
  await expect(preview).toHaveCount(0)
  await button(ui, 'a.png').click()
  await button(ui, 'b.png').click({ modifiers: ['Control'] })
  await expect(ui.getByText('已选 2 项')).toBeVisible()
  for (const mode of ['standalone', 'docked']) {
    if (mode === 'docked') await button(ui, '加入工作台').click()
    const scroll = await rows.evaluate((el) => {
      el.scrollTop = 180
      return el.scrollTop
    })
    assert(scroll > 0)
    await button(ui, '文件库设置').click()
    if (mode === 'standalone') {
      await files.evaluate(({ dialog }, folder) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
      }, out)
      await button(ui, '设置默认目录').click()
      await expect(ui.getByText('默认目录 · ' + out, { exact: true })).toBeVisible()
    }
    const toggle = button(ui, '设置分类')
    if (await toggle.isVisible()) await toggle.click()
    await button(ui, '全局快捷键').click()
    await expect(ui.getByRole('textbox', { name: '快捷键' })).toBeVisible()
    await ui.screenshot({ path: path.join(dir, mode + '-settings.png') })
    await button(ui, '返回').click()
    await expect(ui.getByText('已选 2 项')).toBeVisible()
    assert.equal(await rows.evaluate((el) => el.scrollTop), scroll)
  }
  await button(ui, '改尺寸').click()
  await expect(tool.getByRole('button', { name: '生成尺寸副本' })).toBeVisible({ timeout: 15000 })
  await kit.evaluate(({ dialog }, out) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [out] })
  }, out)
  await button(tool, '生成尺寸副本').click()
  await expect.poll(async () => (await readdir(out)).length).toBe(2)
  for (const f of await readdir(out)) {
    const bytes = await readFile(path.join(out, f))
    assert.equal(bytes.readUInt32BE(16), 800)
    assert.equal(bytes.readUInt32BE(20), 600)
  }
  await button(ui, '批量重命名').click()
  await button(tool, '预览名称').click()
  await button(tool, '确认重命名').click()
  await expect(button(ui, 'a.png')).toHaveCount(0)
  assert.equal((await readdir(root)).filter((f) => f.endsWith('.png')).length, 2)
  await ui.screenshot({ path: path.join(dir, 'after-rename.png') })
  console.log(
    'PASS standalone, docked, retained scroll and selection, real toolkit resize and rename',
    dir,
  )
} finally {
  await files?.close()
  await kit.close()
}
