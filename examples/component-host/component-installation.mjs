import { execFile } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { latestRelease, releaseInstaller, saveInstaller } from './product-updates.mjs'

const components = ['music', 'prompts', 'toolkit']
export function componentInstallation(installation, temp, request) {
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
        const installed = await version(id)
        const state = states.get(id)
        if (active === id || (state?.repair && installed !== state.target))
          return { id, ...state, busy: !!active }
        return {
          id,
          ...(installed
            ? { status: 'installed', version: installed }
            : state || { status: 'missing' }),
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
      const asset = releaseInstaller(await latestRelease(request), id)
      if (!asset) throw Error('Invalid release asset')
      target = asset.version
      stage = 'downloading'
      set(stage, { progress: 0 })
      file = await saveInstaller(asset, temp, request, (progress) => set(stage, { progress }))
      stage = 'installing'
      set(stage)
      await promisify(execFile)(file, ['/S', '/currentuser'], { windowsHide: true })
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
  return { list, install }
}
