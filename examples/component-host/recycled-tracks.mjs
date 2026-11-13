import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { fileIdentity, pathKey } from './music/local-files.mjs'

let sid
async function currentSid() {
  if (!sid) {
    const { stdout } = await promisify(execFile)('whoami.exe', ['/user', '/fo', 'csv', '/nh'], {
      windowsHide: true,
    })
    sid = stdout.match(/"(S-1-[0-9-]+)"\s*$/iu)?.[1]
  }
  return sid
}

async function originalPath(info) {
  if (!(await lstat(info)).isFile()) return ''
  const handle = await open(info, 'r')
  try {
    const buffer = Buffer.alloc(65568)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (bytesRead < 28) return ''
    const version = buffer.readBigUInt64LE()
    const start = version === 2n ? 28 : 24
    if (version !== 2n && version !== 1n) return ''
    const length = version === 2n ? buffer.readUInt32LE(24) * 2 : 520
    if (!length || start + length > bytesRead) return ''
    return buffer.toString('utf16le', start, start + length).split('\0', 1)[0]
  } finally {
    await handle.close()
  }
}

async function matches(entry, identity) {
  const info = await lstat(entry, { bigint: true }).catch(() => null)
  return (
    info?.isFile() &&
    fileIdentity(info) === identity &&
    pathKey(await realpath(entry).catch(() => '')) === pathKey(entry)
  )
}

export async function reconcileRecycled(store, forget) {
  if (process.platform !== 'win32') return
  const missing = store.db
    .prepare(
      'SELECT id,file,fileIdentity FROM local_tracks WHERE available=0 AND awaitingLocation=0 AND fileIdentity IS NOT NULL',
    )
    .all()
  if (!missing.length) return
  const user = await currentSid().catch(() => null)
  if (!user) return
  const unchanged = store.db.prepare(
    'SELECT 1 FROM local_tracks WHERE id=? AND file=? AND fileIdentity=? AND available=0 AND awaitingLocation=0',
  )
  for (const [volume, rows] of Map.groupBy(missing, (row) => path.parse(row.file).root)) {
    if (!/^[a-z]:[\\/]$/i.test(volume)) continue
    const bin = path.join(volume, '$Recycle.Bin', user)
    if (pathKey(await realpath(bin).catch(() => '')) !== pathKey(bin)) continue
    // Look up only indexed paths under recycled directories. Never walk their contents.
    const indexedIdentities = new Set(rows.map((row) => row.fileIdentity))
    const byPath = Map.groupBy(rows, (row) => pathKey(row.file))
    const byAncestor = new Map()
    for (const row of rows) {
      for (let dir = path.dirname(row.file); dir !== volume; dir = path.dirname(dir)) {
        const key = pathKey(dir)
        if (!byAncestor.has(key)) byAncestor.set(key, [])
        byAncestor.get(key).push(row)
      }
    }
    const entries = await readdir(bin, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!/^\$R/i.test(entry.name) || (!entry.isDirectory() && !entry.isFile())) continue
      if (entry.isFile()) {
        const stat = await lstat(path.join(bin, entry.name), { bigint: true }).catch(() => null)
        if (!indexedIdentities.has(fileIdentity(stat))) continue
      }
      const original = await originalPath(path.join(bin, '$I' + entry.name.slice(2))).catch(
        () => '',
      )
      if (!original || !path.isAbsolute(original)) continue
      const candidates = (entry.isDirectory() ? byAncestor : byPath).get(pathKey(original)) ?? []
      for (const row of candidates) {
        const recycled = path.join(bin, entry.name, path.relative(original, row.file))
        if (!(await matches(recycled, row.fileIdentity))) continue
        try {
          await lstat(row.file)
          continue
        } catch (e) {
          if (e.code !== 'ENOENT') continue
        }
        if (unchanged.get(row.id, row.file, row.fileIdentity)) forget([row.id])
      }
    }
  }
}
