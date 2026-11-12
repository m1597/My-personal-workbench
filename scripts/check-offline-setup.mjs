import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import windows from 'app-builder-lib/out/toolsets/windows.js'
import { buildOfflineSetup } from './build-offline-setup.mjs'

// Compile the production selector with two recording programs in place of the installers.
// Exercise selection and failure handling without registering products or writing shortcuts.
await mkdir('tmp', { recursive: true })
const root = await mkdtemp(path.resolve('tmp/selector-'))
const compiler = await windows.getMakeNsisPath()
const log = path.join(root, 'calls.txt')
const probe = path.join(root, 'probe.nsi')
for (const id of ['Workbench', 'Music']) {
  await writeFile(
    probe,
    `Unicode true
RequestExecutionLevel user
SilentInstall silent
Name "FitBay acceptance"
OutFile "${root}\\${id}.exe"
Section
FileOpen $0 "${log}" a
FileSeek $0 0 END
FileWriteUTF16LE $0 "${id} $INSTDIR$\\n"
FileClose $0
ReadEnvStr $0 "FITBAY_TEST_FAIL"
StrCmp $0 "${id}" 0 +2
SetErrorLevel 7
SectionEnd`,
  )
  const result = spawnSync(compiler.path, ['/V2', '/INPUTCHARSET', 'UTF8', probe], {
    env: { ...process.env, ...compiler.env },
    stdio: 'inherit',
    windowsHide: true,
  })
  assert.equal(result.status, 0)
}
const selector = path.join(root, 'selector-test.exe')
await buildOfflineSetup(path.join(root, 'Workbench.exe'), path.join(root, 'Music.exe'), selector)
const installDir = path.join(root, '自选 FitBay 目录')
for (const [args, fail, calls] of [
  [[], '', ['Workbench']],
  [['/WITHMUSIC'], '', ['Workbench', 'Music']],
  [['/WITHMUSIC'], 'Workbench', ['Workbench']],
  [['/WITHMUSIC'], 'Music', ['Workbench', 'Music']],
]) {
  await writeFile(log, '')
  const result = spawnSync(selector, ['/S', ...args, `/D=${installDir}`], {
    windowsVerbatimArguments: true,
    env: { ...process.env, FITBAY_TEST_FAIL: fail },
    timeout: 20000,
    windowsHide: true,
  })
  assert.equal(result.status, fail ? 7 : 0)
  assert.deepEqual(
    (await readFile(log, 'utf16le')).trim().split(/\r?\n/),
    calls.map((id) => `${id} ${id === 'Music' ? path.join(installDir, 'Music') : installDir}`),
  )
}
console.log('PASS 离线选择器默认仅工作台、附加 Music、两阶段错误传播和停止顺序。')
