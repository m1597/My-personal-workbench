import path from 'node:path'
import { lstatSync } from 'node:fs'
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
// A Windows drive letter may map to a directory (SUBST). Reject links below that drive.
export async function isDirectPath(file) {
  const actual = pathKey(await realpath(file))
  if (actual === pathKey(file)) return true
  const root = path.parse(path.resolve(file)).root
  return (
    process.platform === 'win32' &&
    actual === pathKey(path.join(await realpath(root), path.relative(root, file)))
  )
}
const volumeKey = (stat) => [stat.dev, stat.ino, stat.birthtimeNs].join(':')
export async function volumeIdentity(file) {
  try {
    return volumeKey(await lstat(path.parse(path.resolve(file)).root, { bigint: true }))
  } catch {
    return null
  }
}
// Synchronous DB writers without worker metadata still need to validate a subscribed volume.
export function currentVolumeIdentity(file) {
  try {
    return volumeKey(lstatSync(path.parse(path.resolve(file)).root, { bigint: true }))
  } catch {
    return null
  }
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
    return info.size > 0n && info.isFile() && (await isDirectPath(file)) ? info : null
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

export async function openAudio(file, expectedIdentity) {
  if (!(await regularFile(file))) throw Error('文件不可用')
  const entry = await lstat(file, { bigint: true })
  const handle = await open(file, 'r')
  try {
    const actual = await handle.stat({ bigint: true })
    if (
      !actual.isFile() ||
      (expectedIdentity && fileIdentity(actual) !== expectedIdentity) ||
      actual.ino !== entry.ino ||
      actual.dev !== entry.dev ||
      !(await isDirectPath(file))
    )
      throw Error('文件已变化')
    return handle
  } catch (e) {
    await handle.close()
    throw e
  }
}
