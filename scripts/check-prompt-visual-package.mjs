import assert from 'node:assert/strict'
import path from 'node:path'
import { access, mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { prepareProduct } from './prepare-package.mjs'

await mkdir('tmp', { recursive: true })
const scratch = await mkdtemp(path.resolve('tmp/staged-visual-'))
for (const product of ['prompts', 'workbench']) {
  const { app } = await prepareProduct(product)
  const host = path.join(app, 'host')
  for (const file of ['LICENSE', 'LICENSE-MIT', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) {
    await access(path.join(host, 'archify', file))
  }
  await access(path.join(app, product === 'prompts' ? 'prompts' : 'workbench', 'index.html'))
  const manifest = JSON.parse(await readFile(path.join(app, 'package.json'), 'utf8'))
  await access(path.join(app, manifest.main))
  const { promptVisuals } = await import(pathToFileURL(path.join(host, 'prompt-visuals.mjs')).href)
  const text = 'Read. Save.'
  const data = {
    kind: 'flow',
    nodes: [{ quote: 'Read' }, { quote: 'Save' }],
    edges: [{ from: 0, to: 1, quote: text }],
  }
  const run = promptVisuals(
    path.join(scratch, product),
    { read: async () => ({ text, revision: 'one' }) },
    async () => JSON.stringify(data),
  )
  const result = await run(scratch, 'sample.md', true)
  assert.match(result.svg, /data-node-id="n1"/)
  assert.match(result.html, /archify-software-notices/)
  console.log('PASS', product, manifest.version, manifest.main, scratch)
}
