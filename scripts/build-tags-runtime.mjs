import path from 'node:path'
import { access, readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { rolldown } from 'rolldown'

const plugin = fileURLToPath(new URL('../components/music/plugins/tags/', import.meta.url))
export async function buildTagsRuntime() {
  const dependency = path.join(plugin, 'node_modules/taglib-wasm')
  try {
    await access(path.join(dependency, 'dist/taglib-web.wasm'))
  } catch {
    const cli =
      process.env.npm_execpath ||
      path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
    await promisify(execFile)(
      process.execPath,
      [cli, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'],
      { cwd: plugin, windowsHide: true },
    )
  }
  const dist = path.join(dependency, 'dist')
  const [binary, ...notices] = await Promise.all(
    ['dist/taglib-web.wasm', 'LICENSE', 'NOTICE', 'legal/COPYING.LGPL'].map((name) =>
      readFile(path.join(dependency, name)),
    ),
  )
  const bundle = await rolldown({
    input: 'fitbay-tag-runtime',
    platform: 'node',
    external: ['module', 'node:fs', 'node:path', 'node:module'],
    plugins: [
      {
        name: 'fitbay-tag-runtime',
        resolveId(id) {
          if (id === 'fitbay-tag-runtime') return '\0fitbay-tag-runtime'
          if (id === 'fitbay-taglib') return path.join(dist, 'index.browser.js')
        },
        load(id) {
          if (id === '\0fitbay-tag-runtime')
            return `import {TagLib} from 'fitbay-taglib'
          let runtime
          export function engine() { return runtime ??= TagLib.initialize({wasmBinary: Buffer.from('${binary.toString('base64')}', 'base64')}) }`
        },
      },
    ],
  })
  try {
    const { output } = await bundle.generate({ format: 'esm', codeSplitting: false })
    const notice = notices.map((item) => item.toString().replaceAll('*/', '* /')).join('\n')
    return '/*\n' + notice + '\n*/\n' + output[0].code
  } finally {
    await bundle.close()
  }
}
