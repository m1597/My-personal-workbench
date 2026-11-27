import assert from 'node:assert/strict'
import path from 'node:path'
import { access, mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { prepareProduct } from './prepare-package.mjs'

await mkdir('tmp', { recursive: true })
const scratch = await mkdtemp(path.resolve('tmp/staged-visual-'))
for (const product of ['prompts', 'workbench']) {
  const root = process.argv[2]
  const app = root
    ? path.join(root, product === 'prompts' ? 'Prompts' : '', 'resources/app')
    : (await prepareProduct(product)).app
  const host = path.join(app, 'host')
  for (const file of [
    'LICENSE',
    'LICENSE-MIT',
    'NOTICE',
    'THIRD_PARTY_NOTICES.md',
    'assets/template.html',
    'assets/JetBrainsMono-OFL.txt',
  ]) {
    await access(path.join(host, 'archify', file))
  }
  await access(path.join(app, product === 'prompts' ? 'prompts' : 'workbench', 'index.html'))
  const manifest = JSON.parse(await readFile(path.join(app, 'package.json'), 'utf8'))
  await access(path.join(app, manifest.main))
  const { promptVisuals, standaloneReader } = await import(
    pathToFileURL(path.join(host, 'prompt-visuals.mjs')).href
  )
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
  const reader = standaloneReader(result, 'sample.md')
  assert.match(reader, /archify-i18n-data/)
  assert.match(reader, /prompt-original/)
  console.log('PASS', product, manifest.version, manifest.main, scratch)
}
