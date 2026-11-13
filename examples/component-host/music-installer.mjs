import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, chmod, copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { app, dialog } from 'electron'

export async function installMusic(owner, hostDirectory) {
  const version = app.getVersion()
  const name = `FitBay-Music-Setup-${version}-x64.exe`
  const directory = path.resolve(hostDirectory, '../../installers')
  const digest = app.isPackaged
    ? (await readFile(path.join(app.getAppPath(), 'music-setup.sha256'), 'utf8')).trim()
    : (await readFile(path.join(directory, 'SHA256SUMS.txt'), 'utf8'))
        .split(/\r?\n/)
        .find((line) => line.endsWith('  ' + name))
        ?.split(' ')[0]
  if (!digest || !/^[a-f0-9]{64}$/i.test(digest)) throw Error('SETUP_UNAVAILABLE')
  const bundled = path.join(app.getAppPath(), 'music-offline-setup.exe')
  let source
  if (
    app.isPackaged &&
    (await access(bundled).then(
      () => true,
      () => false,
    ))
  ) {
    source = bundled
  } else {
    const { canceled, filePaths } = await dialog.showOpenDialog(owner, {
      title: '选择 FitBay Music 安装包',
      defaultPath: path.join(app.isPackaged ? app.getPath('downloads') : directory, name),
      properties: ['openFile'],
      filters: [{ name, extensions: ['exe'] }],
    })
    if (canceled || !filePaths.length) return 'cancelled'
    source = filePaths[0]
  }
  const stage = await mkdtemp(path.join(app.getPath('temp'), 'fitbay-music-setup-'))
  try {
    const file = path.join(stage, name)
    await copyFile(source, file)
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(file)) hash.update(chunk)
    if (hash.digest('hex') !== digest.toLowerCase()) return 'mismatch'
    // Run the verified private copy; the renderer cannot supply a command, arguments or path.
    try {
      await promisify(execFile)(file, ['/currentuser'])
    } catch (error) {
      if (error.code === 1) return 'cancelled'
      throw error
    }
    return 'finished'
  } finally {
    await chmod(path.join(stage, name), 0o600).catch(() => {})
    await rm(stage, { recursive: true, force: true })
  }
}
