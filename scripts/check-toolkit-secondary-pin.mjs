import assert from 'node:assert/strict'
import path from 'node:path'
import { readDisplayPixels } from '../components/toolkit/native.mjs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { _electron, expect } from '@playwright/test'
const folder = await mkdtemp(path.resolve('tmp/toolkit-secondary-pin-'))
const app = await _electron.launch({
  args: ['components/toolkit', '--workbench-profile=' + folder],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1', WORKBENCH_TEST_HIDDEN_SURFACES: '1' },
})
try {
  const panel = await app.firstWindow()
  const fixture = await app.evaluate(
    async ({ BrowserWindow, desktopCapturer, nativeImage, screen }) => {
      const d = screen.getAllDisplays().find((d) => d.id !== screen.getPrimaryDisplay().id)
      if (!d || d.workArea.width < 450 || d.workArea.height < 250)
        throw Error('Secondary work area unavailable')
      const { x, y } = d.workArea
      const bounds = { x: x + 100, y: y + 80, width: 300, height: 140 }
      const sample = new BrowserWindow({
        ...bounds,
        show: false,
        frame: false,
        thickFrame: false,
        focusable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        resizable: false,
        webPreferences: { sandbox: true },
      })
      await sample.loadURL(
        'data:text/html,' +
          encodeURIComponent(
            '<body style="margin:0;background:linear-gradient(to right,#3978ad 50%,#c45b39 50%)"></body>',
          ),
      )
      sample.setBounds(bounds)
      if (JSON.stringify(sample.getContentBounds()) !== JSON.stringify(bounds))
        throw Error('Sample placement mismatch')
      sample.showInactive()
      screen.getCursorScreenPoint = () => ({ x: bounds.x + 20, y: bounds.y + 20 })
      // Reproduce a compositor black frame; the production fallback reads the physical monitor.
      desktopCapturer.getSources = async () => [
        {
          display_id: String(d.id),
          thumbnail: nativeImage.createFromBitmap(Buffer.alloc(16 * 16 * 4), {
            width: 16,
            height: 16,
          }),
        },
      ]
      return { bounds, display: d.bounds, scale: d.scaleFactor }
    },
  )
  await new Promise((r) => setTimeout(r, 350))
  let next = app.waitForEvent('window')
  await panel.getByRole('button', { name: '截图', exact: true }).click()
  const overlay = await next
  const image = overlay.locator('.screen > img')
  await image.waitFor({ timeout: 20000 })
  const x = fixture.bounds.x - fixture.display.x + 25,
    y = fixture.bounds.y - fixture.display.y + 25
  await overlay.mouse.move(x, y)
  await overlay.mouse.down()
  await overlay.mouse.move(x + 250, y + 85)
  await overlay.mouse.up()
  next = app.waitForEvent('window')
  await overlay.getByRole('button', { name: '贴图置顶', exact: true }).click()
  const pin = await next
  await expect.poll(() => overlay.isClosed()).toBe(true)
  const channels = await pin.locator('.pinned img').evaluate(async (img) => {
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)
    return [0.25, 0.75].map((r) =>
      Array.from(ctx.getImageData(Math.floor(c.width * r), Math.floor(c.height / 2), 1, 1).data),
    )
  })
  assert.deepEqual(channels, [
    [57, 120, 173, 255],
    [196, 91, 57, 255],
  ])
  const win = await app.browserWindow(pin)
  const bounds = await win.evaluate((w) => w.getContentBounds())
  const expected = { x: fixture.display.x + x, y: fixture.display.y + y, width: 250, height: 85 }
  for (const key of Object.keys(bounds))
    assert(Math.abs(bounds[key] - expected[key]) <= 1, JSON.stringify({ bounds, expected }))
  const physical = await app.evaluate(async ({ BrowserWindow, screen }, bounds) => {
    const sample = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().startsWith('data:'),
    )
    const pin = BrowserWindow.getAllWindows().find((w) => w.getTitle().includes('贴图'))
    const target = screen.getDisplayMatching(bounds)
    const area = target.workArea
    if (
      target.id === screen.getPrimaryDisplay().id ||
      bounds.x < area.x ||
      bounds.y < area.y ||
      bounds.x + bounds.width > area.x + area.width ||
      bounds.y + bounds.height > area.y + area.height
    )
      throw Error('Unsafe test bounds')
    await sample.webContents.executeJavaScript("document.body.style.background='lime'")
    pin.showInactive()
    return screen.dipToScreenRect(null, bounds)
  }, bounds)
  await expect
    .poll(async () => {
      const image = await readDisplayPixels(physical)
      return app.evaluate(({ nativeImage }, data) => {
        const img = nativeImage.createFromDataURL('data:image/png;base64,' + data)
        const { width, height } = img.getSize()
        return [0.25, 0.75].map((r) =>
          Array.from(
            img
              .crop({ x: Math.floor(width * r), y: Math.floor(height / 2), width: 1, height: 1 })
              .toBitmap(),
          )
            .slice(0, 3)
            .reverse(),
        )
      }, image.toString('base64'))
    })
    .toEqual([
      [57, 120, 173],
      [196, 91, 57],
    ])
  await pin.screenshot({ path: path.join(folder, 'pin.png') })
  await writeFile(
    path.join(folder, 'measurement.json'),
    JSON.stringify({ fixture, channels, bounds, expected }, null, 2),
  )
  console.log('PASS secondary physical pixels after compositor black frame', folder)
} finally {
  await app.close()
}
