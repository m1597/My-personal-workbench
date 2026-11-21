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
  env,
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
    return { x: 100, y: 100 }
  })
  for (const entry of ['dock', 'home', 'key']) {
    for (let round = 0; round < (entry === 'dock' ? 4 : 3); round++) {
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
      console.log('toolbar ready', entry, round)
      if (round === 3) {
        await overlay.getByRole('button', { name: '测距与取色' }).click()
        await overlay.mouse.click(150, 179)
        await overlay.mouse.click(190, 179)
        await expect(overlay.locator('output')).toContainText('Δx')
        const scale = await overlay.evaluate(
          () => document.querySelector('.screen>img').naturalWidth / innerWidth,
        )
        await expect(overlay.locator('output')).toContainText(String(Math.round(40 * scale)))
        const hex = await overlay.locator('.swatch + span').textContent()
        assert.equal(
          hex,
          '#' +
            expected.samples[0]
              .map((v) => v.toString(16).padStart(2, '0'))
              .join('')
              .toUpperCase(),
        )
        await overlay.getByRole('button', { name: '返回选区' }).click()
        const result = app.waitForEvent('window')
        await overlay.getByRole('button', { name: '提取文字' }).click()
        const answer = await result
        await expect(answer.locator('body')).toContainText(/FITBAY\s*321/i, { timeout: 20000 })
        await answer.close()
        console.log('PASS same region color, physical distance and local OCR')
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
} finally {
  await host?.close()
  await app.close()
}
