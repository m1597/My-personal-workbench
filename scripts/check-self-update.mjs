import { strict as assert } from 'node:assert'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { glob, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

const root = await mkdtemp(path.resolve('tmp/self update '))
const compiler =
  process.env.MAKENSIS ||
  (
    await Array.fromAsync(
      glob('electron-builder/Cache/nsis*/**/makensis.exe', { cwd: process.env.LOCALAPPDATA }),
    )
  )
    .map((file) => path.join(process.env.LOCALAPPDATA, file))
    .find((file) => !file.includes('\\Bin\\'))
async function fixture(name, log, dest, code = 0) {
  const spec = path.join(root, name + '.nsi')
  const file = path.join(dest, name + '.exe')
  await writeFile(
    spec,
    [
      'Unicode true',
      'RequestExecutionLevel user',
      'SilentInstall silent',
      'OutFile "' + file + '"',
      'Section',
      'FileOpen $0 "' + log + '" w',
      'FileWrite $0 "$CMDLINE"',
      'FileClose $0',
      'SetErrorLevel ' + code,
      'SectionEnd',
    ].join('\r\n'),
  )
  execFileSync(compiler, ['/INPUTCHARSET', 'UTF8', spec], { windowsHide: true, stdio: 'pipe' })
  return file
}
for (const mode of ['success', 'exit-failure', 'corrupt']) {
  const profile = path.join(root, mode),
    download = path.join(profile, 'download')
  await mkdir(download, { recursive: true })
  const restart = path.join(profile, 'restart.txt'),
    install = path.join(profile, 'install.txt')
  const executable = await fixture('FitBay', restart, profile)
  const file = await fixture('installer', install, download, mode === 'exit-failure' ? 2 : 0)
  const digest =
    'sha256:' +
    createHash('sha256')
      .update(mode === 'corrupt' ? 'bad' : await readFile(file))
      .digest('hex')
  const runner = path.join(profile, 'parent.mjs')
  await writeFile(
    runner,
    'import {startSelfUpdate} from ' +
      JSON.stringify(pathToFileURL(path.resolve('examples/component-host/self-update.mjs')).href) +
      ';await startSelfUpdate(' +
      JSON.stringify({ file, profile, digest, executable, version: '0.2.5' }) +
      ');',
  )
  execFileSync(process.execPath, [runner], { windowsHide: true })
  for (let i = 0; i < 100; i++) {
    if (await readFile(restart, 'utf8').catch(() => '')) break
    await delay(100)
  }
  assert.ok((await readFile(restart, 'utf8')).includes(profile))
  if (mode === 'corrupt') await assert.rejects(readFile(install), { code: 'ENOENT' })
  else assert.match(await readFile(install, 'utf8'), /\/S \/currentuser/)
  assert.equal(await readFile(path.join(profile, 'self-update-target'), 'utf8'), '0.2.5')
}
console.log('PASS', root)
