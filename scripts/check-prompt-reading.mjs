import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { _electron, expect } from '@playwright/test'

const source = process.argv[2]
if (!source) throw Error('请提供样例目录')
await mkdir('tmp', { recursive: true })
const evidence = await mkdtemp(path.resolve('tmp/prompt-reading-'))
const root = path.join(evidence, 'prompts')
const profile = path.join(evidence, 'profile')
await mkdir(root)
await mkdir(path.join(profile, 'prompt-library'), { recursive: true })
for (const file of ['修复分窗收起问题.md', '接入ai订阅.md'])
  await cp(path.join(source, file), path.join(root, file))
for (let i = 0; i < 40; i++) await writeFile(path.join(root, 'test-' + i + '.txt'), 'SDK test')
await writeFile(
  path.join(profile, 'prompt-library/catalogue-preferences.json'),
  JSON.stringify({ defaultRoot: root, shortcut: 'F20', shortcutEnabled: false }),
)
const app = await _electron.launch({
  args: [
    path.resolve('dist/component-prototype/host'),
    '--mode=prompts',
    '--workbench=' + path.resolve('out/renderer/index.html'),
    '--user-data-dir=' + profile,
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  const page = await app.firstWindow()
  const btn = (name) => page.getByRole('button', { name, exact: true })
  const cdp = await page.context().newCDPSession(page)
  const viewport = (width, height) =>
    cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    })
  const search = page.getByLabel('搜索提示词')
  let count = 0
  for (const [surface, width, height] of [
    ['standalone', 1160, 800],
    ['half', 760, 720],
    ['narrow', 372, 660],
    ['docked', 580, 640],
  ]) {
    if (surface === 'docked') {
      await btn('提示词库设置').click()
      await btn('加入工作台').click()
      await expect(btn('独立打开')).toBeVisible()
      await btn('返回').click()
    }
    await viewport(width, height)
    await app.evaluate(
      ({ webContents }, zoom) =>
        webContents
          .getAllWebContents()
          .find((w) => w.getURL().includes('/prompts/index.html'))
          .setZoomFactor(zoom),
      surface === 'narrow' ? 1.25 : 1,
    )
    await search.fill('SDK')
    const nav = page.getByRole('navigation', { name: '提示词' })
    const card = nav.getByRole('button', { name: /pi-ai/ })
    await card.scrollIntoViewIfNeeded()
    const position = await nav.evaluate((el) => el.scrollTop)
    await card.click()
    const reader = page.locator('.reader-content')
    const generate = btn('生成可视化')
    await expect(generate).toBeInViewport()
    const toc = reader.getByRole('link', { name: 'OAuth Providers', exact: true })
    await toc.click()
    const heading = reader.getByRole('heading', { name: 'OAuth Providers', exact: true })
    await expect(heading).toBeFocused()
    await expect(heading).toBeInViewport()
    const anchorBox = await heading.boundingBox(),
      tabs = await page.locator('.reader-tabs').boundingBox()
    assert(anchorBox.y >= tabs.y + tabs.height - 1)
    await page.screenshot({ path: path.join(evidence, surface + '-oauth.png') })
    await reader.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    assert(await reader.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop <= 2))
    await expect(reader.getByText('更多', { exact: true })).toBeInViewport()
    await reader.getByText('更多', { exact: true }).click()
    await reader.getByRole('button', { name: '固定为工具集动作' }).click()
    await expect(reader.getByLabel('显示名')).toBeVisible()
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(search).toHaveValue('SDK')
    await expect(card).toHaveAttribute('aria-current', 'true')
    assert(Math.abs((await nav.evaluate((el) => el.scrollTop)) - position) <= 2)
    await page.screenshot({ path: path.join(evidence, surface + '-list.png') })
    count++
  }
  const data = await readFile(path.join(root, '接入ai订阅.md'))
  assert(data.equals(await readFile(path.join(source, '接入ai订阅.md'))))
  console.log('PASS', count, 'viewports,', data.length, 'bytes', evidence)
} finally {
  await app.close()
}
