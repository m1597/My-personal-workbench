import { expect } from '@playwright/test'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import executable from 'electron'
import path from 'node:path'
export async function dragMusicIn(app, shell, box, direction = 'within', u = 0.5, v = 0.5) {
  if (!shell) {
    const profile = await app.evaluate(({ app }) => app.getPath('userData'))
    await promisify(execFile)(
      executable,
      [
        path.resolve('dist/component-prototype/host'),
        '--mode=workbench',
        '--user-data-dir=' + profile,
      ],
      { windowsHide: true },
    )
    await expect
      .poll(() => app.windows().some((p) => p.url().includes('/renderer/index.html')))
      .toBe(true)
    shell = app.windows().find((p) => p.url().includes('/renderer/index.html'))
  }
  if (!box) {
    const target = shell.locator('.dv-groupview').filter({ has: shell.getByTestId('module-2') })
    box = await ((await target.count()) ? target : shell.locator('.docking-area')).boundingBox()
  }
  const info = await app.evaluate(
    ({ BaseWindow, BrowserWindow, screen }, { box, u, v }) => {
      const source = BaseWindow.getAllWindows().find((w) => w.getTitle().includes('Music'))
      const dest = BrowserWindow.getAllWindows()[0].getContentBounds()
      const x = Math.round(dest.x + box.x + u * box.width - source.getBounds().width / 2)
      const y = Math.round(dest.y + box.y + v * box.height - 16)
      source.setPosition(x, y - 600)
      screen.getCursorScreenPoint = () => {
        const b = source.getBounds()
        return { x: Math.round(b.x + b.width / 2), y: b.y + 16 }
      }
      return {
        x,
        y,
        id: source.id,
        hwnd: source.getNativeWindowHandle().readBigUInt64LE().toString(),
      }
    },
    { box, u, v },
  )
  const message = (value) =>
    promisify(execFile)(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-File',
        path.resolve('scripts/native-dock-probe.ps1'),
        info.hwnd,
        String(value),
      ],
      { windowsHide: true, timeout: 10000 },
    )
  await message(0x231)
  await message(0x216)
  await app.evaluate(({ BaseWindow }, i) => BaseWindow.fromId(i.id).setPosition(i.x, i.y), info)
  await expect(shell.locator('.component-drop-preview')).toHaveAttribute(
    'data-direction',
    direction,
  )
  await message(0x232)

  await expect(shell.getByRole('tab', { name: 'Music', exact: true })).toBeVisible()
}
export async function dragMusicOut(app) {
  const shell = app.windows().find((p) => p.url().includes('/renderer/index.html'))
  const tab = shell.getByRole('tab', { name: 'Music', exact: true })
  const box = await tab.boundingBox()
  await shell.mouse.move(box.x + 20, box.y + box.height / 2)
  await shell.mouse.down()
  await shell.mouse.move(-100, box.y + box.height / 2, { steps: 16 })
  await shell.mouse.up()
  await expect(tab).toHaveCount(0)
}
