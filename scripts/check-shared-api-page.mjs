import { _electron as electron, expect } from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
const root = await mkdtemp(path.resolve('tmp/api-settings-')),
  proto = path.resolve('dist/component-prototype')
const app = await electron.launch({
  args: [
    path.join(proto, 'host'),
    '--mode=workbench',
    '--workbench=' + path.resolve('out/renderer/index.html'),
    '--user-data-dir=' + root,
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  const w = await app.firstWindow()
  const b = (p, name) => p.getByRole('button', { name, exact: true })
  await b(w, '工作台设置').click()
  await b(w, 'API 与模型').click()
  const section = w.locator('.api-connections')
  await b(section, '模型与推荐').click()
  const form = section.locator('form')
  await form.getByLabel('服务地址').fill('https://example.invalid/v1')
  await form.getByLabel('模型', { exact: true }).fill('demo-a')
  await expect(form.getByLabel('API Key')).toHaveAttribute('type', 'password')
  await form.getByLabel('API Key').fill(randomBytes(32).toString('hex'))
  await b(form, '保存配置').click()
  await expect(form.getByLabel('API Key')).toHaveValue('')
  await expect(section.getByText('已配置', { exact: true })).toHaveCount(1)
  await w.screenshot({ path: path.join(root, 'overview.png') })
  await w.getByRole('searchbox').fill('模型与推荐')
  await b(w, 'Music › 音乐设置 › 模型与推荐').click()
  await expect
    .poll(() => app.windows().some((p) => p.url().includes('/music/index.html')))
    .toBe(true)
  const player = app.windows().find((p) => p.url().includes('/music/index.html')),
    music = player.locator('.api-connections form')
  if (await b(player, '跳过').isVisible()) await b(player, '跳过').click()
  await b(player, '模型与推荐').click()
  await expect(music.getByLabel('模型', { exact: true })).toHaveValue('demo-a')
  await music.getByLabel('模型', { exact: true }).fill('demo-b')
  await b(music, '保存配置').click()
  await b(w, '工作台设置').click()
  await b(w, 'API 与模型').click()
  await b(section, '模型与推荐').click()
  await expect(form.getByLabel('模型', { exact: true })).toHaveValue('demo-b')
  console.log('PASS global to Music and Music to global; masked key', root)
} finally {
  await app.close()
}
