import { _electron, expect } from '@playwright/test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
const profile = await mkdtemp(path.resolve('tmp/capture-colors-'))
await mkdir(path.join(profile, 'toolkit'))
await writeFile(
  path.join(profile, 'toolkit/settings.json'),
  JSON.stringify({
    capture: { enabled: true, key: 'Control+Alt+F21' },
    selection: { enabled: false, key: '' },
  }),
)
const env = { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' }
const app = await _electron.launch({
  args: ['components/toolkit', '--workbench-profile=' + profile],
  env: {
    ...env,
    WORKBENCH_TEST_BACKGROUND: process.env.FITBAY_VISIBLE_CAPTURE === '1' ? '0' : '1',
  },
})
let host
try {
  const home = await app.firstWindow()
  host = await _electron.launch({
    args: [
      'dist/component-prototype/host',
      '--mode=workbench',
      '--user-data-dir=' + profile,
      '--workbench=' + path.resolve('out/renderer/index.html'),
    ],
    env,
  })
  const shell = await host.firstWindow()
  await shell.getByRole('button', { name: '组件', exact: true }).click()
  await shell.locator('#window-menu').getByText('工具集', { exact: true }).click()
  const dock = shell.locator('.toolkit-panel')
  const rect = await app.evaluate(async ({ BrowserWindow, screen }) => {
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const f = new BrowserWindow({
      x: d.bounds.x + 100,
      y: d.bounds.y + 100,
      width: 240,
      height: 130,
      frame: false,
      skipTaskbar: true,
      show: false,
      focusable: false,
      alwaysOnTop: true,
      backgroundColor: '#ef283e',
    })
    globalThis.colorFixture = f
    await f.loadURL(
      'data:text/html,' +
        encodeURIComponent(
          '<body style="margin:0;background:linear-gradient(to right,#ef283e 50%,#28ab59 50%);height:100vh"><strong style="position:absolute;left:42px;top:34px;background:white;color:black;font: bold 20px Arial">FITBAY 321</strong></body>',
        ),
    )
    f.showInactive()
    const sink = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    globalThis.colorSink = sink
    await sink.loadURL(
      'data:text/html,' + encodeURIComponent('<div contenteditable autofocus>paste</div>'),
    )
    return {
      x: 100,
      y: 100,
      origin: screen.dipToScreenPoint({ x: d.bounds.x + 135, y: d.bounds.y + 135 }),
      scale: d.scaleFactor,
    }
  })
  for (const entry of process.argv.includes('--colors-only') ? [] : ['dock', 'home', 'key']) {
    for (let round = 0; round < (entry === 'dock' ? 4 : 3); round++) {
      await app.evaluate(() => globalThis.colorFixture.showInactive())
      const opening = app.waitForEvent('window', { timeout: 10000 })
      if (entry === 'key')
        execFileSync('python', [
          '-c',
          'import ctypes,time;u=ctypes.windll.user32;keys=[17,18,132];[(u.keybd_event(k,0,0,0)) for k in keys];time.sleep(.04);[(u.keybd_event(k,0,2,0)) for k in reversed(keys)]',
        ])
      else
        await (entry === 'dock' ? dock : home)
          .getByRole('button', { name: '框选屏幕', exact: true })
          .click()
      const overlay = await opening
      await overlay.locator('.screen img').waitFor()
      console.log('overlay opened', entry, round)
      overlay.setDefaultTimeout(5000)
      await overlay.mouse.move(rect.x + 30, rect.y + 30)
      await overlay.mouse.down()
      await overlay.mouse.move(rect.x + 210, rect.y + 100, { steps: 8 })
      await overlay.mouse.up()
      for (const name of ['复制', '保存', '贴图置顶', '标注'])
        await expect(overlay.getByRole('button', { name, exact: true })).toBeVisible()
      const expected = await overlay.evaluate(async () => {
        const im = new Image()
        im.src = await window.toolkit.selectionImage()
        await im.decode()
        const c = document.createElement('canvas')
        c.width = im.naturalWidth
        c.height = im.naturalHeight
        const ctx = c.getContext('2d')
        ctx.drawImage(im, 0, 0)
        return {
          png: c.toDataURL(),
          samples: [0.2, 0.8].map((f) =>
            Array.from(
              ctx.getImageData(Math.floor(c.width * f), Math.floor(c.height / 2), 1, 1).data,
            ).slice(0, 3),
          ),
        }
      })
      const cropShot = await overlay.screenshot({
        clip: { x: rect.x + 35, y: rect.y + 35, width: 170, height: 60 },
      })
      const observed = execFileSync(
        'python',
        [
          '-c',
          "import io,sys,json;from PIL import Image;im=Image.open(io.BytesIO(sys.stdin.buffer.read())).convert('RGB');print(json.dumps([im.getpixel((int(im.width*f),im.height//2)) for f in (.2,.8)]))",
        ],
        { input: cropShot },
      )
      const visible = JSON.parse(observed)
      if (round === 0) await writeFile(path.join(profile, entry + '-region.png'), cropShot)
      assert(visible.every((c, i) => c.every((v, j) => Math.abs(v - expected.samples[i][j]) < 8)))
      if (process.env.FITBAY_VISIBLE_CAPTURE === '1' && entry === 'dock' && round === 0) {
        execFileSync('python', [
          '-c',
          `import ctypes,sys
from PIL import ImageGrab
ctypes.windll.user32.SetProcessDPIAware()
x,y,w,h=map(int,sys.argv[1:5])
im=ImageGrab.grab((x,y,x+w,y+h),all_screens=True)
left=im.getpixel((w//5,h//2));right=im.getpixel((4*w//5,h//2))
assert left[0]>190 and left[1]<70 and right[0]<70 and right[1]>145
im.save(sys.argv[5])`,
          String(rect.origin.x),
          String(rect.origin.y),
          String(Math.round(170 * rect.scale)),
          String(Math.round(60 * rect.scale)),
          path.join(profile, 'visible-region.png'),
        ])
      }
      console.log('toolbar ready', entry, round)
      if (entry === 'dock' && round < 2) {
        await overlay.getByRole('button', { name: '标注', exact: true }).click()
        const canvas = overlay.locator('.annotation-canvas')
        await canvas.waitFor()
        await overlay.mouse.move(149, 179)
        await overlay.mouse.down()
        await overlay.mouse.move(174, 188, { steps: 10 })
        await overlay.mouse.move(210, 160, { steps: 10 })
        await overlay.mouse.up()
        expected.png = await canvas.evaluate((c) => c.toDataURL())
        if (round === 1) {
          const output = path.join(profile, 'annotated-save.png')
          await app.evaluate(({ dialog }, destination) => {
            const show = dialog.showSaveDialog.bind(dialog)
            dialog.showSaveDialog = (win, options) =>
              show(win, {
                ...options,
                title: 'FitBay PNG ' + destination,
                defaultPath: destination,
              })
          }, output)
          const saveClick = overlay.getByRole('button', { name: '保存', exact: true }).click()
          await new Promise((r) => setTimeout(r, 350))
          execFileSync(
            'python',
            [
              '-c',
              `import sys
from pywinauto import Desktop
dlg=Desktop(backend='win32').window(title='FitBay PNG '+sys.argv[2],class_name='#32770',visible_only=False)
dlg.wait('exists',timeout=12)
button=Desktop(backend='uia').window(handle=dlg.handle).child_window(auto_id='1',control_type='Button')
button.invoke()
dlg.wait_not('exists',timeout=10)`,
              String(app.process().pid),
              output,
            ],
            { timeout: 20000 },
          )
          await saveClick
          await expect.poll(() => overlay.isClosed()).toBe(true)
          execFileSync('python', [
            '-c',
            "from PIL import Image,ImageChops;import sys;assert not ImageChops.difference(Image.open(sys.argv[1]).convert('RGB'),Image.open(sys.argv[2]).convert('RGB')).getbbox()",
            path.join(profile, 'annotated-paste.png'),
            output,
          ])
          console.log('PASS pencil paste and saved PNG pixel-identical', profile)
          continue
        }
      }
      if (round === 3) {
        const result = app.waitForEvent('window')
        await overlay.getByRole('button', { name: '提取文字' }).click()
        const answer = await result
        await expect(answer.locator('body')).toContainText(/FITBAY\s*321/i, { timeout: 20000 })
        await answer.close()
        console.log('PASS local OCR')
        continue
      }
      if (round === 2)
        await overlay.keyboard.down('Escape').catch((e) => {
          if (!overlay.isClosed()) throw e
        })
      else {
        await overlay.getByRole('button', { name: '复制', exact: true }).click()
      }
      await new Promise((r) => setTimeout(r, 400))
      if (!overlay.isClosed())
        console.log('overlay status', await overlay.locator('[role=status]').textContent())
      await expect.poll(() => overlay.isClosed(), { timeout: 4000 }).toBe(true)
      if (round === 2) continue
      const colors = await app.evaluate(async () => {
        const w = globalThis.colorSink.webContents
        await w.executeJavaScript(
          "document.querySelector('div').replaceChildren();document.querySelector('div').focus()",
        )
        w.paste()
        for (let i = 0; i < 40; i++) {
          if (await w.executeJavaScript("!!document.querySelector('img')")) break
          await new Promise((r) => setTimeout(r, 50))
        }
        return w.executeJavaScript(
          `(async()=>{const im=document.querySelector('img');await im.decode();const c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);return c.toDataURL()})()`,
        )
      })
      if (entry === 'dock' && round === 0)
        await writeFile(
          path.join(profile, 'annotated-paste.png'),
          Buffer.from(colors.split(',')[1], 'base64'),
        )
      assert(colors === expected.png, '粘贴后整张 PNG 像素与选区不符')
      assert(
        expected.samples[0][0] > 200 &&
          expected.samples[0][1] < 60 &&
          expected.samples[1][1] > 150 &&
          expected.samples[1][0] < 60,
      )
    }
    console.log('PASS', entry, 'two color-identical pastes and Escape')
  }
  for (const cancel of [false, true]) {
    const opening = app.waitForEvent('window')
    await dock.getByRole('button', { name: '框选屏幕' }).click()
    const picker = await opening
    await picker.locator('.screen img').waitFor()
    await picker.mouse.move(130, 130)
    await picker.mouse.down()
    await picker.mouse.move(310, 210)
    await picker.mouse.up()
    const expected = await picker.evaluate(async () => {
      const img = new Image()
      img.src = await window.toolkit.selectionImage()
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const rect = document.querySelector('.rect').getBoundingClientRect()
      const pixel = ctx.getImageData(
        Math.floor(((281 - rect.x) / rect.width) * canvas.width),
        Math.floor(((178 - rect.y) / rect.height) * canvas.height),
        1,
        1,
      ).data
      return (
        '#' +
        Array.from(pixel)
          .slice(0, 3)
          .map((n) => n.toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase()
      )
    })
    const previous = await app.evaluate(({ clipboard }) => clipboard.readText())
    await picker.getByRole('button', { name: '选区取色' }).click()
    await picker.locator('.swatch').waitFor()
    await picker.mouse.move(281, 178)
    await expect(picker.locator('output')).toHaveText(expected)
    if (cancel)
      await picker.keyboard.press('Escape').catch((e) => {
        if (!picker.isClosed()) throw e
      })
    else await picker.mouse.click(281, 178)
    await expect.poll(() => picker.isClosed()).toBe(true)
    assert.equal(
      await app.evaluate(({ clipboard }) => clipboard.readText()),
      cancel ? previous : expected,
    )
  }
  console.log('PASS selected image color, native clipboard and Esc')
  for (const entry of [dock, home]) {
    assert.deepEqual(await entry.locator('.tool-row strong').allTextContents(), [
      '屏幕截图',
      '划词助手',
      '屏幕取色',
    ])
    await expect(entry.getByText('其他工具', { exact: true })).toHaveCount(0)
    const pending = app.waitForEvent('window')
    await entry.getByRole('button', { name: '开始取色' }).click()
    const picker = await pending
    await picker.locator('.swatch').waitFor()
    await picker.mouse.move(290, 175)
    const expected = await picker.locator('output').textContent()
    assert.match(expected, /^#[0-9A-F]{6}$/)
    await picker.mouse.click(290, 175)
    await expect.poll(() => picker.isClosed()).toBe(true)
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), expected)
  }
  await dock.getByRole('button', { name: '设置', exact: true }).click()
  const section = dock.getByRole('region', { name: '屏幕取色' })
  const input = section.getByRole('textbox')
  await input.click()
  await input.press('Control+Alt+F9')
  await section.getByRole('button', { name: '保存屏幕取色快捷键' }).click()
  await expect
    .poll(() => app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Control+Alt+F9')))
    .toBe(true)
  await expect(dock.getByRole('status')).toContainText('快捷键已保存')
  const pending = app.waitForEvent('window', { timeout: 10000 })
  execFileSync('python', [
    '-c',
    'import ctypes,time;u=ctypes.windll.user32;keys=[17,18,120];[u.keybd_event(k,0,0,0) for k in keys];time.sleep(.05);[u.keybd_event(k,0,2,0) for k in reversed(keys)]',
  ])
  const picker = await pending
  await picker.locator('.swatch').waitFor()
  await picker.mouse.click(290, 175)
  // The user's session or another acceptance profile can own the system default.
  // Restoring a disabled tool still persists the default without taking their key.
  await section.getByRole('button', { name: '停用', exact: true }).click()
  await expect(section.getByRole('button', { name: '启用', exact: true })).toBeVisible()
  await section.getByRole('button', { name: '恢复默认' }).click()
  await expect(input).toHaveValue('Ctrl+Alt+C')
  await expect
    .poll(() => app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Control+Alt+F9')))
    .toBe(false)
  await dock.getByRole('button', { name: '返回', exact: true }).click()
  await dock.screenshot({ path: path.join(profile, 'primary-home.png') })
  console.log(
    'PASS both primary homes, native color clipboard, dock recorder, OS hotkey, default restore',
    profile,
  )
} finally {
  await host?.close()
  await app.close()
}
