import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
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
export async function installedToolkitRoot(packaged) {
  const root = packaged
    ? await registeredProduct('toolkit')
    : path.resolve(import.meta.dirname, '../../../components/toolkit')
  if (!root || !existsSync(path.join(root, 'main.mjs'))) return
  if (packaged && !existsSync(path.resolve(root, '../../FitBay Toolkit.exe'))) return
  return root
}
export async function toolkitLauncher(packaged, profile) {
  const root = await installedToolkitRoot(packaged)
  if (!root) return
  const cmd = packaged ? path.resolve(root, '../../FitBay Toolkit.exe') : process.execPath
  const args = packaged ? [] : [root]
  await migrateOnce(profile, root, cmd, args)
  return (capture) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        cmd,
        [...args, '--workbench-profile=' + profile, ...(capture ? ['--toolkit-capture'] : [])],
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
