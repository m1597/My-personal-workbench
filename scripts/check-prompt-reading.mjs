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
  const results = []
  const inputSession = await page.context().newCDPSession(page)
  async function viewport(width, height, zoom) {
    return app.evaluate(
      ({ BaseWindow, webContents }, size) => {
        const wc = webContents
          .getAllWebContents()
          .find((w) => w.getURL().includes('/prompts/index.html'))
        const owner = BaseWindow.getAllWindows().find((w) =>
          w.contentView.children.some((c) => c.webContents === wc),
        )
        if (!owner) throw Error('找不到提示词宿主窗口')
        owner.setContentSize(size.width, size.height)
        wc.setZoomFactor(size.zoom)
      },
      { width, height, zoom },
    )
  }
  async function capture(label) {
    const measure = await page.evaluate(() => {
      const v = visualViewport
      const selectors = [
        '.library:not([hidden])',
        '.prompt-searchbar',
        '[aria-label="搜索提示词"]',
        '.prompt-searchbar button',
        '.prompt-split',
        '.reader-heading',
        '.reader-tabs',
        '.reader-content',
        '.markdown',
      ]
      const boxes = selectors.flatMap((sel) =>
        [...document.querySelectorAll(sel)]
          .filter((el) => el.getClientRects().length)
          .map((el) => {
            const box = el.getBoundingClientRect()
            return {
              sel,
              left: box.left,
              right: box.right,
              overflow: el.scrollWidth - el.clientWidth,
            }
          }),
      )
      const md = document.querySelector('.markdown')
      const range = document.createRange()
      const overflowLines = md
        ? [...md.querySelectorAll('p,li,pre')].some((el) => {
            range.selectNodeContents(el)
            return [...range.getClientRects()].some(
              (r) => r.right > v.offsetLeft + v.width + 1 || r.left < v.offsetLeft - 1,
            )
          })
        : false
      const outside = []
      if (md)
        for (const el of md.querySelectorAll('p,li,pre')) {
          range.selectNodeContents(el)
          const bad = [...range.getClientRects()].find((r) => r.right > v.width + 1 || r.left < -1)
          if (bad && outside.length < 4)
            outside.push({
              tag: el.tagName,
              right: bad.right,
              left: bad.left,
              display: getComputedStyle(el).whiteSpace,
              text: el.textContent.slice(0, 55),
            })
        }
      return {
        outside,
        width: v.width,
        height: v.height,
        dpr: devicePixelRatio,
        boxes,
        overflowLines,
        rootOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })
    const raw = await app.evaluate(async ({ webContents }) => {
      const wc = webContents
        .getAllWebContents()
        .find((w) => w.getURL().includes('/prompts/index.html'))
      const image = await wc.capturePage()
      return { url: image.toDataURL(), size: image.getSize() }
    })
    const composite = await page.evaluate(async (url) => {
      const img = new Image()
      img.src = url
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#202227'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0)
      return canvas.toDataURL('image/png').split(',')[1]
    }, raw.url)
    await writeFile(
      path.join(evidence, label + '-layer.png'),
      Buffer.from(raw.url.split(',')[1], 'base64'),
    )
    await writeFile(path.join(evidence, label + '.png'), Buffer.from(composite, 'base64'))
    results.push({ label, ...measure, captureSize: raw.size })
    await writeFile(path.join(evidence, 'geometry.json'), JSON.stringify(results, null, 2))
    assert(
      Math.abs(raw.size.width - measure.width * measure.dpr) <= 2 &&
        Math.abs(raw.size.height - measure.height * measure.dpr) <= 2,
      label + ' capture clipped',
    )
    assert(
      !measure.overflowLines &&
        measure.rootOverflow <= 1 &&
        measure.boxes.every((b) => b.left >= -1 && b.right <= measure.width + 1 && b.overflow <= 1),
      label + ' viewport overflow: ' + JSON.stringify(measure),
    )
  }
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
    await viewport(width, height, surface === 'narrow' ? 1.25 : 1)
    await expect.poll(() => page.evaluate(() => Math.round(innerWidth))).toBeGreaterThan(0)
    if (surface === 'narrow') {
      await search.fill('')
      await search.click()
      await inputSession.send('Input.imeSetComposition', {
        text: '目录',
        selectionStart: 2,
        selectionEnd: 2,
      })
      await inputSession.send('Input.insertText', { text: '目录' })
      await expect(search).toHaveValue('目录')
      const paste = btn('粘贴导入')
      assert(
        await paste.evaluate((el) => {
          const r = el.getBoundingClientRect()
          return el.contains(document.elementFromPoint(r.right - 3, r.y + r.height / 2))
        }),
      )
      await paste.click()
      await expect(page.getByLabel('粘贴原文')).toBeVisible()
      await paste.click()
    }
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
    await expect(btn('原文')).toHaveAttribute('aria-pressed', 'true')
    await expect(btn('可视化')).toHaveAttribute('aria-pressed', 'false')
    await capture(surface + '-oauth')
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
    await capture(surface + '-list')
    count++
  }
  const data = await readFile(path.join(root, '接入ai订阅.md'))
  assert(data.equals(await readFile(path.join(source, '接入ai订阅.md'))))
  console.log('PASS', count, 'viewports,', data.length, 'bytes', evidence)
} finally {
  await app.close()
}
