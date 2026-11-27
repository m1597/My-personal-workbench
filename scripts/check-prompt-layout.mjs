import assert from 'node:assert/strict'
import { mkdtemp, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { readPrompt } from '../examples/component-host/prompt-actions.mjs'
import { _electron, expect } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import { writeFile, readFile } from 'node:fs/promises'
import { promptVisuals } from '../examples/component-host/prompt-visuals.mjs'

await mkdir('tmp', { recursive: true })
const profile = await mkdtemp(path.resolve('tmp/layout-'))
const root = path.join(profile, 'prompts')
await mkdir(root)
await mkdir(path.join(profile, 'prompt-library'), { recursive: true })
await writeFile(
  path.join(profile, 'prompt-library/catalogue-preferences.json'),
  JSON.stringify({ defaultRoot: root, shortcut: 'F20', shortcutEnabled: false }),
)
const app = await _electron.launch({
  args: [
    path.resolve('dist/component-prototype/host'),
    '--mode=prompts',
    '--user-data-dir=' + profile,
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  const ui = await app.firstWindow()
  const preview = app.waitForEvent('window')
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.layoutPreview = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    return globalThis.layoutPreview.loadURL('about:blank')
  })
  const page = await preview
  for (const n of [6, 7, 24]) {
    const nodes = Array.from({ length: n }, (_, i) => ({ quote: '处理第' + (i + 1) + '项' }))
    for (const long of [false, true]) {
      if (long) nodes[1].quote = 'W'.repeat(40)
      if (long)
        nodes[0].quote = '请逐项核对各个分支的处理结果与记录，保留完整说明和返回上一步的条件。'
      const edges = [
        ...nodes.slice(1).map((node, i) => ({ from: i, to: i + 1, quote: node.quote })),
        { from: 0, to: n - 1, quote: nodes[0].quote },
        { from: n - 1, to: 0, quote: nodes[n - 1].quote },
      ]
      const data = { kind: 'flow', nodes, edges }
      const text = nodes.map((x) => x.quote).join('\n')
      const name = n + '-' + long
      const file = name + '.txt'
      await writeFile(path.join(root, file), text)
      let calls = 0,
        old = true
      const run = promptVisuals(profile, { read: readPrompt }, async () => {
        calls++
        if (!old) throw Error('service unavailable')
        return JSON.stringify(data)
      })
      const view = await run(root, file, true)
      assert.equal((view.svg.match(/data-node-id="/g) || []).length, n)
      assert.equal((view.svg.match(/data-edge-from="/g) || []).length, edges.length)
      assert(view.html.includes(view.svg))
      assert.equal(view.data.nodes[0].quote, nodes[0].quote)
      await ui.getByRole('button', { name, exact: true }).click()
      const reader = ui.getByRole('region', { name: '提示词可视化' })
      await expect(reader.locator('[data-node-id]')).toHaveCount(n)
      assert.equal(await reader.locator('[data-edge-from]').count(), edges.length)
      await reader.locator('[data-node-id=n0]').click()
      await expect(reader.locator('mark')).toHaveText(nodes[0].quote)
      await reader.getByRole('slider').fill('150')
      const exportPath = path.join(profile, name + '.html')
      await app.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath })
      }, exportPath)
      await ui.getByRole('button', { name: '导出 HTML' }).click()
      await expect
        .poll(async () => {
          try {
            return (await readFile(exportPath, 'utf8')) === view.html
          } catch {
            return false
          }
        })
        .toBe(true)
      await page.goto(pathToFileURL(exportPath).href)
      await page.locator('[data-node-id=n0]').click()
      await expect(page.locator('mark')).toHaveText(nodes[0].quote)
      await ui.getByRole('button', { name: '返回', exact: true }).click()
      assert(
        await page.locator('svg').evaluate((svg) =>
          [...svg.querySelectorAll('[data-node-id]')].every((group) => {
            const box = group.querySelector('rect').getBoundingClientRect()
            return [...group.querySelectorAll('text')].every((t) => {
              const b = t.getBoundingClientRect()
              return b.left >= box.left - 1 && b.right <= box.right + 1
            })
          }),
        ),
        name + ' label overflows',
      )
      assert.equal((await run(root, file, true)).svg, view.svg)
      assert.equal(calls, 1)
      old = false
      await writeFile(path.join(root, file), text + ' changed')
      assert.equal((await run(root, file, false)).stale, true)
      await assert.rejects(run(root, file, true), /模型连接/)
      assert.equal((await run(root, file, false)).svg, view.svg)
      console.log('PASS', n, long ? 'wrapped' : 'compact', edges.length, 'edges')
    }
  }
  const quote = '检查步骤。'
  const text = '甲'.repeat(32) + quote + '乙' + quote + '结束'
  const file = '重复引用.txt'
  await writeFile(path.join(root, file), text)
  const data = {
    kind: 'flow',
    nodes: [
      { quote, start: 32 },
      { quote, prefix: '乙', suffix: '结束' },
      { quote },
      { quote, start: 37 },
    ],
    edges: [
      { from: 0, to: 1, quote, start: 38 },
      { from: 1, to: 2, quote },
      { from: 2, to: 3, quote },
    ],
  }
  await promptVisuals(profile, { read: readPrompt }, async () => JSON.stringify(data))(
    root,
    file,
    true,
  )
  await ui.getByRole('button', { name: '重复引用', exact: true }).click()
  const region = ui.getByRole('region', { name: '提示词可视化' })
  async function checkReferences(view) {
    for (const [id, offset] of [
      [0, 32],
      [1, 38],
    ]) {
      await view.locator('[data-node-id=n' + id + ']').click()
      await expect(view.locator('mark')).toHaveAttribute('data-offset', String(offset))
      await expect(view.locator('mark')).toHaveText(quote)
    }
    for (const id of [2, 3]) {
      await view.locator('[data-node-id=n' + id + ']').click()
      await expect(view.getByText('原文有多处匹配', { exact: true })).toBeVisible()
      await expect(view.locator('mark')).toHaveCount(0)
      await view.getByRole('button', { name: '查看第一处' }).click()
      await expect(view.locator('mark')).toHaveAttribute('data-offset', '32')
      await view.getByRole('button', { name: '查看下一处' }).click()
      await expect(view.locator('mark')).toHaveAttribute('data-offset', '38')
    }
  }
  await checkReferences(region)
  const output = path.join(profile, '重复引用.html')
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, output)
  await region.getByRole('button', { name: '导出 HTML' }).click()
  await expect
    .poll(async () => {
      try {
        return (await readFile(output)).length > 0
      } catch {
        return false
      }
    })
    .toBe(true)
  await page.goto(pathToFileURL(output).href)
  await checkReferences(page)
  console.log('PASS duplicate references 32, 38 and ambiguous, embedded and HTML', profile)
} finally {
  await app.close()
}
