import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import windows from 'app-builder-lib/out/toolsets/windows.js'

export async function buildOfflineSetup(workbench, music, output) {
  const compiler = await windows.getMakeNsisPath()
  execFileSync(
    compiler.path,
    [
      '/V2',
      '/INPUTCHARSET',
      'UTF8',
      `/DWORKBENCH=${path.resolve(workbench)}`,
      `/DMUSIC=${path.resolve(music)}`,
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

export async function deliverInstallers(workbench, music, version) {
  const dest = path.resolve('dist/installers')
  await mkdir(dest, { recursive: true })
  const stage = await mkdtemp(path.resolve('dist/.installers-'))
  const names = [path.basename(workbench), path.basename(music), `FitBay-Setup-${version}-x64.exe`]
  const [w, m, selector] = names.map((name) => path.join(stage, name))
  try {
    await copyFile(workbench, w)
    await copyFile(music, m)
    await buildOfflineSetup(w, m, selector)
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
