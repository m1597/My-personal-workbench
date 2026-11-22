import { _electron as electron, expect } from '@playwright/test'
import { cp, link, mkdir, mkdtemp, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { prepareProduct } from './prepare-package.mjs'
const root = await mkdtemp(path.resolve('tmp/updates-packaged-'))
const runtime = path.resolve(
  process.env.FITBAY_TEST_RUNTIME || '.cache/fitbay-build/workbench/win-unpacked',
)
async function copyRuntime(source, dest) {
  await mkdir(dest, { recursive: true })
  for (const e of await readdir(source, { withFileTypes: true })) {
    const src = path.join(source, e.name),
      dst = path.join(dest, e.name)
    if (src === path.join(runtime, 'resources', 'app')) continue
    if (e.isDirectory()) await copyRuntime(src, dst)
    else
      await link(
        process.env.FITBAY_TEST_INSTALLED_RUNTIME
          ? path.join(process.env.FITBAY_TEST_INSTALLED_RUNTIME, path.relative(runtime, src))
          : src,
        dst,
      )
  }
}
await copyRuntime(runtime, root)
const productRoot = path.join(root, 'resources/app')
const wb = await prepareProduct('workbench')
await cp(wb.app, productRoot, { recursive: true })
await cp(wb.modules, path.join(productRoot, 'node_modules'), { recursive: true })
const music = await prepareProduct('music')
const musicRoot = path.join(root, 'music-product')
await cp(music.app, musicRoot, { recursive: true })
const musicPackage = path.join(musicRoot, 'package.json')
const installedMusic = JSON.parse(await readFile(musicPackage, 'utf8'))
await writeFile(musicPackage, JSON.stringify({ ...installedMusic, version: '0.1.0' }))
// Replace only the installed location lookup inside this disposable package.
const discovery = path.join(productRoot, 'host/installed-products.mjs')
const src = await readFile(discovery, 'utf8')
await writeFile(
  discovery,
  src.replace(
    'const directory = installDirectory(name)',
    "if (id === 'music') {await realpath(process.env.TEST_MUSIC_ROOT);return process.env.TEST_MUSIC_ROOT}\n    return undefined",
  ),
)
const pkg = JSON.parse(await readFile(path.join(productRoot, 'package.json'), 'utf8'))
pkg.version = '0.2.0'
await writeFile(path.join(productRoot, 'package.json'), JSON.stringify(pkg))
const probe = path.join(root, 'fixture.cjs')
const payload = 'verified installer test bytes'
const name = 'FitBay-Music-Setup-0.2.0-x64.exe'
const url = 'https://github.com/m1597/My-personal-workbench/releases/download/v0.2.0/' + name
const release = {
  tag_name: 'v0.2.0',
  assets: [
    {
      name,
      browser_download_url: url,
      size: Buffer.byteLength(payload),
      digest: 'sha256:' + createHash('sha256').update(payload).digest('hex'),
    },
  ],
}
await writeFile(
  probe,
  `const {net}=require('electron');global.downloads=[];net.fetch=async url=>{if(url.endsWith('/releases/latest'))return Response.json(${JSON.stringify(release)});global.downloads.push(url);return new Response(global.downloads.length===1?'damaged':${JSON.stringify(payload)})};global.fixtureInstall=async file=>{require('node:fs').writeFileSync(${JSON.stringify(path.join(root, 'launch.json'))},JSON.stringify({file,downloads:global.downloads,data:require('node:fs').readFileSync(file,'utf8')}));const fs=require('node:fs');const p=require('node:path').join(process.env.TEST_MUSIC_ROOT,'package.json');const pkg=JSON.parse(fs.readFileSync(p));pkg.version='0.2.0';fs.writeFileSync(p,JSON.stringify(pkg))}`,
)
const entry = path.join(productRoot, 'host/main.mjs')
await writeFile(
  entry,
  "import '../../../fixture.cjs'\n" +
    (await readFile(entry, 'utf8'))
      .replace('await executeInstaller(file,', 'await globalThis.fixtureInstall(file,')
      .replace('if (!background) {\n          const poll', 'if (true) {\n          const poll'),
)
const app = await electron.launch({
  executablePath: path.join(root, 'FitBay.exe'),
  args: ['--user-data-dir=' + path.join(root, 'profile')],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1', TEST_MUSIC_ROOT: musicRoot },
})
try {
  const page = await app.firstWindow()
  const b = (name) => page.getByRole('button', { name, exact: true })
  await expect(page.getByLabel('有可用更新')).toBeVisible({ timeout: 20000 })
  await b('工作台设置').click()
  await b('API 与模型').click()
  await expect(page.locator('.api-connections select')).toHaveCount(0)
  for (const label of ['协议', '连接']) {
    await page.getByRole('combobox', { name: label, exact: true }).click()
    await expect(page.getByRole('listbox')).toBeVisible()
    await page.screenshot({ path: path.join(root, 'api-' + label + '.png') })
    await page.keyboard.press('Escape')
  }
  await page.getByRole('searchbox').fill('应用内快捷键')
  const target = page.getByRole('button', { name: /Music › .*应用内快捷键/ })
  await expect(target).toBeVisible()
  await rename(musicRoot, musicRoot + '.off')
  await target.click()
  await expect(page.getByRole('alert')).toHaveText('设置项已不可用')
  await expect(target).toHaveCount(0)
  await b('关闭设置').click()
  await b('工作台设置').click()
  await page.getByRole('searchbox').fill('应用内快捷键')
  await expect(page.getByText('没有匹配的设置')).toBeVisible()
  await page.getByRole('searchbox').fill('')
  await rename(musicRoot + '.off', musicRoot)
  await b('更新').click()
  await b('检查全部更新').click()
  await expect(page.getByText(/已是最新/)).toHaveCount(1)
  await expect(b('更新 Music')).toBeVisible()
  await expect(b('更新 FitBay')).toHaveCount(0)
  await b('关闭设置').click()
  await expect(page.getByLabel('有可用更新')).toHaveCount(1)
  await b('工作台设置').click()
  await b('更新').click()
  await page.screenshot({ path: path.join(root, 'available.png') })
  await b('更新全部').click()
  await b('确认更新全部').click()
  await expect(b('重试更新 Music')).toBeVisible()
  await b('重试更新 Music').click()
  await expect
    .poll(
      async () =>
        JSON.parse(await readFile(path.join(root, 'launch.json'), 'utf8').catch(() => '{}'))
          .downloads,
    )
    .toEqual([url, url])
  const result = JSON.parse(await readFile(path.join(root, 'launch.json'), 'utf8'))
  expect(result.data).toBe(payload)
  console.log('PASS', root)
} finally {
  await app.close().catch(() => {})
}
