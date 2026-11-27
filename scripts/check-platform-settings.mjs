import { _electron as electron, expect } from '@playwright/test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
await mkdir('tmp', { recursive: true })
const root = await mkdtemp(path.resolve('tmp/platform-settings-'))
const app = await electron.launch({
  args: [
    path.resolve('dist/component-prototype/host'),
    '--mode=workbench',
    '--component=' + path.resolve('dist/component-prototype/component'),
    '--workbench=' + path.resolve('out/renderer/index.html'),
    '--user-data-dir=' + path.join(root, 'profile'),
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  const page = await app.firstWindow()
  page.setDefaultTimeout(10000)
  const button = (name) => page.getByRole('button', { name, exact: true })
  await button('工作台设置').click()
  await button('API 与模型').click()
  await expect(page.locator('.api-connections select')).toHaveCount(0)
  for (const label of ['协议', '连接']) {
    await page.getByRole('combobox', { name: label, exact: true }).click()
    const options = page.getByRole('listbox')
    await expect(options).toBeVisible()
    await page.screenshot({ path: path.join(root, label + '.png') })
    if (label === '协议') await page.getByRole('option', { name: 'OpenAI Responses' }).click()
    else await page.keyboard.press('Escape')
  }
  const form = page.locator('.api-connections form')
  await page.getByRole('combobox', { name: '连接', exact: true }).click()
  await page.getByRole('option', { name: 'ChatGPT 订阅授权' }).click()
  await expect(button('Continue with ChatGPT')).toBeVisible()
  await page.screenshot({ path: path.join(root, 'subscription.png') })
  await page.getByRole('combobox', { name: '连接', exact: true }).click()
  await page.getByRole('option', { name: '新建连接' }).click()
  await button('模型与推荐').click()
  await form.getByLabel('服务地址').fill('https://example.invalid/test')
  await form.getByLabel('模型', { exact: true }).fill('dedicated-test')
  await button('保存配置').click()
  await expect(button('设为默认连接')).toBeEnabled()
  await button('设为默认连接').click()
  await expect(page.locator('.api-connections tbody tr').filter({ hasText: '翻译' })).toContainText(
    '继承默认',
  )
  await expect(
    page.locator('.api-connections tbody tr').filter({ hasText: '视觉模型' }),
  ).toContainText('需要支持视觉')
  await button('恢复默认连接').click()
  await expect(
    page.locator('.api-connections tbody tr').filter({ hasText: 'Music' }),
  ).toContainText('继承默认')
  await button('组件管理与更新').click()
  expect(
    await page.locator('.update-row').evaluateAll((rows) => rows.map((row) => row.dataset.product)),
  ).toEqual(['workbench', 'music', 'prompts', 'toolkit'])
  await button('检查全部更新').click()
  await expect
    .poll(() => page.evaluate(async () => (await window.fitbayUpdates.snapshot()).lastChecked), {
      timeout: 25000,
    })
    .toBeTruthy()
  const live = await page.evaluate(() => window.fitbayUpdates.snapshot())
  await writeFile(path.join(root, 'live.json'), JSON.stringify(live, null, 2))
  for (const width of [1250, 780]) {
    await app.evaluate(
      ({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setContentSize(w, 740),
      width,
    )
    await page.screenshot({ path: path.join(root, 'updates-' + width + '.png') })
  }
  console.log(
    'PASS',
    root,
    live.rows.map(({ id, status }) => [id, status]),
  )
} finally {
  await app.close()
}
