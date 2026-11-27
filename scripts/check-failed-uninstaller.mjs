import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import windows from 'app-builder-lib/out/toolsets/windows.js'

// Exercise the pinned builder's actual callback routing and the production hook
// in a silent NSIS process. This fixture never installs or registers a product.
await mkdir('tmp', { recursive: true })
const tmp = await mkdtemp(path.resolve('tmp/old-uninstall-'))
const corrupt = path.join(tmp, 'broken uninstaller.exe')
await writeFile(corrupt, 'invalid executable')
const util = await readFile(
  'node_modules/app-builder-lib/templates/nsis/include/installUtil.nsh',
  'utf8',
)
const handler = util.match(/^Function handleUninstallResult\b[\s\S]*?^FunctionEnd/m)?.[0]
assert.ok(handler, 'pinned uninstall result handler')
const compiler = await windows.getMakeNsisPath()
const probe = path.join(tmp, 'probe.exe')
const source = path.join(tmp, 'probe.nsi')
const marker = path.join(tmp, 'replacement-started')
await writeFile(
  source,
  `Unicode true
RequestExecutionLevel user
SilentInstall silent
Name "FitBay uninstaller result test"
OutFile "${probe}"
!define BUILD_UNINSTALLER
!define APP_ID "io.github.m1597.fitbay.workbench"
!include "${path.resolve('resources/fitbay-install.nsh')}"
LangString uninstallFailed 1033 "Previous uninstall failed"
${handler}
Section
  ReadEnvStr $2 "FITBAY_PROBE_ROOT"
  ReadEnvStr $1 "FITBAY_PROBE_CASE"
  StrCpy $R0 0
  ClearErrors
  \${If} $1 == "launch-failed"
    ExecWait '"${corrupt}"' $R0
    StrCpy $R0 0 ; a launch failure is carried by the error flag alone
  \${ElseIf} $1 == "returned-error"
    StrCpy $R0 7
  \${EndIf}
  Push $2
  Call handleUninstallResult
  FileOpen $1 "${marker}" w
  FileClose $1
SectionEnd`,
)
const compiled = spawnSync(compiler.path, ['/V2', '/INPUTCHARSET', 'UTF8', source], {
  env: { ...process.env, ...compiler.env },
  windowsHide: true,
  encoding: 'utf8',
})
assert.equal(compiled.status, 0, compiled.stderr)
for (const root of ['SHELL_CONTEXT', 'HKEY_CURRENT_USER']) {
  for (const scenario of ['launch-failed', 'returned-error']) {
    const result = spawnSync(probe, ['/S'], {
      windowsHide: true,
      env: { ...process.env, FITBAY_PROBE_ROOT: root, FITBAY_PROBE_CASE: scenario },
    })
    assert.equal(result.status, 2, `${root} ${scenario}`)
    assert.equal(existsSync(marker), false, 'replacement must not start')
  }
}
const success = spawnSync(probe, ['/S'], {
  windowsHide: true,
  env: { ...process.env, FITBAY_PROBE_ROOT: 'SHELL_CONTEXT', FITBAY_PROBE_CASE: 'success' },
})
assert.equal(success.status, 0)
assert.ok(existsSync(marker))
console.log('PASS unlaunchable and unsuccessful previous uninstallers stop replacement.')
