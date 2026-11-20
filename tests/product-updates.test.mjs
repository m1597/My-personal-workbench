import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { selectUpdate, saveInstaller } from '../examples/component-host/product-updates.mjs'

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
