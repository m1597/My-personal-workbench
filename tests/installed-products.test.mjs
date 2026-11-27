import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { installedProducts } from '../examples/component-host/installed-products.mjs'

test('registered workbench uses the external component even with a complete stale sibling', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fitbay-discovery-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const host = path.join(root, 'resources/app')
  const sibling = path.join(root, 'Toolkit/resources/app')
  for (const [dir, id] of [
    [host, 'workbench'],
    [sibling, 'toolkit'],
  ]) {
    await mkdir(dir, { recursive: true })
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ fitbayProduct: id, version: '0.2.8' }),
    )
  }
  await writeFile(path.join(root, 'Toolkit/FitBay Toolkit.exe'), '')
  await writeFile(path.join(sibling, 'main.mjs'), '')
  const registrations = new Map([
    ['workbench', await realpath(host)],
    ['toolkit', path.join(root, 'Other drive', 'resources/app')],
  ])
  const product = await installedProducts(host, async (id) => registrations.get(id))
  assert.equal(await product.find('toolkit'), registrations.get('toolkit'))
  registrations.delete('toolkit')
  assert.equal(await product.find('toolkit'), undefined)
  registrations.set('workbench', path.join(root, 'Installed workbench/resources/app'))
  assert.equal(await product.find('toolkit'), await realpath(sibling))
})
