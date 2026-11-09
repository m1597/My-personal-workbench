import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
process.chdir(fileURLToPath(new URL('../', import.meta.url)))
let failed = false
function check(label, ok) {
  console.log(`${ok ? 'OK' : 'FAIL'} ${label}`)
  if (!ok) failed = true
}
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const expectedNode = readFileSync('.node-version', 'utf8').trim()
check(
  `Node ${process.versions.node} (verified ${expectedNode})`,
  process.versions.node === expectedNode,
)
const npmCli = process.env.npm_execpath
check('Run through npm run doctor', Boolean(npmCli))
if (npmCli) {
  const npmVersion = execFileSync(process.execPath, [npmCli, '--version'], {
    encoding: 'utf8',
  }).trim()
  check(
    `npm ${npmVersion} (verified ${pkg.packageManager})`,
    pkg.packageManager === `npm@${npmVersion}`,
  )
  try {
    execFileSync(process.execPath, [npmCli, 'ls', '--depth=0'], { stdio: 'pipe' })
    check('Direct dependencies match package.json', true)
  } catch {
    check('Dependencies missing/mismatched: run npm ci, then npm ls --depth=0', false)
  }
}
for (const file of [
  'package-lock.json',
  'tsconfig.json',
  'electron.vite.config.ts',
  '.gitattributes',
  '.editorconfig',
  'src/main/index.ts',
  'src/preload/index.ts',
  'src/renderer/index.html',
]) {
  check(file, existsSync(file))
}
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
for (const key of ['dependencies', 'devDependencies']) {
  check(`Lockfile ${key}`, JSON.stringify(pkg[key]) === JSON.stringify(lock.packages[''][key]))
}
const electronBinary =
  process.platform === 'win32'
    ? 'node_modules/electron/dist/electron.exe'
    : process.platform === 'darwin'
      ? 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
      : 'node_modules/electron/dist/electron'
check('Electron runtime downloaded', existsSync(electronBinary))
console.log('Read-only check; no system/global settings changed. Windows is the verified platform.')
process.exitCode = failed ? 1 : 0
