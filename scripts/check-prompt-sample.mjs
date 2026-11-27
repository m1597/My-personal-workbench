import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { mkdtemp, mkdir, cp, readFile, writeFile, unlink } from 'node:fs/promises'
import { _electron, expect } from '@playwright/test'
import { openConnections } from '../examples/component-host/api-connections.mjs'

// Run only with the sample file and a profile whose prompts.model is approved for this test.
const [source, approvedProfile] = process.argv.slice(2)
if (!source || !approvedProfile) throw Error('需要样例文件路径和已授权的测试连接 profile')
await mkdir('tmp', { recursive: true })
const evidence = await mkdtemp(path.resolve('tmp/prompt-real-')),
  root = path.join(evidence, 'docs'),
  profile = path.join(evidence, 'profile')
await mkdir(root)
await cp(source, path.join(root, path.basename(source)))
await mkdir(path.join(profile, 'prompt-library'), { recursive: true })
await writeFile(
  path.join(profile, 'prompt-library/catalogue-preferences.json'),
  JSON.stringify({ defaultRoot: root, shortcut: 'F20', shortcutEnabled: false }),
)
const dbName = 'api-connections.sqlite'
const original = new DatabaseSync(path.join(approvedProfile, dbName), { readOnly: true })
let connection
try {
  connection = original
    .prepare(
      "SELECT c.* FROM bindings b JOIN connections c ON c.id=b.connection WHERE b.use IN ('prompts.model','default') ORDER BY CASE b.use WHEN 'prompts.model' THEN 0 ELSE 1 END LIMIT 1",
    )
    .get()
} finally {
  original.close()
}
if (!connection?.secret) throw Error('获准 profile 未配置提示词库可用连接')
openConnections(profile).close()
const tmpDb = path.join(profile, dbName)
const dest = new DatabaseSync(tmpDb)
try {
  dest
    .prepare('INSERT INTO connections(id,endpoint,model,secret,protocol) VALUES (?,?,?,?,?)')
    .run(
      connection.id,
      connection.endpoint,
      connection.model,
      connection.secret,
      connection.protocol,
    )
  dest
    .prepare('INSERT INTO bindings(use,connection) VALUES (?,?)')
    .run('prompts.model', connection.id)
} finally {
  dest.close()
  connection.secret.fill(0)
}
const launch = () =>
  _electron.launch({
    args: [
      path.resolve('dist/component-prototype/host'),
      '--mode=prompts',
      '--workbench=' + path.resolve('out/renderer/index.html'),
      '--user-data-dir=' + profile,
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
let app
try {
  app = await launch()
  async function open() {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: '修复分窗收起问题', exact: true }).click()
    return page
  }
  await app.evaluate(() => {
    const fetch = globalThis.fetch
    globalThis.sampleRequests = 0
    globalThis.fetch = (...args) => {
      globalThis.sampleRequests++
      return fetch(...args)
    }
  })
  let page = await open()
  await page.getByRole('button', { name: '生成可视化', exact: true }).click()
  const node = page.locator('svg [data-node-id]').first()
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          document.querySelector('svg [data-node-id]')
            ? 'ready'
            : document.querySelector('[aria-label="提示词可视化"] [role=status]')?.textContent ||
              'waiting',
        ),
      { timeout: 150000 },
    )
    .not.toBe('waiting')
  await expect(node).toBeVisible()
  const count = await page.locator('svg [data-node-id]').count()
  await node.click()
  const mark = page.locator('.reader-content mark')
  await expect(mark).toBeVisible()
  const quote = await mark.textContent()
  assert(quote && (await readFile(source, 'utf8')).includes(quote))
  const requests = await app.evaluate(() => globalThis.sampleRequests)
  assert.equal(requests, 1)
  await page.locator('.visual-reader').screenshot({ path: path.join(evidence, 'real.png') })
  await app.close()
  app = await launch()
  await app.evaluate(() => {
    globalThis.sampleRequests = 0
    globalThis.fetch = () => {
      globalThis.sampleRequests++
      throw Error('测试禁止重复联网')
    }
  })
  page = await open()
  await expect(page.locator('svg [data-node-id]')).toHaveCount(count)
  assert.equal(await app.evaluate(() => globalThis.sampleRequests), 0)
  console.log(
    'PASS selected model connection,',
    count,
    'nodes, first/restart requests 1/0',
    evidence,
  )
} finally {
  try {
    await app?.close()
  } finally {
    await unlink(tmpDb)
  }
}
