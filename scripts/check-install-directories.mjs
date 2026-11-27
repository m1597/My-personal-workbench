import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, access, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import windows from 'app-builder-lib/out/toolsets/windows.js'

// Use the real path validator and the generated uninstall ownership lists. Each
// probe installs a single marker into tmp and registers only in a unique test key.
const tmp = await mkdtemp(path.resolve('tmp/path-probe-'))
const root = path.join(tmp, '自选 目录')
const musicDir = path.join(root, 'Music')
const key = 'Software\\FitBayDirectoryTest-' + randomUUID()
const compiler = await windows.getMakeNsisPath()
const log = path.join(tmp, 'path.txt')
for (const [product, file] of [
  ['workbench', 'FitBay.exe'],
  ['music', 'FitBay Music.exe'],
]) {
  const probe = path.join(tmp, product + '.nsi')
  const owned = path.resolve('.cache/fitbay-build', product, 'fitbay-owned-files.nsh')
  await writeFile(
    probe,
    `Unicode true
RequestExecutionLevel user
SilentInstall silent
Name "FitBay path test"
InstallDir "${tmp}\\default"
OutFile "${tmp}\\${product}.exe"
!define APP_ID "io.github.m1597.fitbay.${product}"
!define FITBAY_REG "${key}"
!define FITBAY_HISTORY "${key}\\PreviousInstallations"
!define APP_GUID "FitBayDirectoryTest-${randomUUID()}"
!define APP_EXECUTABLE_FILENAME "${file}"
${product === 'music' ? 'Var fitbayPreviousDirectory' : ''}
!define UNINSTALL_FILENAME "unused-test-uninstaller.exe"
; This probe exercises destination and owned-file checks in its own registry key.
; The separate private-hive test exercises the production registration helper.
!macro FitBaySuite operation
  !if "\${operation}" == "Detach"
    WriteRegStr HKCU "${key}\\PreviousInstallations" "\${FITBAY_SLOT}" "$INSTDIR"
    DeleteRegValue HKCU "${key}" "\${FITBAY_SLOT}"
  !endif
!macroend
!include "${owned}"
Section
SetRegView 64
ReadEnvStr $0 "FITBAY_PATH_TEST_REMOVE"
StrCmp $0 "1" 0 install
!insertmacro customRemoveFiles
Goto done
install:
StrCmp $INSTDIR "${tmp}\\default" 0 validate
!insertmacro FitBayDefaultDir
validate:
Call FitBayValidateDestination
CreateDirectory "$INSTDIR"
FileOpen $0 "$INSTDIR\\${file}" w
FileClose $0
!insertmacro customInstall
FileOpen $0 "${log}" w
FileWriteUTF16LE $0 "$INSTDIR"
FileClose $0
done:
SectionEnd`,
  )
  execFileSync(compiler.path, ['/V2', '/INPUTCHARSET', 'UTF8', probe], {
    env: { ...process.env, ...compiler.env },
    windowsHide: true,
  })
}
function run(product, dest, { remove = false, code = 0 } = {}) {
  const result = spawnSync(path.join(tmp, product + '.exe'), dest ? ['/S', '/D=' + dest] : ['/S'], {
    env: { ...process.env, FITBAY_PATH_TEST_REMOVE: remove ? '1' : '0' },
    windowsHide: true,
    windowsVerbatimArguments: true,
    timeout: 20000,
  })
  assert.equal(result.status, code, product + ' ' + dest)
}
try {
  run('workbench', root + '\\.')
  assert.equal(await readFile(log, 'utf16le'), root)
  execFileSync(
    'reg.exe',
    ['add', 'HKCU\\' + key, '/v', 'Workbench', '/t', 'REG_SZ', '/d', root + '\\.', '/f', '/reg:64'],
    { windowsHide: true },
  )
  run('music', path.join(root, 'resources'), { code: 2 })
  run('music', root, { code: 2 })
  run('music', undefined)
  assert.equal(await readFile(log, 'utf16le'), musicDir)
  await writeFile(path.join(musicDir, '我的文件.txt'), 'keep')
  run('workbench', root, { remove: true })
  await access(path.join(musicDir, 'FitBay Music.exe'))
  await writeFile(path.join(root, 'foreign.txt'), 'private')
  run('workbench', root)
  assert.equal(await readFile(path.join(root, 'foreign.txt'), 'utf8'), 'private')
  await unlink(path.join(root, 'foreign.txt'))
  run('workbench', root)
  run('music', musicDir, { remove: true })
  await access(path.join(root, 'FitBay.exe'))
  assert.equal(await readFile(path.join(musicDir, '我的文件.txt'), 'utf8'), 'keep')
  run('workbench', root, { remove: true })
  run('workbench', root)
  run('music', undefined)
  assert.equal(await readFile(log, 'utf16le'), musicDir)
  assert.equal(await readFile(path.join(musicDir, '我的文件.txt'), 'utf8'), 'keep')
  console.log('PASS 自选根目录、旧登记规范化、Music 自动补装、冲突保护与双向卸载保留。')
} finally {
  spawnSync('reg.exe', ['delete', 'HKCU\\' + key, '/f', '/reg:64'], { windowsHide: true })
}
