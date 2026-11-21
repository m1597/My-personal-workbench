import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { registeredProduct } from './installed-products.mjs'
// Workbench may open its API settings before the upgraded component is launched.
const migrations = new Map()
async function migrateOnce(profile, root, cmd, args) {
  if (!existsSync(path.join(root, 'toolkit-connections.mjs'))) return
  if (!migrations.has(profile))
    migrations.set(
      profile,
      (async () => {
        let previous
        try {
          previous = JSON.parse(await readFile(path.join(profile, 'toolkit/settings.json'), 'utf8'))
        } catch {
          return
        }
        if (!previous?.model || !previous.endpoint) return
        await new Promise((resolve) => {
          const helper = spawn(
            cmd,
            [...args, '--workbench-profile=' + profile, '--toolkit-migrate-connections'],
            { windowsHide: true, stdio: 'ignore' },
          )
          helper.once('error', resolve)
          helper.once('exit', resolve)
        })
      })(),
    )
  await migrations.get(profile)
}
export async function installedToolkitRoot(packaged, installation) {
  const root = packaged
    ? await (installation ? installation.find('toolkit') : registeredProduct('toolkit'))
    : path.resolve(import.meta.dirname, '../../../components/toolkit')
  if (!root || !existsSync(path.join(root, 'main.mjs'))) return
  if (packaged && !existsSync(path.resolve(root, '../../FitBay Toolkit.exe'))) return
  return root
}
export async function toolkitLauncher(packaged, profile, installation) {
  const root = await installedToolkitRoot(packaged, installation)
  if (!root) return
  const cmd = packaged ? path.resolve(root, '../../FitBay Toolkit.exe') : process.execPath
  const args = packaged ? [] : [root]
  await migrateOnce(profile, root, cmd, args)
  return (capture, page, requestId) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        cmd,
        [
          ...args,
          '--workbench-profile=' + profile,
          ...(capture ? ['--toolkit-capture'] : []),
          ...(page ? ['--toolkit-page=' + page] : []),
          ...(requestId ? ['--toolkit-batch=' + requestId] : []),
        ],
        {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        },
      )
      child.once('error', reject)
      child.once('spawn', () => {
        child.unref()
        resolve(true)
      })
    })
}

export async function toolkitShortcutRequest(launch, profile, value) {
  if (
    value !== null &&
    (!['capture', 'selection'].includes(value?.id) ||
      typeof value.key !== 'string' ||
      value.key.length > 100 ||
      typeof value.enabled !== 'boolean')
  )
    throw Error('无效快捷键')
  const id = randomUUID(),
    dir = path.join(profile, 'toolkit'),
    file = path.join(dir, 'shortcuts-' + id)
  await mkdir(dir, { recursive: true })
  await writeFile(
    file,
    JSON.stringify(
      value === null ? null : { id: value.id, key: value.key, enabled: value.enabled },
    ),
    { flag: 'wx' },
  )
  try {
    await launch(false, 'shortcuts-' + id)
    for (let i = 0; i < 100; i++) {
      let result
      try {
        result = JSON.parse(await readFile(file + '.reply', 'utf8'))
      } catch (e) {
        if (e.code !== 'ENOENT') throw e
      }
      if (result) {
        if (result.error) throw Error(result.error)
        return result.settings
      }
      await delay(100)
    }
    throw Error('工具集未响应，请重新打开设置')
  } finally {
    await Promise.all([file, file + '.reply'].map((p) => rm(p, { force: true })))
  }
}
