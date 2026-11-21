import assert from 'node:assert/strict'
import { promptLibrary } from '../examples/component-host/prompt-library.mjs'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, copyFile, rename, realpath } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { _electron, expect } from '@playwright/test'
await mkdir('tmp', { recursive: true })
const evidence = await mkdtemp(path.resolve('tmp/file-library-'))
const profile = path.join(evidence, 'profile'),
  a = path.join(evidence, 'A'),
  b = path.join(evidence, 'B')
await Promise.all(
  [a, b, path.join(profile, 'prompt-library')].map((p) => mkdir(p, { recursive: true })),
)
// Seed the previous two-field preference format.
await writeFile(
  path.join(profile, 'prompt-library/preferences.json'),
  JSON.stringify({ defaultRoot: a, shortcut: 'Control+Alt+Shift+F11' }),
)
await mkdir(path.join(a, '层级'))
await writeFile(path.join(a, '层级', 'prompt.md'), '层级内的独特正文')
await writeFile(path.join(b, 'prompt.txt'), '跨位置独特正文')
const png = 'src/renderer/public/fitbay.png'
const first = 'a.png',
  second = 'z.png',
  renamed = path.basename(evidence) + '.png'
await copyFile(png, path.join(a, first))
await copyFile(png, path.join(a, second))
await writeFile(path.join(a, 'a.txt'), '图片配套描述')
const dist = path.resolve('dist/component-prototype')
let app, ui
const entries = () => ui.locator('.entries')
const button = (name) => entries().getByRole('button', { name, exact: true })
async function start() {
  app = await _electron.launch({
    args: [
      path.join(dist, 'host'),
      '--mode=prompts',
      '--workbench=' + path.join(dist, 'workbench/index.html'),
      '--user-data-dir=' + profile,
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
  await expect
    .poll(() => app.windows().some((p) => p.url().includes('/prompts/index.html')))
    .toBe(true)
  ui = app.windows().find((p) => p.url().includes('/prompts/index.html'))
  await expect(ui.getByRole('heading', { name: '文件库', exact: true })).toBeVisible()
  await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].setSize(1040, 730))
}
async function choose(label, folder) {
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, folder)
  await ui.getByRole('button', { name: label, exact: true }).click()
}
function shell(script, env = {}) {
  return execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from("$ProgressPreference='SilentlyContinue'\n" + script, 'utf16le').toString(
        'base64',
      ),
    ],
    {
      windowsHide: true,
      encoding: 'utf8',
      env: { ...process.env, FITBAY_QA_ROOT: a, FITBAY_QA_NAME: renamed, ...env },
    },
  )
}
const sh = "$ErrorActionPreference='Stop'\n$s=New-Object -ComObject Shell.Application\n"
const results = []
let drive
try {
  await start()
  await expect(button(first)).toBeVisible()
  await button(first).focus()
  await button(first).press('Space')
  const dialog = ui.getByRole('dialog', { name: '图片预览' })
  await expect(dialog.locator('img')).toBeVisible()
  await ui.getByRole('button', { name: '关闭预览' }).click()
  await ui.getByRole('button', { name: '打开同名 TXT' }).click()
  await expect(ui.locator('article pre')).toHaveText('图片配套描述')
  await ui.getByRole('button', { name: '复制正文' }).click()
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), '图片配套描述')
  await choose('打开文件夹', b)
  await ui.getByRole('button', { name: '添加当前常用位置' }).click()
  await ui.getByRole('button', { name: '返回默认目录' }).click()
  await ui.getByRole('button', { name: '加入工作台' }).click()
  await expect(ui.getByRole('button', { name: '独立打开' })).toBeVisible()
  const search = ui.getByLabel('搜索文件', { exact: true })
  await search.fill('跨位置独特正文')
  await expect(entries().locator('button')).toHaveCount(0)
  await ui.getByLabel('搜索范围').selectOption('all')
  await expect(entries()).toContainText('prompt.txt')
  await search.fill('')
  await ui.getByLabel('目录视图').selectOption('grid')
  const target = (n) =>
    entries()
      .locator('button')
      .filter({ has: ui.locator('span', { hasText: n }) })
      .first()
  await expect(target(first).locator('img')).toBeVisible()
  await ui.screenshot({ path: path.join(evidence, 'docked-files.png') })
  await ui.getByRole('button', { name: '独立打开' }).click()
  await expect(ui.getByRole('button', { name: '加入工作台' })).toBeVisible()
  await app.evaluate(({ BaseWindow }) =>
    BaseWindow.getAllWindows()
      .find((w) => w.getTitle() === '文件库')
      .setSize(1040, 730),
  )
  await ui.locator('nav').getByRole('button', { name: '层级', exact: true }).click()
  await expect(ui.getByLabel('目录视图')).toHaveValue('list')
  await expect(button('prompt.md')).toBeVisible()
  await ui.locator('nav').getByRole('button', { name: 'A', exact: true }).click()
  await expect(ui.getByLabel('目录视图')).toHaveValue('grid')
  await expect(target(first).locator('img')).toBeVisible()
  results.push('旧配置、目录层级、每目录视图、两种搜索范围、空格图片预览、同名 TXT、复制正文')
  await target(first).click()
  await expect(ui.locator('article img')).toBeVisible()
  shell(sh + "$s.Namespace($env:FITBAY_QA_ROOT).ParseName('a.png').Name=$env:FITBAY_QA_NAME")
  await expect(target(renamed)).toBeVisible()
  await expect(ui.locator('article h2')).toHaveText(renamed)
  shell(
    "Add-Type -AssemblyName Microsoft.VisualBasic\n[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile((Join-Path $env:FITBAY_QA_ROOT $env:FITBAY_QA_NAME),'OnlyErrorDialogs','SendToRecycleBin')",
  )
  await expect(target(renamed)).toHaveCount(0)
  await expect(ui.locator('article h2')).toHaveText(second)
  shell(
    sh +
      "$bin=$s.Namespace(10)\n$item=$bin.Items() | Where-Object { $_.ExtendedProperty('System.Recycle.DeletedFrom') -eq $env:FITBAY_QA_ROOT -and [IO.Path]::GetFileNameWithoutExtension($_.Name) -eq [IO.Path]::GetFileNameWithoutExtension($env:FITBAY_QA_NAME) } | Select-Object -First 1\nif(!$item){throw 'isolated recycle item missing'}\n$item.InvokeVerb('undelete')",
  )
  await expect(target(renamed)).toBeVisible()
  await target(renamed).click()
  const thumb = target(renamed).locator('img'),
    preview = ui.locator('article img').first()
  const before = await preview.getAttribute('src'),
    small = await thumb.getAttribute('src')
  const png2 = await app.evaluate(({ nativeImage }) =>
    nativeImage
      .createFromBitmap(Buffer.alloc(8 * 8 * 4, 195), { width: 8, height: 8 })
      .toPNG()
      .toString('base64'),
  )
  await writeFile(path.join(a, renamed), Buffer.from(png2, 'base64'))
  await expect(preview).toHaveAttribute('src', 'data:image/png;base64,' + png2)
  await expect.poll(() => thumb.getAttribute('src')).not.toBe(small)
  assert.notEqual(before, await preview.getAttribute('src'))
  await ui.screenshot({ path: path.join(evidence, 'after-overwrite.png') })
  await search.fill(renamed)
  await expect(entries().locator('button')).toHaveCount(1)
  shell(
    sh +
      '$s.Namespace($env:FITBAY_QA_DEST).MoveHere((Join-Path $env:FITBAY_QA_ROOT $env:FITBAY_QA_NAME),20)',
    { FITBAY_QA_DEST: b },
  )
  await expect(entries().locator('button')).toHaveAttribute('title', b + ' / ' + renamed)
  const permissionEnv = { FITBAY_QA_DENIED: b }
  const acl =
    "$path=$env:FITBAY_QA_DENIED; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=[IO.Directory]::GetAccessControl($path); $rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,'ListDirectory','Deny'); "
  try {
    shell(
      acl + '$acl.AddAccessRule($rule); [IO.Directory]::SetAccessControl($path,$acl)',
      permissionEnv,
    )
    await ui.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(ui.getByRole('status')).toContainText('目录暂时不可用')
    await expect(ui.locator('article h2')).toHaveText(renamed)
  } finally {
    shell(
      acl + '$acl.RemoveAccessRuleSpecific($rule); [IO.Directory]::SetAccessControl($path,$acl)',
      permissionEnv,
    )
  }
  await expect(entries().locator('button')).toHaveAttribute('title', b + ' / ' + renamed, {
    timeout: 12000,
  })
  results.push('拒绝列目录权限期间保留跨位置选中项，恢复权限后自动补查')
  results.push(
    'Windows Shell 改名、回收站删除并切换下一项、还原、图片覆盖与缩略图更新、跨常用目录移动',
  )
  await ui.getByText(/全局快捷键 ·/).click()
  await choose('设置调用目录', b)
  await choose('打开文件夹', b)
  await ui.getByRole('button', { name: '返回默认目录' }).click()
  assert.equal((await ui.evaluate(() => window.promptLibrary.state())).paletteRoot, b)
  const panelData = await promptLibrary(profile, () => {})
  try {
    const [hit] = await panelData.search('跨位置独特正文')
    assert.equal(hit.folder, b)
    assert.equal(await panelData.selection(hit.folder, hit.name), '跨位置独特正文')
    assert.equal((await panelData.search('层级内的独特正文')).length, 0)
  } finally {
    panelData.close()
  }
  await app.close()
  app = undefined
  await rename(path.join(a, second), path.join(a, '退出时改名.png'))
  await start()
  await expect(entries()).toContainText('退出时改名.png')
  await expect(ui.getByLabel('目录视图')).toHaveValue('grid')
  assert((await ui.evaluate(() => window.promptLibrary.state())).favorites.includes(b))
  results.push('退出期间变化、默认目录、视图、常用位置和独立调用目录持久化')
  if (process.platform === 'win32') {
    drive = ['Z:', 'Y:', 'X:', 'W:'].find((d) => !existsSync(d + '\\'))
    if (!drive) throw Error('no free verification drive')
    const backing = path.join(evidence, 'virtual-drive')
    await mkdir(backing)
    await writeFile(path.join(backing, 'disk.txt'), 'mounted')
    const mount = () => execFileSync('subst.exe', [drive, backing], { windowsHide: true })
    const unmount = () => execFileSync('subst.exe', [drive, '/D'], { windowsHide: true })
    mount()
    try {
      await choose('打开文件夹', drive + '\\')
      await expect(entries()).toContainText('disk.txt')
      assert.equal((await ui.evaluate(() => window.promptLibrary.state())).root.slice(0, 2), drive)
      await ui.getByRole('button', { name: '添加当前常用位置' }).click()
      unmount()
      await expect(ui.getByRole('status')).toContainText('目录暂时不可用')
      await writeFile(path.join(backing, 'disk-reconnected.txt'), 'reconnected')
      mount()
      await expect(entries()).toContainText('disk-reconnected.txt', { timeout: 10000 })
      results.push('独立虚拟盘符卸载与重连，常用位置保留、自动补扫')
    } finally {
      if (existsSync(drive + '\\')) unmount()
    }
  }
  if (process.env.FITBAY_SERPENT_ASSETS) {
    const assets = await realpath(process.env.FITBAY_SERPENT_ASSETS)
    await choose('打开文件夹', assets)
    await ui.locator('nav').getByRole('button', { name: '图片素材', exact: true }).click()
    await expect(entries()).toContainText('模型场景素材')
    await ui.screenshot({ path: path.join(evidence, 'serpent.png') })
    results.push('只读浏览实际 Serpent Assets / 图片素材层级')
  }
  await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].setSize(380, 580))
  await expect(ui.getByRole('button', { name: '位置与目录' })).toBeVisible()
  await ui.getByRole('button', { name: '位置与目录' }).click()
  await expect(ui.locator('nav')).toBeVisible()
  assert(await ui.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await ui.screenshot({ path: path.join(evidence, 'narrow-locations.png') })
  await writeFile(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2))
  console.log('PASS', results, evidence)
} finally {
  await app?.close()
}
