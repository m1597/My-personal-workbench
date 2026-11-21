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
const products = ['Workbench', 'Music', 'Prompts', 'Toolkit']
const files = {}
for (const id of products) {
  files[id.toLowerCase()] = path.join(root, id + '.exe')
  await writeFile(
    probe,
    `Unicode true
RequestExecutionLevel user
SilentInstall silent
InstallDir "${root}\\independent"
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
await buildOfflineSetup(files, selector)
const installDir = path.join(root, '自选 FitBay 目录')
const cases = []
for (let mask = 0; mask < 8; mask++) {
  const optional = products.slice(1).filter((_, i) => mask & (1 << i))
  const args = optional.map((id) => '/WITH' + id.toUpperCase())
  cases.push([args, '', ['Workbench', ...optional]])
}
for (const [index, fail] of products.entries())
  cases.push([['/WITHMUSIC', '/WITHPROMPTS', '/WITHTOOLKIT'], fail, products.slice(0, index + 1)])
for (const [args, fail, calls] of cases) {
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
    calls.map((id) => `${id} ${id === 'Workbench' ? installDir : path.join(root, 'independent')}`),
  )
}
console.log('PASS 离线选择器全部八种组件组合、四阶段错误传播和路径参数。')
