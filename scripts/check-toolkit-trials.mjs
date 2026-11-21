import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, stat, access } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { _electron, expect } from '@playwright/test'
const folder = await mkdtemp(path.resolve('tmp/toolkit-trials-')),
  input = path.join(folder, 'input'),
  output = path.join(folder, 'output'),
  profile = path.join(folder, 'profile')
await Promise.all([
  mkdir(input),
  mkdir(output),
  mkdir(path.join(profile, 'toolkit'), { recursive: true }),
])
await writeFile(
  path.join(profile, 'toolkit/settings.json'),
  JSON.stringify({
    capture: { key: 'Control+Alt+F21', enabled: true },
    selection: { key: 'Control+Alt+F22', enabled: false },
  }),
)
const pathOf = (n) => path.join(input, n)
const python = (source, ...args) =>
  execFileSync('python', ['-X', 'utf8', '-c', source, ...args], {
    encoding: 'utf8',
    env: { ...process.env, OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1' },
  })
python(
  `from pathlib import Path
from PIL import Image
from docx import Document
import sys
p=Path(sys.argv[1])
Image.new('RGB',(80,60),'red').save(p/'red.png')
Image.new('RGB',(40,30),'blue').save(p/'blue.webp',lossless=True)
Image.effect_noise((800,600),70).convert('RGB').save(p/'noise.png')
(p/'red.md').write_text('test prompt')
doc=Document();doc.add_paragraph('FitBay local conversion');doc.save(p/'document.docx')`,
  input,
)
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
  const backend = host || app
  page.setDefaultTimeout(12000)
  const B = (name, p = home) => p.getByRole('button', { name, exact: true })
  await expect(B('框选屏幕')).toBeVisible()
  for (const process of new Set([app, backend]))
    await process.evaluate(
      ({ dialog, clipboard, nativeImage, ClipboardItem }, f) => {
        globalThis.picked = []
        globalThis.testOutput = f.output
        globalThis.saveName = ''
        dialog.showOpenDialog = async (_, opts) => ({
          canceled: false,
          filePaths: opts.properties.includes('openDirectory') ? [f.output] : globalThis.picked,
        })
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: globalThis.saveName })
        clipboard.read = async () => [
          new ClipboardItem({
            'text/plain': 'Sample text',
            'text/html': '<p><strong>Sample</strong> text</p>',
            'image/png': new Blob([nativeImage.createFromPath(f.red).toPNG()], {
              type: 'image/png',
            }),
          }),
        ]
        clipboard.writeText = (t) => {
          globalThis.copied = t
        }
      },
      { output, red: pathOf('red.png') },
    )
  async function choose(names) {
    await backend.evaluate((_, paths) => {
      globalThis.picked = paths
    }, names.map(pathOf))
    await home.getByRole('button', { name: /^(重新)?选择文件$/ }).click()
  }
  const tool = (name) => home.getByRole('button', { name: new RegExp('^' + name) }).click()
  const back = async () => {
    await B('返回工具列表').click()
    if (await B('清除选择').isVisible()) await B('清除选择').click()
  }
  const shot = async (name, p = home) => p.screenshot({ path: path.join(folder, name + '.png') })
  await shot('home')
  if (host)
    await home.evaluate((el) => {
      el.style.width = '320px'
      el.style.maxWidth = '100%'
    })
  else await page.setViewportSize({ width: 320, height: 660 })
  assert(await home.locator('.tools-surface').evaluate((el) => el.scrollWidth <= el.clientWidth))
  await shot('narrow')
  for (const px of [16, 20, 24]) {
    await home.locator('.tool-list svg').evaluateAll((els, n) => {
      for (const el of els) {
        el.style.width = n + 'px'
        el.style.height = n + 'px'
      }
    }, px)
    await home.locator('.tool-list').screenshot({ path: path.join(folder, 'icons-' + px + '.png') })
  }
  await choose(['red.png'])
  await expect(B('两图对比')).toHaveCount(0)
  await expect(home.getByRole('button', { name: /^图片压缩/ })).toBeVisible()
  await B('清除选择').click()
  await tool('图片改尺寸')
  await choose(['red.png'])
  await home.getByLabel('输出宽度（像素）').fill('37')
  await home.getByLabel('输出高度（像素）').fill('29')
  await B('生成尺寸副本').click()
  await expect(home.locator('.tool-results')).toContainText('37 × 29')
  python(
    'from PIL import Image;import sys;assert Image.open(sys.argv[1]).size==(37,29)',
    path.join(output, 'red.png'),
  )
  await back()
  await tool('两图对比')
  await choose(['red.png', 'blue.webp'])
  await expect(home.locator('.compare-view img')).toHaveCount(2)
  await B('切换图片').click()
  assert.equal(
    await home
      .locator('.compare-view img')
      .last()
      .evaluate((e) => e.style.opacity),
    '0',
  )
  await home.getByLabel('上层不透明度').fill('35')
  await expect(home.locator('.compare-view img').last()).toHaveCSS('opacity', '0.35')
  await shot('compare')
  await back()
  await tool('多图拼接')
  await choose(['red.png', 'blue.webp'])
  await B('上移').last().click()
  await B('导出长图').click()
  await expect(home.getByRole('status')).toContainText('已导出')
  await B('导出 PDF').click()
  await expect(home.getByRole('status')).toContainText('图片合集.pdf')
  await back()
  await tool('图片压缩')
  await choose(['noise.png'])
  const original = await readFile(pathOf('noise.png'))
  await home.getByLabel('每张最大 KB').fill('8')
  await B('压缩并导出').click()
  await expect(home.locator('.tool-results')).toContainText('noise.jpg')
  assert((await stat(path.join(output, 'noise.jpg'))).size <= 8192)
  assert((await readFile(pathOf('noise.png'))).equals(original))
  await back()
  await tool('剪贴板处理')
  await B('读取剪贴板').click()
  await B('复制纯文本').click()
  assert.equal(await backend.evaluate(() => globalThis.copied), 'Sample text')
  await B('复制 Markdown').click()
  assert.equal(await backend.evaluate(() => globalThis.copied), '**Sample** text')
  for (const [btn, name] of [
    ['存为提示词', 'prompt.md'],
    ['保存 Markdown', 'clip.md'],
    ['保存 PNG', 'clip.png'],
  ]) {
    await backend.evaluate(
      (_, p) => {
        globalThis.saveName = p
      },
      path.join(output, name),
    )
    await B(btn).click()
    await expect(home.getByRole('status')).toContainText(name)
  }
  assert.equal(await readFile(path.join(output, 'prompt.md'), 'utf8'), 'Sample text')
  await back()
  await tool('逐行文本对比')
  await home.getByLabel('原文').fill('a\nb\nc')
  await home.getByLabel('新文本').fill('a\nadded\nb\nc')
  await B('设置').click()
  await expect(home.getByLabel('全局快捷键').first()).toBeVisible()
  await shot('pane-settings')
  await B('返回').click()
  await expect(home.getByLabel('原文')).toHaveValue('a\nb\nc')
  await B('比较文本').click()
  await expect(home.locator('.added')).toHaveText(/added/)
  await expect(home.locator('.removed')).toHaveCount(0)
  await back()
  await writeFile(pathOf('other.txt'), 'additional line')
  await choose(['red.md', 'other.txt'])
  await tool('逐行文本对比')
  await expect(home.getByLabel('原文')).toHaveValue('test prompt')
  await expect(home.getByLabel('新文本')).toHaveValue('additional line')
  await B('比较文本').click()
  await expect(home.locator('.removed')).toHaveCount(1)
  await back()
  await tool('配对重命名')
  await choose(['red.png', 'red.md'])
  await home.getByLabel('新名称前缀').fill('trial')
  await writeFile(pathOf('trial-001.md'), 'existing')
  await B('预览名称').click()
  await expect(B('确认重命名')).toBeDisabled()
  await home.getByLabel('新名称前缀').fill('pair')
  await B('预览名称').click()
  await expect(B('确认重命名')).toBeEnabled()
  await B('确认重命名').click()
  await expect(home.getByRole('status')).toContainText('2')
  assert.equal(await readFile(pathOf('pair-001.md'), 'utf8'), 'test prompt')
  assert.equal(await readFile(pathOf('trial-001.md'), 'utf8'), 'existing')
  await assert.rejects(access(pathOf('red.md')))
  await back()
  await writeFile(pathOf('caption.txt'), 'separate basename')
  await writeFile(pathOf('manual.png'), await readFile(pathOf('pair-001.png')))
  await tool('配对重命名')
  await choose(['manual.png', 'caption.txt'])
  const select = home.getByLabel('manual.png 的提示词')
  await select.selectOption({ label: 'caption.txt' })
  await home.getByLabel('新名称前缀').fill('manual-pair')
  await B('预览名称').click()
  await B('确认重命名').click()
  await expect(home.getByRole('status')).toContainText('2')
  assert.equal(await readFile(pathOf('manual-pair-001.txt'), 'utf8'), 'separate basename')
  await back()
  await tool('批量格式转换')
  await choose(['blue.webp', 'document.docx'])
  await B('开始转换').click()
  await expect(home.locator('.tool-results')).toContainText('document.pdf', { timeout: 120000 })
  await back()
  python(
    `from pathlib import Path
import pymupdf as pdf
from PIL import Image
import sys
p=Path(sys.argv[1])
im=Image.open(p/'长图.png').convert('RGB')
assert im.size==(80,90) and im.getpixel((40,10))==(0,0,255) and im.getpixel((40,60))==(255,0,0)
assert Image.open(p/'blue.png').getpixel((0,0))[:3]==(0,0,255)
assert Image.open(p/'clip.png').size==(80,60)
assert (p/'clip.md').read_text()=='**Sample** text'
album=pdf.open(p/'图片合集.pdf');assert len(album)==2
for page,expected in zip(album,[(0,0,255),(255,0,0)]):
 pix=page.get_pixmap();assert pix.pixel(pix.width//2,pix.height//2)[:3]==expected
assert 'FitBay local conversion' in pdf.open(p/'document.pdf')[0].get_text()`,
    output,
  )
  console.log(
    'PASS seven file and text tools, inputs filtered, original files preserved, image dimensions and colors, PDF pages and text',
    folder,
  )
  let waiting = app.waitForEvent('window')
  await tool('屏幕测距与取色')
  let overlay = await waiting
  await expect(overlay.locator('.measure-panel')).toBeVisible()
  await overlay.mouse.click(25, 25)
  await overlay.mouse.click(85, 105)
  await expect(overlay.locator('output')).toContainText('px')
  const expected = await overlay.evaluate(() => {
    const img = document.querySelector('.screen img')
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const x = Math.floor((85 * c.width) / innerWidth),
      y = Math.floor((105 * c.height) / innerHeight)
    return {
      hex:
        '#' +
        Array.from(ctx.getImageData(x, y, 1, 1).data)
          .slice(0, 3)
          .map((x) => x.toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase(),
      distance: Math.hypot(
        x - Math.floor((25 * c.width) / innerWidth),
        y - Math.floor((25 * c.height) / innerHeight),
      ).toFixed(1),
    }
  })
  await B('复制颜色', overlay).click()
  assert.equal(await app.evaluate(() => globalThis.copied), expected.hex)
  await expect(overlay.locator('output')).toContainText(expected.distance + ' px')
  await overlay.close()
  waiting = app.waitForEvent('window')
  await tool('截图标注')
  overlay = await waiting
  await expect(overlay.locator('.screen img')).toBeVisible()
  await overlay.mouse.move(25, 25)
  await overlay.mouse.down()
  await overlay.mouse.move(205, 165)
  await overlay.mouse.up()
  await expect(overlay.locator('.annotation-canvas')).toBeVisible()
  const originalCrop = await overlay.evaluate(() => window.toolkit.selectionImage())
  async function paint() {
    await overlay.mouse.move(50, 50)
    await overlay.mouse.down()
    await overlay.mouse.move(110, 100, { steps: 5 })
    await overlay.mouse.up()
  }
  await paint()
  await B('撤销', overlay).click()
  await paint()
  await B('应用标注', overlay).click()
  await expect(overlay.locator('.annotation-canvas')).toHaveCount(0)
  assert((await overlay.evaluate(() => window.toolkit.selectionImage())) !== originalCrop)
  await expect(B('贴图置顶', overlay)).toBeVisible()
  // Capture only controls. Conceal the real desktop pixels behind the toolbar.
  await overlay.addStyleTag({
    content: '.screen>img{visibility:hidden}.screen .bar{background:#283644}',
  })
  for (const px of [16, 20, 24]) {
    await overlay.locator('.bar svg').evaluateAll(
      (icons, n) =>
        icons.forEach((icon) => {
          icon.style.width = n + 'px'
          icon.style.height = n + 'px'
        }),
      px,
    )
    await overlay.locator('.bar').screenshot({ path: path.join(folder, 'toolbar-' + px + '.png') })
  }

  await overlay.close()
  console.log(
    'PASS actual desktop capture, annotation application and calibrated physical-pixel distance/color',
  )
} finally {
  await host?.close()
  await app.close()
}
