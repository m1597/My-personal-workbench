import { selectMusicSettings } from './music-settings-fixture.mjs'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { _electron, expect } from '@playwright/test'
import { openConnections } from '../examples/component-host/api-connections.mjs'

await mkdir('tmp', { recursive: true })
const profile = await mkdtemp(path.resolve('tmp/music-inheritance-'))
const key = randomUUID()
const requests = []
const server = createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  requests.push([
    req.url,
    JSON.parse(Buffer.concat(chunks)).model,
    req.headers.authorization === 'Bearer ' + key,
  ])
  res.end(JSON.stringify({ choices: [{ message: { content: '{"keyword":"fixture"}' } }] }))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const db = openConnections(profile)
let app
try {
  const endpoint = 'http://127.0.0.1:' + server.address().port
  db.write('default', { endpoint: endpoint + '/base', model: 'base', key })
  for (const restart of [false, true]) {
    app = await _electron.launch({
      args: [
        path.resolve('dist/component-prototype/host'),
        '--mode=music',
        '--mute-audio',
        '--user-data-dir=' + profile,
      ],
      env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
    })
    const page = await app.firstWindow()
    page.setDefaultTimeout(10000)
    const skip = page.getByRole('button', { name: '跳过', exact: true })
    if (!restart) {
      await skip.waitFor({ timeout: 5000 }).catch(() => {})
      if (await skip.isVisible()) await skip.click()
    }
    await page.getByRole('button', { name: '音乐设置', exact: true }).click()
    await selectMusicSettings(page, '模型与推荐')
    const panel = page.locator('.api-connections')
    const verify = async (model, source) => {
      await expect(panel.locator('tbody')).toContainText(source)
      await expect(panel.getByLabel('模型', { exact: true })).toHaveValue(model)
      await page.evaluate(() => window.music.aiCatalogQuery('artists', 'fixture'))
      assert.deepEqual(requests.pop(), ['/' + model + '/chat/completions', model, true])
    }
    await verify('base', '继承默认')
    if (!restart) {
      await panel.getByRole('combobox', { name: '协议' }).click()
      const options = panel.getByRole('listbox')
      await expect(options).toHaveClass(/component-popup/)
      await expect(options.getByRole('option', { name: 'Chat Completions' })).toBeVisible()
      await page.screenshot({ path: path.join(profile, 'protocol.png') })
      await page.keyboard.press('Escape')
      await panel.getByLabel('服务地址').fill(endpoint + '/mine')
      await panel.getByLabel('模型', { exact: true }).fill('mine')
      await panel.getByLabel('API Key').fill(key)
      await panel.getByRole('button', { name: '保存配置' }).click()
      await verify('mine', '专用连接')
      assert.equal(db.read('default').model, 'base')
      await panel.getByRole('button', { name: '恢复默认连接' }).click()
      await verify('base', '继承默认')
    }
    await app.close()
    app = undefined
  }
  console.log('PASS inherited, dedicated, restored, restarted', profile)
} finally {
  await app?.close()
  db.close()
  server.closeAllConnections()
  server.close()
}
