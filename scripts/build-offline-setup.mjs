import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import windows from 'app-builder-lib/out/toolsets/windows.js'

export async function buildOfflineSetup(files, output) {
  const compiler = await windows.getMakeNsisPath()
  execFileSync(
    compiler.path,
    [
      '/V2',
      '/INPUTCHARSET',
      'UTF8',
      ...['workbench', 'music', 'prompts', 'toolkit'].map(
        (id) => `/D${id.toUpperCase()}=${path.resolve(files[id])}`,
      ),
      `/DOUTPUT=${path.resolve(output)}`,
      'fitbay-offline.nsi',
    ],
    {
      cwd: path.resolve('resources'),
      env: { ...process.env, ...compiler.env },
      windowsHide: true,
      stdio: 'inherit',
    },
  )
}

export async function deliverInstallers(files, version) {
  const dest = path.resolve('dist/installers')
  await mkdir(dest, { recursive: true })
  const stage = await mkdtemp(path.resolve('dist/.installers-'))
  const names = Object.values(files).map((file) => path.basename(file))
  const selector = `FitBay-Setup-${version}-x64.exe`
  try {
    for (const file of Object.values(files))
      await copyFile(file, path.join(stage, path.basename(file)))
    await buildOfflineSetup(files, path.join(stage, selector))
    names.push(selector)
    const plugin = 'path.fitbayplugin'
    await copyFile(
      path.resolve('dist/component-prototype/plugin-packs', plugin),
      path.join(stage, plugin),
    )
    names.push(plugin)
    const sums = []
    for (const name of names) {
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(path.join(stage, name))) hash.update(chunk)
      sums.push(`${hash.digest('hex')}  ${name}`)
    }
    const manifest = 'SHA256SUMS.txt'
    await writeFile(path.join(stage, manifest), sums.join('\n') + '\n')
    // The manifest marks a completed delivery. Publish it after every replacement succeeds.
    await rm(path.join(dest, manifest), { force: true })
    for (const name of names) await rename(path.join(stage, name), path.join(dest, name))
    for (const id of ['wave', 'tags', 'rules'])
      await rm(path.join(dest, 'plugins', id + '.fitbayplugin'), { force: true })
    await rename(path.join(stage, manifest), path.join(dest, manifest))
    console.log(`独立安装程序、离线选择入口和 SHA-256 清单：${dest}`)
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}
