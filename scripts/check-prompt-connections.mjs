import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron, expect } from '@playwright/test'

async function openSettings(ui, category) {
  await ui.getByRole('button', { name: '提示词库设置', exact: true }).click()
  const toggle = ui.getByRole('button', { name: '设置分类', exact: true })
  if (await toggle.isVisible()) await toggle.click()
  await ui.getByRole('button', { name: category, exact: true }).click()
}
const root = path.resolve('dist/component-prototype')
await mkdir('tmp', { recursive: true })
const evidence = await mkdtemp(path.resolve('tmp/prompt-connections-'))
const profile = path.join(evidence, 'profile'),
  folder = path.join(evidence, 'documents')
await mkdir(folder)
await writeFile(path.join(folder, '解释推导.md'), '说明每一个推导步骤')
const app = await electron.launch({
  args: [
    path.join(root, 'host'),
    '--mode=prompts',
    '--workbench=' + path.resolve('out/renderer/index.html'),
    '--user-data-dir=' + profile,
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
async function page(fragment) {
  await expect.poll(() => app.windows().some((p) => p.url().includes(fragment))).toBe(true)
  return app.windows().find((p) => p.url().includes(fragment))
}
try {
  const ui = await page('/prompts/index.html')
  await expect(ui.getByRole('heading', { name: '提示词库' })).toBeVisible()
  await expect(ui.getByLabel('API Key')).toHaveCount(0)
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, folder)
  await ui.getByRole('button', { name: '选择提示词目录' }).click()
  await ui.getByRole('button', { name: '解释推导', exact: true }).click()
  await expect(ui.locator('.markdown')).toContainText('说明每一个推导步骤')
  await openSettings(ui, 'API 与模型')
  await ui.getByLabel('连接来源').click()
  await ui.getByRole('option', { name: '单独配置', exact: true }).click()
  await ui.getByLabel('服务地址').fill('https://repo.example.invalid/v1')
  await ui.getByLabel('适用模型').fill('library-model')
  const keyField = ui.getByLabel('API Key', { exact: true })
  assert.equal(await keyField.getAttribute('type'), 'password')
  // Ephemeral marker never enters captures, console output or a failing assertion message.
  const marker = randomUUID()
  await keyField.fill(marker).catch(() => {
    throw Error('无法填写测试凭据')
  })
  await ui.getByRole('button', { name: '保存连接' }).click()
  await expect(keyField).toHaveValue('')
  await expect(keyField).toHaveAttribute('placeholder', /已设置/)
  await expect(ui.getByRole('status')).toHaveText('已保存')
  const db = await readFile(path.join(profile, 'api-connections.sqlite'))
  assert(
    !db.includes(Buffer.from(marker)) && !db.includes(Buffer.from(marker, 'utf16le')),
    '数据库包含未保护的测试凭据',
  )
  const publicState = await ui.evaluate(() => window.promptConnections.snapshot())
  assert(!JSON.stringify(publicState).includes(marker), '公共快照包含凭据')
  await ui.getByRole('button', { name: '返回', exact: true }).click()
  await openSettings(ui, '目录')
  await ui.getByRole('button', { name: '加入工作台' }).click()
  await expect(ui.getByRole('button', { name: '独立打开' })).toBeVisible()
  await ui.getByRole('button', { name: 'API 与模型', exact: true }).click()
  await expect(ui.getByLabel('适用模型')).toHaveValue('library-model')
  await ui.screenshot({ path: path.join(evidence, 'docked.png') })
  await ui.getByRole('button', { name: '返回', exact: true }).click()
  await openSettings(ui, '目录')
  await ui.getByRole('button', { name: '独立打开' }).click()
  await ui.getByRole('button', { name: 'API 与模型', exact: true }).click()
  const shell = await page('/renderer/index.html')
  await shell.getByRole('button', { name: '工作台设置' }).click()
  await shell.getByRole('button', { name: 'API 与模型', exact: true }).click()
  const row = shell.getByRole('row').filter({ hasText: '提示词库' })
  await row.getByRole('button').click()
  const form = shell.locator('.api-connections form')
  await expect(form.getByLabel('模型', { exact: true })).toHaveValue('library-model')
  await form.getByLabel('模型', { exact: true }).fill('from-global')
  await form.getByRole('button', { name: '保存配置' }).click()
  await expect(ui.getByLabel('适用模型')).toHaveValue('from-global')
  await ui.getByLabel('适用模型').fill('from-component')
  await ui.getByRole('button', { name: '保存连接' }).click()
  await expect(form.getByLabel('模型', { exact: true })).toHaveValue('from-component')
  async function configureRoute(use, model) {
    await shell.evaluate(
      ({ use, model }) =>
        window.fitbayConnections.write(use, {
          separate: true,
          endpoint: 'http://127.0.0.1:18080/v1',
          model,
          protocol: 'chat',
          key: '',
        }),
      { use, model },
    )
  }
  await configureRoute('toolkit.vision', 'vision-a')
  await configureRoute('toolkit.translation', 'vision-a')
  const sources = ui.getByLabel('连接来源')
  await sources.click()
  await expect(ui.getByRole('option', { name: /vision-a/ })).toHaveCount(2)
  await ui.getByRole('option', { name: /视觉模型.*vision-a/ }).click()
  await ui.getByRole('button', { name: '保存连接' }).click()
  await expect(form.getByLabel('模型', { exact: true })).toHaveValue('vision-a')
  await configureRoute('toolkit.translation', 'text-a')
  await sources.click()
  await ui.getByRole('option', { name: '单独配置', exact: true }).click()
  await ui.getByLabel('适用模型').fill('own-again')
  await ui.getByRole('button', { name: '保存连接' }).click()
  await expect(form.getByLabel('模型', { exact: true })).toHaveValue('own-again')
  await app.evaluate(({ BaseWindow }) => {
    const w = BaseWindow.getAllWindows().find((w) => w.getTitle() === '提示词库')
    w.setSize(380, 570)
  })
  await ui.screenshot({ path: path.join(evidence, 'standalone-narrow.png') })
  await ui.getByRole('button', { name: '返回', exact: true }).click()
  await ui.getByText('更多', { exact: true }).click()
  await ui.getByText('固定为工具集动作', { exact: true }).click()
  await expect(ui.locator('.action-connection')).toContainText('text-a')
  await ui.getByLabel('输入类型').click()
  await ui.getByRole('option', { name: '图片', exact: true }).click()
  await expect(ui.locator('.action-connection')).toContainText('vision-a')
  await configureRoute('toolkit.vision', 'vision-b')
  await expect(ui.locator('.action-connection')).toContainText('vision-b')
  await ui.screenshot({ path: path.join(evidence, 'action-connection.png') })
  console.log(
    'PASS standalone, docked, masked key, encrypted storage, live two-way edits, reuse, isolation, delegated routes',
    evidence,
  )
} finally {
  await app.close()
}
