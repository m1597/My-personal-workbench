import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

process.chdir(fileURLToPath(new URL('../', import.meta.url)))
let failed = false
function check(label, ok, remedy = '') {
  console.log(`${ok ? 'OK' : 'FAIL'} ${label}${!ok && remedy ? ` — ${remedy}` : ''}`)
  if (!ok) failed = true
}
function read(file, json = false) {
  try {
    const contents = readFileSync(file, 'utf8')
    const value = json ? JSON.parse(contents) : contents.trim()
    if (json && (!value || typeof value !== 'object' || Array.isArray(value))) {
      throw new Error('Expected an object')
    }
    return value
  } catch {
    check(
      file,
      false,
      existsSync(file)
        ? '文件不可读或格式错误；检查编码、JSON 语法与 Git 差异，保留修改后修复。'
        : '文件缺失；先查看 git status，再从当前提交恢复该项目文件（不要覆盖未提交成果）。',
    )
    return undefined
  }
}
const pkg = read('package.json', true)
const expectedNode = read('.node-version')
if (expectedNode)
  check(
    `Node ${process.versions.node} (verified ${expectedNode})`,
    process.versions.node === expectedNode,
    `使用项目记录的 Node ${expectedNode}，本命令不会更改系统环境。`,
  )
const npmCli = process.env.npm_execpath
check('通过 npm run doctor 调用', Boolean(npmCli), '在项目目录执行 npm run doctor。')
if (npmCli) {
  try {
    const npmVersion = execFileSync(process.execPath, [npmCli, '--version'], {
      encoding: 'utf8',
      timeout: 15000,
    }).trim()
    if (pkg)
      check(
        `npm ${npmVersion} (verified ${pkg.packageManager})`,
        pkg.packageManager === `npm@${npmVersion}`,
        '使用 packageManager 记录的 npm 版本；不要自动升级全局 npm。',
      )
  } catch {
    check('npm 可运行', false, 'npm 调用失败或超时；检查 node/npm 的路径，再执行 npm run doctor。')
  }
  if (pkg) {
    try {
      execFileSync(process.execPath, [npmCli, 'ls', '--depth=0'], { stdio: 'pipe', timeout: 30000 })
      check('直接依赖与 package.json 一致', true)
    } catch {
      check(
        '依赖缺失、不匹配或 npm ls 失败',
        false,
        '先执行 npm ls --depth=0 查看详情；关闭本项目开发进程后 npm ci，再运行 doctor。',
      )
    }
  }
}
for (const file of [
  'tsconfig.json',
  'electron.vite.config.ts',
  'biome.json',
  '.npmrc',
  '.gitattributes',
  '.editorconfig',
  'src/main/index.ts',
  'src/renderer/index.html',
]) {
  check(file, existsSync(file), '查看 git status；保留修改后恢复该项目文件。')
}
const lock = read('package-lock.json', true)
if (lock && pkg) {
  const root = lock.packages?.['']
  check(
    '锁文件包含根包元数据',
    Boolean(root),
    '检查锁文件差异；确认 package.json 后用 npm install --package-lock-only 更新并审阅，不删除锁文件随意重装。',
  )
  if (root) {
    const normalized = (value) =>
      JSON.stringify(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b)))
    for (const key of ['dependencies', 'devDependencies']) {
      check(
        `锁文件 ${key}`,
        normalized(pkg[key]) === normalized(root[key]),
        '确认 package.json 改动后更新锁文件并审阅，再 npm ci。',
      )
    }
  }
}
const electronBinary =
  process.platform === 'win32'
    ? 'node_modules/electron/dist/electron.exe'
    : process.platform === 'darwin'
      ? 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
      : 'node_modules/electron/dist/electron'
check(
  'Electron 运行时已下载',
  existsSync(electronBinary),
  '先 npm ci；若安装脚本被跳过或下载失败，检查网络后 npm run postinstall。',
)
console.log('只读检查完成；未修改系统或全局设置。当前验证平台为 Windows。')
process.exitCode = failed ? 1 : 0
