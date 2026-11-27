import { execFile } from 'node:child_process'
import { readFile, realpath, rm, rmdir } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { latestRelease, releaseInstaller, saveInstaller, products } from './product-updates.mjs'

const components = Object.keys(products).filter((id) => id !== 'workbench')
export const executeInstaller = promisify(execFile)
export function componentInstallation(installation, temp, request, execute = executeInstaller) {
  const states = new Map()
  let active
  async function version(id) {
    const root = await installation.find(id)
    if (root) return JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version
  }
  async function list() {
    if (installation?.product !== 'workbench') return []
    return Promise.all(
      components.map(async (id) => {
        const root = await installation.find(id)
        const installed =
          root && JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version
        const state = states.get(id)
        if (
          active === id ||
          (installed && state?.stage === 'uninstalling') ||
          (state?.repair && installed !== state.target)
        )
          return { id, ...state, busy: !!active }
        const registered = installed && (await installation.registered?.(id))
        return {
          id,
          ...(installed
            ? {
                status: 'installed',
                version: installed,
                canUninstall: !!registered && !path.relative(root, registered),
              }
            : (state?.stage !== 'uninstalling' && state) || { status: 'missing' }),
          busy: !!active,
        }
      }),
    )
  }
  async function install(id) {
    if (installation?.product !== 'workbench' || !components.includes(id) || active)
      throw Error('Unavailable')
    const retryInstall = states.get(id)?.repair
    active = id
    let stage = 'checking'
    const set = (status, extra) => states.set(id, { status, ...extra })
    let target = states.get(id)?.target
    set(stage)
    let file
    try {
      if (!retryInstall && (await version(id))) return
      const asset = releaseInstaller(await latestRelease(request, id), id)
      if (!asset) throw Error('Invalid release asset')
      target = asset.version
      stage = 'downloading'
      set(stage, { progress: 0 })
      file = await saveInstaller(asset, temp, request, (progress) => set(stage, { progress }))
      stage = 'installing'
      set(stage)
      await execute(file, ['/S', '/currentuser'], { windowsHide: true })
      if ((await version(id)) !== asset.version) throw Error('Installation not detected')
    } catch {
      set('failed', { stage, target, repair: retryInstall || stage === 'installing' })
    } finally {
      if (states.get(id)?.status !== 'failed') states.delete(id)
      try {
        if (file) await rm(path.dirname(file), { recursive: true, force: true, maxRetries: 3 })
      } finally {
        active = undefined
      }
    }
  }
  async function uninstall(id) {
    if (installation?.product !== 'workbench' || !components.includes(id) || active)
      throw Error('Unavailable')
    active = id
    states.set(id, { status: 'uninstalling' })
    try {
      const root = await installation.find(id)
      const registered = await installation.registered(id)
      if (!root || !registered || path.relative(root, registered))
        throw Error('Missing registered installation')
      const directory = path.resolve(root, '../..')
      const file = path.join(directory, 'Uninstall FitBay ' + products[id] + '.exe')
      if (path.relative(file, await realpath(file))) throw Error('Invalid uninstaller')
      await execute(
        path.join(process.env.SystemRoot, 'System32', 'reg.exe'),
        [
          'add',
          String.raw`HKCU\Software\FitBay\PreviousInstallations`,
          '/v',
          products[id],
          '/t',
          'REG_SZ',
          '/d',
          directory,
          '/f',
          '/reg:64',
        ],
        { windowsHide: true },
      )
      await execute(file, ['/S', '/currentuser', '_?=' + directory], {
        windowsHide: true,
        windowsVerbatimArguments: true,
      })
      if (await version(id)) throw Error('Uninstall failed')
      await rm(file, { force: true })
      await rmdir(directory).catch((error) => {
        if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error
      })
      states.delete(id)
    } catch {
      states.set(id, { status: 'failed', stage: 'uninstalling' })
    } finally {
      active = undefined
    }
  }
  return { list, install, uninstall }
}
