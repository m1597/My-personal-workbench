import { readFile, realpath, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

const registry = 'Software\\FitBay\\Installations'
const names = { toolkit: 'Toolkit', workbench: 'Workbench', music: 'Music', prompts: 'Prompts' }
let readValue
function installDirectory(name) {
  if (!readValue) {
    const ffi = createRequire(import.meta.url)('koffi')
    readValue = ffi
      .load('advapi32.dll')
      .func(
        'int32_t __stdcall RegGetValueW(intptr_t, str16, str16, uint32_t, void *, void *, _Inout_ uint32_t *)',
      )
  }
  // HKCU, 64-bit view, REG_SZ only. Read UTF-16 without a shell or locale conversion.
  const data = Buffer.alloc(65536)
  const size = [data.length]
  if (readValue(-2147483647, registry, name, 0x10002, null, data, size) !== 0) return ''
  return data.toString('utf16le', 0, Math.max(size[0] - 2, 0))
}

async function productAt(directory, id, local = false) {
  if (!directory || !path.isAbsolute(directory)) return
  try {
    const expected = path.join(directory, 'resources/app')
    const root = await realpath(expected)
    if (local && path.relative(expected, root)) return
    const exe = id === 'workbench' ? 'FitBay.exe' : `FitBay ${names[id]}.exe`
    const entry =
      id === 'toolkit'
        ? 'main.mjs'
        : id === 'workbench'
          ? 'workbench/index.html'
          : `${id}/component.json`
    if (
      ['music', 'prompts'].includes(id) &&
      !(await stat(path.join(root, id, 'index.html'))).isFile()
    )
      return
    if (id === 'music' && !(await stat(path.join(root, 'host/music-service.mjs'))).isFile()) return
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
    if (
      pkg.fitbayProduct === id &&
      typeof pkg.version === 'string' &&
      pkg.version &&
      (await stat(path.join(directory, exe))).isFile() &&
      (await stat(path.join(root, entry))).isFile()
    )
      return root
  } catch {
    // Incomplete or stale installations are not launchable.
  }
}

export async function registeredProduct(id) {
  const name = names[id]
  try {
    const directory = installDirectory(name)
    return productAt(directory, id, true)
  } catch {
    return undefined
  }
}

export async function installedProducts(applicationRoot) {
  const { fitbayProduct: product } = JSON.parse(
    await readFile(path.join(applicationRoot, 'package.json'), 'utf8'),
  )
  if (!Object.hasOwn(names, product)) throw Error('安装包的产品标识无效')
  async function find(id) {
    if (id === product) return applicationRoot
    if (!Object.hasOwn(names, id)) return
    if (product === 'workbench') {
      const parent = await realpath(path.resolve(applicationRoot, '../..'))
      for (const name of [names[id], 'FitBay ' + names[id]]) {
        const root = await productAt(path.join(parent, name), id, true)
        if (root) return root
      }
    }
    return registeredProduct(id)
  }
  return { product, find, registered: registeredProduct }
}
