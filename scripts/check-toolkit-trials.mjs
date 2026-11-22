import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { _electron, expect } from '@playwright/test'
const folder = await mkdtemp(path.resolve('tmp/toolkit-trials-')),
  profile = path.join(folder, 'profile')
await mkdir(path.join(profile, 'toolkit'), { recursive: true })
await writeFile(
  path.join(profile, 'toolkit/settings.json'),
  JSON.stringify({
    capture: { key: 'Control+Alt+F21', enabled: true },
    selection: { key: 'Control+Alt+F22', enabled: false },
  }),
)
const python = (source, ...args) =>
  execFileSync('python', ['-X', 'utf8', '-c', source, ...args], {
    encoding: 'utf8',
    env: { ...process.env, OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1' },
  })
const defaults = { env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' } }
const packed = process.argv.includes('--packaged')
const app = await _electron.launch({
  ...defaults,
  ...(packed
    ? {
        executablePath: path.resolve('.cache/fitbay-build/toolkit/win-unpacked/FitBay Toolkit.exe'),
      }
    : {}),
  args: [...(packed ? [] : [path.resolve('components/toolkit')]), '--workbench-profile=' + profile],
})
let host
try {
  let page = await app.firstWindow(),
    home = page
  if (process.argv.includes('--host')) {
    host = await _electron.launch({
      ...defaults,
      args: [
        path.resolve('dist/component-prototype/host'),
        '--mode=workbench',
        '--user-data-dir=' + profile,
        '--workbench=' + path.resolve('out/renderer/index.html'),
      ],
    })
    const shell = await host.firstWindow()
    await shell.getByRole('button', { name: '组件', exact: true }).click()
    await shell.locator('#window-menu').getByText('工具集', { exact: true }).click()
    await expect(shell.locator('.toolkit-panel')).toBeVisible()
    await shell.screenshot({ path: path.join(folder, 'host.png') })
    page = shell
    home = shell.locator('.toolkit-panel')
  }
  if (packed) {
    const handle = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE().toString(),
    )
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.resolve('scripts/check-toolkit-icons.ps1'),
        handle,
        path.resolve('.cache/fitbay-build/toolkit/win-unpacked/FitBay Toolkit.exe'),
        folder,
      ],
      { windowsHide: true },
    )
    python(
      `from PIL import Image, ImageChops,ImageStat
import sys, pathlib
p=pathlib.Path(sys.argv[1]);expected=Image.open('components/toolkit/toolkit.ico').convert('RGBA')
def solid(im):
 im=im.convert('RGBA').resize((32,32));out=Image.new('RGB',im.size,(36,43,49));out.paste(im,mask=im.getchannel('A'));return out
for file in ('exe-icon.png','window-icon.png','shortcut-icon.png'):
 error=ImageStat.Stat(ImageChops.difference(solid(Image.open(p/file)),solid(expected))).mean
 assert max(error)<35,(file,error)`,
      folder,
    )
    console.log('PASS Win32 window icon, PE executable and Windows Shell shortcut icon')
  }
  page.setDefaultTimeout(12000)
  const B = (name, p = home) => p.getByRole('button', { name, exact: true })
  await expect(B('框选屏幕')).toBeVisible()
  assert.deepEqual(await home.locator('.tool-row strong').allTextContents(), [
    '屏幕截图',
    '划词助手',
    '屏幕取色',
  ])
  await B('设置').click()
  await expect(home.getByRole('heading', { name: '屏幕取色' })).toBeVisible()
  await B('返回').click()
  await expect(B('开始取色')).toBeVisible()
  console.log('PASS current desktop entry, three tools and in-pane settings', folder)
} finally {
  await host?.close()
  await app.close()
}
