import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const stage = path.resolve(root, '.cache/package-app')
if (path.dirname(stage) !== path.resolve(root, '.cache')) throw new Error('打包暂存目录越界')
const pkg = JSON.parse(await readFile('package.json', 'utf8'))
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'))
const notices = [
  'Third-party notices for the bundled renderer. Electron/Chromium notices are also shipped beside the executable.',
]
const upstreamLicenses = {
  '@fluentui/react-icons': 'resources/licenses/fluentui-system-icons.txt',
  'embla-carousel': 'resources/licenses/embla-carousel.txt',
  'embla-carousel-autoplay': 'resources/licenses/embla-carousel.txt',
  'embla-carousel-fade': 'resources/licenses/embla-carousel.txt',
}
for (const [location, info] of Object.entries(lock.packages)) {
  if (!location || info.dev || info.link) continue
  const folder = path.resolve(root, location)
  if (!folder.startsWith(`${path.resolve(root, 'node_modules')}${path.sep}`))
    throw new Error('依赖路径越界')
  const metadata = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8'))
  const licenses = (await readdir(folder)).filter((name) =>
    /^(licen[cs]e|copying|notice)(\.|$)/i.test(name),
  )
  const upstream = upstreamLicenses[metadata.name]
  if (licenses.length === 0 && !upstream) throw new Error(`请核查并补齐许可证：${metadata.name}`)
  notices.push(
    `\n===== ${metadata.name}@${metadata.version} (${metadata.license ?? 'see license'}) =====`,
  )
  for (const file of licenses) notices.push(await readFile(path.join(folder, file), 'utf8'))
  if (licenses.length === 0) notices.push(await readFile(upstream, 'utf8'))
}
// Only this disposable, fixed staging directory is replaced. No user data copied.
await rm(stage, { recursive: true, force: true })
await mkdir(stage, { recursive: true })
await cp('out', path.join(stage, 'out'), { recursive: true })
await cp('LICENSE', path.join(stage, 'LICENSE'))
await writeFile(path.join(stage, 'THIRD_PARTY_NOTICES.txt'), `${notices.join('\n')}\n`)
await writeFile(
  path.join(stage, 'package.json'),
  `${JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      type: pkg.type,
      main: pkg.main,
      author: 'MON.',
      license: 'MIT',
    },
    null,
    2,
  )}\n`,
)
console.log(`打包暂存已准备：${stage}；只包含构建结果与许可证。`)
