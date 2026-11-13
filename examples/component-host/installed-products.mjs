import { readFile, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

const registry = 'Software\\FitBay\\Installations'
const names = { workbench: 'Workbench', music: 'Music' }
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

export async function registeredProduct(id) {
  const name = names[id]
  try {
    const directory = installDirectory(name)
    if (!path.isAbsolute(directory)) return undefined
    const root = await realpath(path.join(directory, 'resources/app'))
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
    return pkg.fitbayProduct === id ? root : undefined
  } catch {
    return undefined
  }
}

export async function installedProducts(applicationRoot) {
  const { fitbayProduct: product } = JSON.parse(
    await readFile(path.join(applicationRoot, 'package.json'), 'utf8'),
  )
  if (!Object.hasOwn(names, product)) throw Error('安装包的产品标识无效')
  return { product, find: (id) => (id === product ? applicationRoot : registeredProduct(id)) }
}
