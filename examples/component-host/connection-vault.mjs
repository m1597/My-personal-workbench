import { createRequire } from 'node:module'

let native
function dpapi() {
  if (native) return native
  const ffi = createRequire(import.meta.url)('koffi')
  const blob = ffi.struct({ cbData: 'uint32_t', pbData: 'void *' })
  const crypto = ffi.load('crypt32.dll')
  const args = [
    ffi.pointer(blob),
    'void *',
    'void *',
    'void *',
    'void *',
    'uint32_t',
    ffi.out(ffi.pointer(blob)),
  ]
  const protect = crypto.func('__stdcall', 'CryptProtectData', 'int32_t', args)
  const unprotect = crypto.func('__stdcall', 'CryptUnprotectData', 'int32_t', args)
  const free = ffi.load('kernel32.dll').func('void * __stdcall LocalFree(void *)')
  const crt = ffi.load('ucrtbase.dll')
  const wipe = crt.func('void * memset(void *, int, size_t)')
  const copy = crt.func('void * memcpy(void *, const void *, size_t)')
  function transform(operation, bytes) {
    const out = {}
    if (!operation({ cbData: bytes.length, pbData: bytes }, null, null, null, null, 1, out))
      throw Error('无法使用 Windows 用户凭据保护')
    try {
      const result = Buffer.alloc(out.cbData)
      copy(result, out.pbData, out.cbData)
      return result
    } finally {
      if (operation === unprotect) wipe(out.pbData, 0, out.cbData)
      free(out.pbData)
    }
  }
  native = {
    encryptString(value) {
      const bytes = Buffer.from(value, 'utf8')
      try {
        return transform(protect, bytes)
      } finally {
        bytes.fill(0)
      }
    },
    decryptString(cipher) {
      const bytes = transform(unprotect, cipher)
      try {
        return bytes.toString('utf8')
      } finally {
        bytes.fill(0)
      }
    },
  }
  return native
}

// Chromium safeStorage keys differ across Electron userData roots. Version-tagged,
// current-user DPAPI blobs are readable by the separately installed FitBay processes.
const prefix = Buffer.from('FitBay-DPAPI-1\0')
export function sharedConnectionVault(legacyVault) {
  if (process.platform !== 'win32') return legacyVault
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      return Buffer.concat([prefix, dpapi().encryptString(value)])
    },
    decryptString(cipher) {
      if (Buffer.from(cipher).subarray(0, prefix.length).equals(prefix))
        return dpapi().decryptString(cipher.subarray(prefix.length))
      return legacyVault.decryptString(cipher)
    },
  }
}
