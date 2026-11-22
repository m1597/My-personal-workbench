import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  selectUpdate,
  saveInstaller,
  products,
  updateCatalog,
} from '../examples/component-host/product-updates.mjs'

const name = 'FitBay-Music-Setup-0.10.0-x64.exe'
const data = Buffer.from('installer fixture')
const asset = {
  name,
  size: data.length,
  digest: 'sha256:' + createHash('sha256').update(data).digest('hex'),
  browser_download_url:
    'https://github.com/m1597/My-personal-workbench/releases/download/v0.10.0/' + name,
}
const release = { tag_name: 'v0.10.0', assets: [asset] }
test('selects a newer stable installer for the installed product only', () => {
  assert.ok(selectUpdate(release, 'music', '0.9.0'))
  for (const version of ['0.10.0', '1.0.0'])
    assert.equal(selectUpdate(release, 'music', version), undefined)
  assert.equal(selectUpdate(release, 'workbench', '0.1.0'), undefined)
  assert.equal(selectUpdate({ ...release, prerelease: true }, 'music', '0.1.0'), undefined)
})
test('rejects damaged installer and cleans partial file before retry', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'fitbay-test-'))
  try {
    const update = selectUpdate(release, 'music', '0.1.0')
    await assert.rejects(
      saveInstaller(update, dir, async () => new Response(Buffer.alloc(data.length))),
    )
    assert.deepEqual(await readdir(dir), [])
    assert.deepEqual(
      await readFile(await saveInstaller(update, dir, async () => new Response(data))),
      data,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('batch keeps the host alive after a component failure and retries only that component', async () => {
  const versions = new Map(Object.keys(products).map((id) => [id, '0.9.0']))
  const launches = []
  let fail = true
  const assets = Object.values(products).map((label) => ({
    ...asset,
    name: name.replace('Music', label),
    browser_download_url: asset.browser_download_url.replace('Music', label),
  }))
  const service = updateCatalog({
    inventory: async () =>
      Array.from(versions, ([id, version]) => ({ id, version, installable: true })),
    request: async () => Response.json({ ...release, assets }),
    launch: async (update, id, report) => {
      launches.push(id)
      report('installing')
      if (id === 'prompts' && fail) throw Error()
      versions.set(id, update.version)
    },
  })
  await service.check()
  await service.installAll()
  assert.deepEqual(launches, ['music', 'prompts', 'toolkit'])
  await service.check()
  assert.equal(
    (await service.snapshot()).rows.find((row) => row.id === 'prompts').operation.stage,
    'failed',
  )
  fail = false
  await service.install('prompts')
  await service.installAll()
  assert.deepEqual(launches, ['music', 'prompts', 'toolkit', 'prompts', 'workbench'])
})

test('a restarted host offers retry when a silent update left the original version', async () => {
  const host = {
    ...asset,
    name: asset.name.replace('Music', 'Workbench'),
    browser_download_url: asset.browser_download_url.replace('Music', 'Workbench'),
  }
  const service = updateCatalog({
    previousSelfUpdate: '0.10.0',
    inventory: async () => [{ id: 'workbench', version: '0.9.0', installable: true }],
    request: async () => Response.json({ ...release, assets: [host] }),
  })
  await service.check()
  assert.equal((await service.snapshot()).rows[0].operation.stage, 'failed')
})
