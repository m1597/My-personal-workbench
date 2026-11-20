import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'

const root = await mkdtemp(path.resolve('tmp/music-settings-targets-'))
const profile = path.join(root, 'profile')
const store = new MusicStore(path.join(profile, 'fitbay-music'))
store.set('music-guide-v1', '1')
store.set('lx-bootstrap', 'done')
store.db.close()
const dir = path.resolve('dist/component-prototype')
const manifest = JSON.parse(await readFile(path.join(dir, 'music/component.json'), 'utf8'))
const app = await electron.launch({
  args: [path.join(dir, 'host'), '--mode=music', '--mute-audio', '--user-data-dir=' + profile],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  const page = await app.firstWindow()
  await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].setContentSize(1400, 850))
  await page.getByRole('tab', { name: '曲库', exact: true }).waitFor()
  async function locate(request, target) {
    await app.evaluate(
      ({ webContents }, payload) => {
        const target = webContents
          .getAllWebContents()
          .find((w) => w.getURL().includes('/music/index.html'))
        target.send('music-sample:state', payload)
      },
      {
        settingsRequest: request,
        settingsTarget: target,
        mode: 'standalone',
        presentation: 'full',
      },
    )
  }
  let request = 0
  const nav = page.getByRole('navigation', { name: '设置分类' })
  for (const { target, name, path: breadcrumb } of manifest.settingsEntries) {
    assert.ok(breadcrumb.startsWith('Music → 音乐设置 → ') && breadcrumb.endsWith(name))
    await locate(++request, target)
    if (target.startsWith('keys.')) {
      await expect(page.getByRole('checkbox', { name: '启用' + name })).toBeFocused()
      continue
    }
    await expect(nav.getByRole('button', { name, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  }
  assert.equal(
    await nav.getByRole('button').count(),
    manifest.settingsEntries.filter(({ target }) => !target.includes('.')).length,
  )
  await locate(++request, 'keys')
  await expect(page.getByText('启用应用内快捷键', { exact: true })).toBeVisible()
  for (const unknown of [undefined, 'obsolete']) {
    await locate(++request, unknown)
    await expect(nav.getByRole('button', { name: '快捷键' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  }
  await locate(++request, 'lyrics')
  await expect(page.getByRole('region', { name: '歌词', exact: true })).toBeFocused()
  await expect(nav.getByRole('button', { name: '歌词' })).toHaveAttribute('aria-pressed', 'true')
  await locate(request, 'keys')
  await page.screenshot({ path: path.join(root, 'lyrics.png') })
  await expect(nav.getByRole('button', { name: '歌词' })).toHaveAttribute('aria-pressed', 'true')
  console.log('PASS Music settings targets, compatibility and repeated snapshot', root)
} finally {
  await app.close()
}
