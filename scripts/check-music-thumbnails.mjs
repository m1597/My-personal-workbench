import { _electron as electron, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { MusicStore } from '../components/music/store.mjs'
import { recording } from '../components/music/offline-source.mjs'

const profile = await mkdtemp(path.resolve('tmp/music-thumbnails-'))
const store = new MusicStore(path.join(profile, 'fitbay-music'))
for (const title of ['A', 'B', 'C']) {
  const file = path.join(profile, title + '.wav')
  await writeFile(file, recording('fitbay-tone-1'))
  store.library.upsert({ file, title, artist: 'test', album: '', duration: 20 })
}
store.set('music-media-keys', 'off')
store.db.close()
const app = await electron.launch({
  args: [
    path.resolve('dist/component-prototype/host'),
    '--mode=music',
    '--mute-audio',
    '--workbench=' + path.resolve('out/renderer/index.html'),
    '--user-data-dir=' + profile,
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  const page = await app.firstWindow()
  await app.evaluate(({ BaseWindow }) => {
    const register = BaseWindow.prototype.setThumbarButtons
    globalThis.registrations = new Map()
    globalThis.thumbnailImages = new Map()
    globalThis.iconProbe = new BaseWindow({ show: false, skipTaskbar: true, x: -16000, y: 0 })
    globalThis.iconProbe.setBounds({ x: -16000, y: 0, width: 64, height: 64 })
    BaseWindow.prototype.setThumbarButtons = function (buttons) {
      const ok = register.call(this, buttons)
      for (const button of buttons) globalThis.thumbnailImages.set(button.tooltip, button.icon)
      globalThis.registrations.set(
        this.id,
        buttons.map((b) => ({
          label: b.tooltip,
          icon: b.icon.toPNG().toString('base64'),
          disabled: b.flags.includes('disabled'),
        })),
      )
      return ok
    }
  })
  await page.getByRole('button', { name: '跳过', exact: true }).click()
  expect(await app.evaluate(({ app }) => app.commandLine.hasSwitch('mute-audio'))).toBe(true)
  const check = async (mode) => {
    const icons = new Map()
    const id = 'FitBay.ThumbnailTest.' + process.pid + '.' + mode
    const windowId = await app.evaluate(
      ({ BaseWindow }, { id, mode }) => {
        const owner = BaseWindow.getAllWindows().find((w) =>
          mode === 'standalone' ? w.getTitle() === 'Music' : w.webContents && w.isVisible(),
        )
        owner.setTitle(id)
        return owner.id
      },
      { id, mode },
    )
    if (mode === 'standalone') {
      await page.getByRole('button', { name: '播放B', exact: true }).click()
      await page.locator('.music-order').click()
      await page.locator('.music-order').click()
    }
    await expect(page.locator('.music-order')).toHaveText('单曲循环')
    for (const [label, title, paused] of [
      ['暂停', 'B', true],
      ['播放', 'B', false],
      ['上一首', 'A', false],
      ['下一首', 'B', false],
    ]) {
      const before = await page.locator('.music-transport strong').textContent()
      const buttons = () => app.evaluate((_, id) => globalThis.registrations.get(id), windowId)
      await expect
        .poll(async () => (await buttons())?.some((b) => b.label === label && !b.disabled))
        .toBe(true)
      const controls = await buttons()
      expect(controls.map((b) => b.label)).toEqual([
        '上一首',
        label === '播放' ? '播放' : '暂停',
        '下一首',
      ])
      for (const b of controls) {
        expect(b.icon.length).toBeGreaterThan(0)
        if (!icons.has(b.label)) {
          const hwnd = await app.evaluate((_, label) => {
            const probe = globalThis.iconProbe
            probe.setIcon(globalThis.thumbnailImages.get(label))
            return probe.getNativeWindowHandle().readUInt32LE(0)
          }, b.label)
          execFileSync(
            'python',
            ['scripts/win32-thumbnail-icon.py', String(hwnd), b.label, profile],
            {
              windowsHide: true,
              env: { ...process.env, PYTHONUTF8: '1' },
            },
          )
        }
        icons.set(b.label, b.icon)
      }
      const result = execFileSync('python', ['scripts/win32-thumbnail-command.py', id, label], {
        windowsHide: true,
        encoding: 'utf8',
        timeout: 45000,
        env: { ...process.env, PYTHONUTF8: '1' },
      })
      await expect.poll(() => page.locator('audio').evaluate((a) => a.paused)).toBe(paused)
      await expect(page.locator('.music-transport strong')).toHaveText(title)
      console.log(mode, label, before, '→', title, paused ? 'paused' : 'playing', result.trim())
    }
    expect(new Set(icons.values()).size).toBe(4)
  }
  await check('standalone')
  await page.evaluate(() => window.musicWindow.transfer('attach'))
  await expect
    .poll(() => page.evaluate(async () => (await window.musicWindow.status()).mode))
    .toBe('docked')
  await check('docked')
  console.log('PASS', 'WM_COMMAND notifications', profile)
} finally {
  await app.close()
}
