import assert from 'node:assert/strict'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { _electron as electron, expect } from '@playwright/test'

// Install via the visible settings buttons on an ephemeral Windows runner.
// Before publication only the remote metadata and byte source use a local mirror.
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted')
assert.equal(process.env.RUNNER_OS, 'Windows')
const root = process.argv[2]
const profile = path.join(process.env.RUNNER_TEMP, 'settings-install-profile')
const assets = path.resolve('dist/installers')
const { version } = JSON.parse(await readFile('package.json', 'utf8'))
const products = ['Music', 'Prompts', 'Toolkit']
const repository = 'm1597/My-personal-workbench'
const tag = 'v' + version
const download = `https://github.com/${repository}/releases/download/${tag}/`
const latest = `https://api.github.com/repos/${repository}/releases/latest`
await mkdir(profile, { recursive: true })
let server, app
try {
  app = await electron.launch({
    executablePath: path.join(root, 'FitBay.exe'),
    args: ['--user-data-dir=' + profile],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
  if (process.argv.includes('--candidate')) {
    const sums = (await readFile(path.join(assets, 'SHA256SUMS.txt'), 'utf8')).trim().split(/\r?\n/)
    const manifest = { tag_name: tag, draft: false, prerelease: false, assets: [] }
    for (const product of products) {
      const name = `FitBay-${product}-Setup-${version}-x64.exe`
      const sum = sums.find((line) => line.endsWith('  ' + name))?.split('  ')[0]
      assert.match(sum, /^[a-f0-9]{64}$/)
      manifest.assets.push({
        name,
        size: (await stat(path.join(assets, name))).size,
        digest: 'sha256:' + sum,
        browser_download_url: download + name,
      })
    }
    server = createServer((request, response) => {
      const asset = manifest.assets.find((a) => request.url === '/' + a.name)
      if (!asset) {
        response.writeHead(404).end()
        return
      }
      response.writeHead(200, { 'content-length': asset.size })
      createReadStream(path.join(assets, asset.name)).pipe(response)
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    await app.evaluate(
      ({ net }, { latest, manifest, base }) => {
        const request = net.fetch.bind(net)
        net.fetch = (url, options) => {
          if (url === latest) return Promise.resolve(Response.json(manifest))
          const asset = manifest.assets.find((a) => a.browser_download_url === url)
          return request(asset ? base + asset.name : url, options)
        }
      },
      { latest, manifest, base: `http://127.0.0.1:${server.address().port}/` },
    )
  }
  const page = await app.firstWindow()
  await page.getByRole('button', { name: /^(工作台设置|Workbench settings)$/i }).click()
  await page.getByRole('button', { name: /^(组件管理|Components)$/ }).click()
  for (const product of products) {
    const row = page.locator(`[data-install-product="${product.toLowerCase()}"]`)
    await expect(row.getByRole('status')).toContainText(/未安装|Not installed/i)
  }
  for (const product of products) {
    const row = page.locator(`[data-install-product="${product.toLowerCase()}"]`)
    await row.getByRole('button').click()
    await expect
      .poll(
        async () => {
          const text = await row.getByRole('status').textContent()
          return /安装失败|Installation failed/i.test(text)
            ? text
            : text.includes(version)
              ? 'installed'
              : 'waiting'
        },
        { timeout: 360000, intervals: [1000, 2000] },
      )
      .not.toBe('waiting')
    await expect(row.getByRole('status')).toContainText(version)
    const file = path.join(root, product, 'resources/app/package.json')
    const pkg = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(pkg.fitbayProduct, product.toLowerCase())
    assert.equal(pkg.version, version)
    console.log(`PASS settings installed ${product} ${version} in ${path.join(root, product)}`)
  }
} finally {
  await app?.close()
  if (server) await new Promise((resolve) => server.close(resolve))
}
