import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { registeredProduct } from './installed-products.mjs'
export async function toolkitLauncher(packaged, profile) {
  let cmd = process.execPath,
    args = []
  if (packaged) {
    const root = await registeredProduct('toolkit')
    if (!root) return
    cmd = path.resolve(root, '../../FitBay Toolkit.exe')
    if (!existsSync(cmd)) return
  } else {
    const directory = path.resolve(import.meta.dirname, '../../../components/toolkit')
    if (!existsSync(path.join(directory, 'main.mjs'))) return
    args = [directory]
  }
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
