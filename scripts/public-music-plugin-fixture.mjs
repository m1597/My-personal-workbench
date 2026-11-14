import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { expect } from '@playwright/test'
const catalog = JSON.parse(
  await readFile(
    new URL('../examples/component-host/plugin-catalog.json', import.meta.url),
    'utf8',
  ),
)
export const titles = Object.fromEntries(catalog.map((item) => [item.id, item.title]))
export async function checkDefaultCatalog(page) {
  const rows = await page.evaluate(() => window.musicPlugins.list())
  assert.deepEqual(rows.map((p) => p.id).sort(), ['path', 'rules', 'tags', 'wave'])
  assert.deepEqual(
    rows
      .filter((p) => p.remote)
      .map((p) => p.id)
      .sort(),
    ['rules', 'tags', 'wave'],
  )
  assert.ok(rows.every((p) => !p.installed))
  return rows
}
export async function checkInstalled(page, profile, ids) {
  const actual = await page.evaluate(async () =>
    (await window.musicPlugins.list())
      .filter((p) => p.installed)
      .map((p) => p.id)
      .sort(),
  )
  assert.deepEqual(actual, [...ids].sort())
  const folders = await readdir(path.join(profile, 'fitbay-music/plugins')).catch((e) => {
    if (e.code === 'ENOENT') return []
    throw e
  })
  assert.deepEqual(
    folders.sort(),
    catalog
      .filter((p) => ids.includes(p.id))
      .map((p) => p.id + '-' + p.digest)
      .sort(),
  )
}
export async function installPublic(app, page, profile, id) {
  const item = catalog.find((p) => p.id === id)
  assert.equal(new URL(item.url).hostname, 'github.com')
  const row = page.getByRole('article').filter({ hasText: item.title })
  await app.evaluate(() => {
    globalThis.publicPluginRequests = []
    if (!globalThis.publicPluginObserved) {
      globalThis.publicPluginObserved = true
      const original = globalThis.fetch
      globalThis.fetch = async (...args) => {
        const url = String(args[0])
        const response = await original(...args)
        if (url.includes('/releases/download/') && url.endsWith('.fitbayplugin'))
          globalThis.publicPluginRequests.push({ url, status: response.status })
        return response
      }
    }
  })
  await row.getByRole('button', { name: '下载安装', exact: true }).click()
  const open = row.getByRole('button', { name: '打开', exact: true })
  await expect(open).toBeVisible({ timeout: 90000 })
  assert.deepEqual(await app.evaluate(() => globalThis.publicPluginRequests), [
    { url: item.url, status: 200 },
  ])
  await checkInstalled(page, profile, [id])
  const folder = path.join(profile, 'fitbay-music/plugins', id + '-' + item.digest)
  for (const [name, digest] of Object.entries(item.files)) {
    assert.equal(
      createHash('sha256')
        .update(await readFile(path.join(folder, name)))
        .digest('hex'),
      digest,
    )
  }
  return row
}
export async function uninstallPublic(page, profile, id) {
  const row = page.getByRole('article').filter({ hasText: titles[id] })
  await row.getByRole('button', { name: '卸载', exact: true }).click()
  await expect(row.getByRole('button', { name: '下载安装', exact: true })).toBeVisible()
  await checkInstalled(page, profile, [])
}
