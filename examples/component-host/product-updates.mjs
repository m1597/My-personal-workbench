import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const repo = 'm1597/My-personal-workbench'
const products = { music: 'Music', workbench: 'Workbench', prompts: 'Prompts', toolkit: 'Toolkit' }
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export function selectUpdate(release, product, installed) {
  const version = release.tag_name?.replace(/^v/, '')
  if (!versionPattern.test(version) || !versionPattern.test(installed)) return
  if (release.draft || release.prerelease || !Object.hasOwn(products, product)) return
  const parts = installed.split('.').map(Number)
  const diff = version.split('.').map((part, i) => Number(part) - parts[i])
  if (!(diff.find((n) => n !== 0) > 0)) return
  const name = `FitBay-${products[product]}-Setup-${version}-x64.exe`
  const url = `https://github.com/${repo}/releases/download/${release.tag_name}/${name}`
  const asset = release.assets?.find(
    (item) => item.name === name && item.browser_download_url === url,
  )
  if (!asset || !/^sha256:[a-f0-9]{64}$/.test(asset.digest) || !(asset.size > 0)) return
  return { version, name, url, digest: asset.digest, size: asset.size }
}

export async function saveInstaller(update, temp, request = fetch) {
  const dir = await mkdtemp(path.join(temp, 'fitbay-update-'))
  const file = path.join(dir, update.name)
  try {
    const response = await request(update.url, { signal: AbortSignal.timeout(600_000) })
    if (!response.ok || !response.body) throw Error('Download failed')
    let bytes = 0
    const hash = createHash('sha256')
    const verify = new Transform({
      transform(chunk, _, next) {
        bytes += chunk.length
        hash.update(chunk)
        next(bytes > update.size ? Error('Size mismatch') : null, chunk)
      },
    })
    await pipeline(response.body, verify, createWriteStream(file, { flags: 'wx' }))
    if (bytes !== update.size || 'sha256:' + hash.digest('hex') !== update.digest)
      throw Error('Integrity check failed')
    return file
  } catch (error) {
    await rm(dir, { recursive: true, force: true })
    throw error
  }
}

// Renderer callers supply a product id. Download URLs and hashes stay in the main process.
export function updateCatalog({ inventory, launch, request = fetch, changed = () => {} }) {
  const results = new Map()
  let lastChecked = null
  let pending = Promise.resolve()
  function serialize(action) {
    const next = pending.then(action)
    pending = next.catch(() => {})
    return next
  }
  async function snapshot() {
    const rows = (await inventory()).map((row) => {
      const saved = results.get(row.id)
      const result = saved?.installed === row.version ? saved : undefined
      return {
        ...row,
        status: result?.status ?? (products[row.id] ? 'unchecked' : 'unsupported'),
        available: result?.update?.version ?? null,
      }
    })
    return { rows, lastChecked }
  }
  function check(id) {
    return serialize(async () => {
      const selected = (await inventory()).filter(
        (row) => (!id || id === row.id) && Object.hasOwn(products, row.id),
      )
      if (selected.length) {
        let release
        try {
          const response = await request(`https://api.github.com/repos/${repo}/releases/latest`, {
            signal: AbortSignal.timeout(15000),
          })
          if (!response.ok) throw Error('Release unavailable')
          release = await response.json()
        } catch {
          release = null
        }
        for (const row of selected) {
          const version = release?.tag_name?.replace(/^v/, '')
          const update = release && selectUpdate(release, row.id, row.version)
          const valid =
            versionPattern.test(version) &&
            versionPattern.test(row.version) &&
            !release?.draft &&
            !release?.prerelease
          const newer =
            valid &&
            version
              .split('.')
              .map((part, i) => Number(part) - Number(row.version.split('.')[i]))
              .find((n) => n !== 0) > 0
          results.set(row.id, {
            installed: row.version,
            update,
            status: update ? 'available' : valid && !newer ? 'current' : 'failed',
          })
        }
        lastChecked = new Date().toISOString()
      }
      const state = await snapshot()
      changed(state)
      return state
    })
  }
  function install(id) {
    return serialize(async () => {
      const row = (await inventory()).find((item) => item.id === id)
      const result = results.get(id)
      if (!row?.installable || !result?.update || result.installed !== row.version)
        throw Error('Update unavailable')
      await launch(result.update)
    })
  }
  return { snapshot, check, install }
}

export function productUpdater({ installation, app, dialog, shell, english }) {
  const declined = new Set()
  let busy = false
  return async function check(manual = false) {
    if (busy) return
    busy = true
    const t = (zh, en) => (english() ? en : zh)
    const inform = (message) => dialog.showMessageBox({ title: 'FitBay', message })
    try {
      const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok && response.status !== 404) throw Error('Release check failed')
      const release = response.ok ? await response.json() : {}
      let found = false
      for (const product of ['workbench', 'music']) {
        const root = await installation.find(product)
        if (!root) continue
        const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
        const update = selectUpdate(release, product, pkg.version)
        if (!update || (!manual && declined.has(update.name))) continue
        found = true
        const answer = await dialog.showMessageBox({
          title: 'FitBay',
          message: `FitBay ${products[product]}  ${pkg.version} → ${update.version}`,
          detail: t(
            '下载并校验完成后，将关闭 FitBay 并打开安装程序。',
            'After verifying the download, FitBay will close and open the installer.',
          ),
          buttons: [t('下载并更新', 'Download update'), t('稍后', 'Later')],
          defaultId: 1,
          cancelId: 1,
        })
        if (answer.response !== 0) {
          declined.add(update.name)
          continue
        }
        try {
          const file = await saveInstaller(update, app.getPath('temp'))
          if (await shell.openPath(file)) throw Error('Installer launch failed')
          app.quit()
          return
        } catch {
          await inform(
            t(
              '更新下载、校验或启动失败，请稍后从托盘重试。',
              'Update failed. Please retry from the tray.',
            ),
          )
          return
        }
      }
      if (manual && !found)
        await inform(
          t(
            '当前没有适用于已安装产品的更新包。',
            'No update package is available for the installed products.',
          ),
        )
    } catch {
      if (manual)
        await inform(
          t(
            '暂时无法检查更新，请检查网络后重试。',
            'Could not check for updates. Check your connection and retry.',
          ),
        )
    } finally {
      busy = false
    }
  }
}
