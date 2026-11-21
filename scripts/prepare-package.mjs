import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const project = process.cwd()
const prototype = path.resolve('dist/component-prototype')
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'))
const pkg = JSON.parse(await readFile('package.json', 'utf8'))

const commonHostFiles = [
  'main.mjs',
  'toolkit-launcher.mjs',
  'product-updates.mjs',
  'component-installation.mjs',
  'api-connections.mjs',
  'music-connection.mjs',
  'connection-vault.mjs',
  'installed-products.mjs',
  'music-installer.mjs',
  'component-view.mjs',
  'prompt-actions.mjs',
  'file-browser.mjs',
  'prompt-library.mjs',
  'prompt-palette.mjs',
  'prompt-preload.cjs',
  'music-thumbnails.mjs',
  'transport-icons.png',
  'builtin-windows.mjs',
  'builtin-preload.cjs',
  'workbench-preload.cjs',
  'native-dock.mjs',
  'fitbay.png',
]
const fallbackLicenses = {
  '@fluentui/react-icons': 'resources/licenses/fluentui-system-icons.txt',
  'embla-carousel': 'resources/licenses/embla-carousel.txt',
  'embla-carousel-autoplay': 'resources/licenses/embla-carousel.txt',
  'embla-carousel-fade': 'resources/licenses/embla-carousel.txt',
  '@tokenizer/token': 'node_modules/@tokenizer/token/README.md',
}
async function notices() {
  const lines = [
    'Third-party notices. Electron and Chromium notices are included beside the executable.',
  ]
  for (const [dir, info] of Object.entries(lock.packages)) {
    if (!dir || info.dev || (!existsSync(dir) && info.optional)) continue
    const metadata = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'))
    const files = (await readdir(dir)).filter((f) => /^(licen[cs]e|copying|notice)(\.|$)/i.test(f))
    const fallback = fallbackLicenses[metadata.name]
    if (!files.length && !fallback) throw Error(`缺少依赖许可证：${metadata.name}`)
    lines.push(`\n===== ${metadata.name}@${metadata.version} =====`)
    for (const f of files) lines.push(await readFile(path.join(dir, f), 'utf8'))
    if (!files.length) lines.push(await readFile(fallback, 'utf8'))
  }
  return `${lines.join('\n')}\n`
}
// Retain npm's locked hoisted/nested layout, including the installed Windows native binary.
async function stageModules(dest, roots) {
  const seen = new Set()
  async function add(parent, name, optional) {
    let folder = parent
    let dir
    while (folder === project || folder.startsWith(project + path.sep)) {
      const candidate = path.join(folder, 'node_modules', name)
      if (existsSync(path.join(candidate, 'package.json'))) {
        dir = candidate
        break
      }
      folder = path.dirname(folder)
    }
    if (!dir && optional) return
    if (!dir) throw Error(`缺少宿主运行依赖：${name}`)
    if (seen.has(dir)) return
    seen.add(dir)
    const rel = path.relative(project, dir)
    if (!lock.packages[rel.split(path.sep).join('/')]) throw Error(`运行依赖未锁定：${rel}`)
    await cp(dir, path.join(dest, rel), {
      recursive: true,
      filter: (f) => f === dir || path.basename(f) !== 'node_modules',
    })
    const meta = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'))
    for (const dep of Object.keys(meta.dependencies || {})) await add(dir, dep, false)
    for (const dep of Object.keys(meta.optionalDependencies || {})) await add(dir, dep, true)
  }
  for (const name of roots) await add(project, name, false)
}

export async function prepareProduct(product) {
  if (product === 'toolkit') {
    const stage = path.resolve('.cache/fitbay-package/toolkit')
    const app = path.join(stage, 'app')
    await rm(stage, { recursive: true, force: true })
    await cp('components/toolkit', app, { recursive: true })
    const tokens = 'src/renderer/src/styles/tokens.css'
    await cp(tokens, path.join(app, 'tokens.css'))
    const html = path.join(app, 'index.html')
    await writeFile(html, (await readFile(html, 'utf8')).replace('../../' + tokens, 'tokens.css'))
    const manifest = path.join(app, 'package.json')
    const metadata = JSON.parse(await readFile(manifest, 'utf8'))
    await writeFile(manifest, JSON.stringify({ ...metadata, version: pkg.version }, null, 2) + '\n')
    await cp('src/renderer/public/fitbay.png', path.join(app, 'fitbay.png'))
    for (const f of [
      'api-connections.mjs',
      'connection-vault.mjs',
      'prompt-actions.mjs',
      'installed-products.mjs',
    ])
      await cp(path.join('examples/component-host', f), path.join(app, f))
    await cp('LICENSE', path.join(app, 'LICENSE'))
    const modules = path.join(stage, 'runtime')
    await stageModules(modules, ['koffi'])
    return { app, modules: path.join(modules, 'node_modules'), version: pkg.version }
  }
  if (!['music', 'workbench', 'prompts'].includes(product)) throw Error('未知产品')
  const music = product === 'music'
  const stage = path.resolve('.cache', 'fitbay-package', product)
  await rm(stage, { recursive: true, force: true })
  const app = path.join(stage, 'app')
  await mkdir(path.join(app, 'host'), { recursive: true })
  if (music) {
    const hostFiles = await readdir('examples/component-host', { withFileTypes: true })
    for (const entry of hostFiles) {
      if (entry.isFile() && entry.name !== 'sample-preload.cjs')
        await cp(path.join(prototype, 'host', entry.name), path.join(app, 'host', entry.name))
    }
    await cp(path.join(prototype, 'host/fitbay.png'), path.join(app, 'host/fitbay.png'))
    await mkdir(path.join(app, 'host/music'))
    for (const file of [
      'offline-source.mjs',
      'store.mjs',
      'local-files.mjs',
      'albums.mjs',
      'library-worker.mjs',
      'local-library.mjs',
    ])
      await cp(path.join(prototype, 'host/music', file), path.join(app, 'host/music', file))
    await cp(path.join(prototype, 'music'), path.join(app, 'music'), { recursive: true })
    await mkdir(path.join(app, 'scripts'))
    await cp('scripts/music-source-mcp.mjs', path.join(app, 'scripts/music-source-mcp.mjs'))
  } else {
    for (const f of commonHostFiles)
      await cp(path.join(prototype, 'host', f), path.join(app, 'host', f))
    if (product === 'prompts')
      await cp(path.join(prototype, 'prompts'), path.join(app, 'prompts'), { recursive: true })
    else await cp('out/renderer', path.join(app, 'workbench'), { recursive: true })
  }
  await cp(path.join(prototype, 'host/toolkit-local'), path.join(app, 'host/toolkit-local'), {
    recursive: true,
  })
  await cp('LICENSE', path.join(app, 'LICENSE'))
  await writeFile(path.join(app, 'THIRD_PARTY_NOTICES.txt'), await notices())
  await writeFile(
    path.join(app, 'package.json'),
    `${JSON.stringify(
      {
        name: `fitbay-${product}`,
        version: pkg.version,
        type: 'module',
        main: 'host/main.mjs',
        fitbayProduct: product,
        description: music ? 'FitBay 独立音乐组件' : 'FitBay 个人工作台',
        author: 'MON.',
        license: 'MIT',
      },
      null,
      2,
    )}\n`,
  )
  const modules = path.join(stage, 'runtime')
  await stageModules(
    modules,
    music ? ['koffi', 'ipaddr.js', 'music-metadata', 'quickjs-emscripten'] : ['koffi'],
  )
  return { app, modules: path.join(modules, 'node_modules'), version: pkg.version }
}
