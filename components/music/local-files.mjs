import path from 'node:path'
import { lstat, realpath, open, readdir } from 'node:fs/promises'
export const audioTypes = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
}
export function pathKey(file) {
  return path.resolve(file).toLowerCase()
}
export async function regularFile(file) {
  return (await audioFileSize(file)) !== null
}
export async function audioFileSize(file) {
  const stat = await audioFileStat(file)
  return stat ? Number(stat.size) : null
}
export async function audioFileStat(file) {
  if (!Object.hasOwn(audioTypes, path.extname(file).toLowerCase())) return null
  try {
    const info = await lstat(file, { bigint: true })
    return info.size > 0n && info.isFile() && pathKey(await realpath(file)) === pathKey(file)
      ? info
      : null
  } catch {
    return null
  }
}
export const fileIdentity = (stat) =>
  stat?.ino ? [stat.dev, stat.ino, stat.birthtimeNs].join(':') : null

// ENOENT can also mean an unavailable drive or a dangling directory link.
export async function confirmedMissing(file) {
  if (!path.isAbsolute(file)) return false
  let candidate = file
  let missingName
  for (;;) {
    let info
    try {
      info = await lstat(candidate)
    } catch (error) {
      if (error.code !== 'ENOENT') return false
      const parent = path.dirname(candidate)
      if (parent === candidate) return false
      missingName = path.basename(candidate).toLowerCase()
      candidate = parent
      continue
    }
    if (!missingName || !info.isDirectory()) return false
    try {
      if (pathKey(await realpath(candidate)) !== pathKey(candidate)) return false
      const entries = await readdir(candidate)
      return !entries.some((name) => name.toLowerCase() === missingName)
    } catch {
      return false
    }
  }
}

export async function openAudio(file) {
  if (!(await regularFile(file))) throw Error('文件不可用')
  const entry = await lstat(file, { bigint: true })
  const handle = await open(file, 'r')
  try {
    const actual = await handle.stat({ bigint: true })
    if (
      !actual.isFile() ||
      actual.ino !== entry.ino ||
      actual.dev !== entry.dev ||
      pathKey(await realpath(file)) !== pathKey(file)
    )
      throw Error('文件已变化')
    return handle
  } catch (e) {
    await handle.close()
    throw e
  }
}
