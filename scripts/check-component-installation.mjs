import { _electron as electron, expect } from '@playwright/test'
import { cp, glob, link, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { prepareProduct } from './prepare-package.mjs'
const root = await mkdtemp(path.resolve('tmp/component-setup-'))
const runtime = path.resolve(
  process.env.FITBAY_TEST_RUNTIME || '.cache/fitbay-build/workbench/win-unpacked',
)
// Optional read-only source for an installed executable and its matching runtime files.
const installed = process.env.FITBAY_TEST_INSTALLED_RUNTIME
async function copyRuntime(source, dest) {
  await mkdir(dest, { recursive: true })
  for (const e of await readdir(source, { withFileTypes: true })) {
    const src = path.join(source, e.name),
      dst = path.join(dest, e.name)
    if (src === path.join(runtime, 'resources', 'app')) continue
    if (e.isDirectory()) await copyRuntime(src, dst)
    else await link(installed ? path.join(installed, path.relative(runtime, src)) : src, dst)
  }
}
await copyRuntime(runtime, root)
const productRoot = path.join(root, 'resources/app')
const wb = await prepareProduct('workbench')
await cp(wb.app, productRoot, { recursive: true })
await cp(wb.modules, path.join(productRoot, 'node_modules'), { recursive: true })
// This copy cannot see or change the user's component registrations.
const discovery = path.join(productRoot, 'host/installed-products.mjs')
await writeFile(
  discovery,
  (await readFile(discovery, 'utf8')).replace(
    'const directory = installDirectory(name)',
    `const directory = path.join(${JSON.stringify(root)}, 'registration', name)`,
  ),
)
const stale = path.join(root, 'registration/Toolkit/resources/app')
await mkdir(stale, { recursive: true })
await writeFile(
  path.join(stale, 'package.json'),
  JSON.stringify({ fitbayProduct: 'toolkit', version: '0.1.0' }),
)
await writeFile(path.join(stale, 'main.mjs'), '')
const version = '0.2.0'
const assets = []
const compiler =
  process.env.MAKENSIS ||
  (
    await Array.fromAsync(
      glob('electron-builder/Cache/nsis*/**/makensis.exe', { cwd: process.env.LOCALAPPDATA }),
    )
  )
    .map((file) => path.join(process.env.LOCALAPPDATA, file))
    .find((file) => !file.includes('\\Bin\\'))
for (const [id, label] of [
  ['music', 'Music'],
  ['prompts', 'Prompts'],
  ['toolkit', 'Toolkit'],
]) {
  const dir = path.join(root, label)
  const appDir = path.join(dir, 'resources/app')
  const musicFiles = id === 'music' ? await prepareProduct('music') : undefined
  const source = path.join(root, id + '-package.json')
  await writeFile(source, JSON.stringify({ version, fitbayProduct: id }))
  const marker = path.join(root, id + '-marker')
  const manifest =
    id === 'toolkit'
      ? {}
      : JSON.parse(await readFile(path.join('components', id, 'component.json'), 'utf8'))
  await writeFile(marker, JSON.stringify({ ...manifest, version }))
  const name = 'FitBay-' + label + '-Setup-' + version + '-x64.exe'
  const exe = path.join(root, name)
  const wrongVersion = path.join(root, 'wrong.json')
  await writeFile(wrongVersion, JSON.stringify({ version: '0.1.0', fitbayProduct: id }))
  const spec = path.join(root, id + '.nsi')
  await writeFile(
    spec,
    [
      'Unicode true',
      'RequestExecutionLevel user',
      'SilentInstall silent',
      'OutFile "' + exe + '"',
      'Section',
      'Sleep 600',
      'SetOutPath "' + dir + '"',
      'File "/oname=FitBay ' + label + '.exe" "' + marker + '"',
      'SetOutPath "' + appDir + '"',
      ...(musicFiles
        ? [
            'File /r "' + path.join(musicFiles.app, '*') + '"',
            'SetOutPath "' + path.join(appDir, 'node_modules') + '"',
            'File /r "' + path.join(musicFiles.modules, '*') + '"',
            'SetOutPath "' + appDir + '"',
          ]
        : []),
      'File "/oname=package.json" "' + source + '"',
      ...(id === 'toolkit'
        ? ['File "/oname=main.mjs" "' + marker + '"']
        : [
            'SetOutPath "' + path.join(appDir, id) + '"',
            'File "/oname=component.json" "' + marker + '"',
            'File "/oname=index.html" "' +
              path.resolve('dist/component-prototype', id, 'index.html') +
              '"',
          ]),
      ...(id === 'toolkit'
        ? [
            'IfFileExists "' + dir + '/attempt" done',
            'SetOutPath "' + appDir + '"',
            'File "/oname=package.json" "' + wrongVersion + '"',
            'SetOutPath "' + dir + '"',
            'File "/oname=attempt" "' + marker + '"',
            'done:',
          ]
        : []),
      'SectionEnd',
    ].join('\r\n'),
  )
  execFileSync(compiler, ['/INPUTCHARSET', 'UTF8', spec], { stdio: 'pipe', windowsHide: true })
  const data = await readFile(exe)
  assets.push({
    name,
    size: data.length,
    digest: 'sha256:' + createHash('sha256').update(data).digest('hex'),
    browser_download_url:
      'https://github.com/m1597/My-personal-workbench/releases/download/v' + version + '/' + name,
  })
}
await writeFile(
  path.join(root, 'fixture.cjs'),
  `
const {net}=require('electron'),fs=require('node:fs'),path=require('node:path')
let corrupt = true
const release = ${JSON.stringify({ tag_name: 'v' + version, assets })}
net.fetch = async url => {
  if(url === 'https://api.github.com/repos/m1597/My-personal-workbench/releases/latest') return Response.json(release)
  const asset = release.assets.find(a => a.browser_download_url === url)
  if(!asset) throw Error('Unexpected request')
  const bytes = fs.readFileSync(path.join(__dirname,asset.name))
  if(corrupt) {bytes[0]^=1;corrupt=false}
  return new Response(new ReadableStream({async start(controller){
    controller.enqueue(bytes.subarray(0,Math.floor(bytes.length/2)))
    await new Promise(r=>setTimeout(r,1100))
    controller.enqueue(bytes.subarray(Math.floor(bytes.length/2)));controller.close()
  }}))
}
`,
)
const entry = path.join(productRoot, 'host/main.mjs')
await writeFile(entry, "import '../../../fixture.cjs'\n" + (await readFile(entry, 'utf8')))
async function launch() {
  const app = await electron.launch({
    executablePath: path.join(root, 'FitBay.exe'),
    args: ['--user-data-dir=' + path.join(root, 'profile')],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1', ELECTRON_RENDERER_URL: '' },
  })
  const page = await app.firstWindow()
  await page.getByRole('button', { name: '工作台设置', exact: true }).click()
  await page.getByRole('button', { name: '组件管理', exact: true }).click()
  return { app, page }
}
const { app, page } = await launch()
try {
  const rows = page.locator('[data-install-product]')
  await expect(rows).toHaveCount(3)
  await expect(rows.filter({ hasText: '未安装' })).toHaveCount(3)
  const music = rows.nth(0)
  await music.getByRole('button').click()
  await expect(music).toContainText(/下载并校验.*\d+%/)
  await expect(music).toContainText('SHA-256 校验失败')
  await page.screenshot({ path: path.join(root, 'retry.png') })
  await expect(music.getByRole('button')).toHaveText('重试 Music')
  for (const row of await rows.all()) {
    await row.getByRole('button').click()
    await expect(row).toContainText('正在安装')
    if ((await row.getAttribute('data-install-product')) === 'toolkit') {
      await expect(row).toContainText('安装程序或安装后检测失败')
      await row.getByRole('button', { name: '重试 工具集' }).click()
    }
    await expect(row).toContainText('已安装 0.2.0')
    await expect(row).toContainText('此位置未登记，无法卸载')
    await expect(row.getByRole('button')).toHaveCount(0)
  }
  await expect(page.getByRole('button', { name: '在工作台显示 Music', exact: true })).toBeEnabled()
  await page.screenshot({ path: path.join(root, 'installed.png') })
} finally {
  await app.close()
}
const restarted = await launch()
try {
  await expect(
    restarted.page.locator('[data-install-product]').filter({ hasText: '已安装 0.2.0' }),
  ).toHaveCount(3)
  console.log('PASS', root)
} finally {
  await restarted.app.close()
}
