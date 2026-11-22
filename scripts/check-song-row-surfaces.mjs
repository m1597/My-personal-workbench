import path from 'node:path'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { recording } from '../components/music/offline-source.mjs'
import { selectSongRow } from './song-row-fixture.mjs'

await mkdir('tmp', { recursive: true })
const root = await mkdtemp(path.resolve('tmp/song-row-surfaces-'))
for (const mode of ['music', 'workbench']) {
  const profile = path.join(root, mode)
  const store = new MusicStore(path.join(profile, 'fitbay-music'))
  for (const title of ['Row Alpha', 'Row Beta']) {
    const file = path.join(root, title + '.wav')
    await writeFile(file, recording('fitbay-tone-1'))
    store.library.upsert({ file, title, artist: 'Row Artist', album: 'Row Album', duration: 20 })
  }
  store.db.exec('UPDATE local_tracks SET favorite=1')
  store.library.createPlaylist(
    'Row Playlist',
    store.library.list().map((t) => t.id),
  )
  store.set('music-guide-v1', 1)
  store.set('music-media-keys', 'off')
  store.set('music-global-keys', 'off')
  store.set('lx-bootstrap', 'done')
  store.db.close()
  const app = await electron.launch({
    args: [
      path.resolve('dist/component-prototype/host'),
      '--mode=' + mode,
      '--mute-audio',
      '--workbench=' + path.resolve('out/renderer/index.html'),
      '--user-data-dir=' + profile,
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
  try {
    let page = await app.firstWindow()
    if (mode === 'workbench') {
      await page.getByRole('button', { name: '组件', exact: true }).click()
      await page.getByRole('menuitemcheckbox', { name: 'Music', exact: true }).click()
      await expect
        .poll(() => app.windows().some((w) => w.url().includes('/music/index.html')))
        .toBe(true)
      page = app.windows().find((w) => w.url().includes('/music/index.html'))
      await expect
        .poll(() => page.evaluate(async () => (await window.musicWindow.status()).mode))
        .toBe('docked')
    }
    await app.evaluate(({ BaseWindow, app }) => {
      if (
        !app.commandLine.hasSwitch('mute-audio') ||
        BaseWindow.getAllWindows().some((w) => w.isFocusable())
      )
        throw Error('隔离条件未满足')
      BaseWindow.getAllWindows()[0].setContentSize(1000, 700)
      globalThis.fetch = async () => Response.json({ recordings: [], artists: [] })
    })
    const button = (name) => page.getByRole('button', { name, exact: true })
    const row = (scope) =>
      scope
        .locator('[data-song-row]')
        .filter({ has: page.getByText('Row Alpha', { exact: true }) })
        .first()
    const check = async (scope, label) => {
      const target = row(scope)
      const title = target.getByText('Row Alpha', { exact: true })
      const audio = page.locator('audio')
      await audio.evaluate((a) => a.pause())
      await selectSongRow(target, title)
      assert.equal(await audio.evaluate((a) => a.paused), true)
      await page.screenshot({ path: path.join(root, mode + '-' + label + '.png') })
      await title.dblclick()
      await expect.poll(() => audio.evaluate((a) => !a.paused && a.currentTime > 0)).toBe(true)
    }
    await page.getByRole('tab', { name: '歌单' }).click()
    for (const name of ['Row Playlist', '我的收藏']) {
      await button(name).click()
      await check(page, name)
      await button('多选').click()
      for (const title of ['Row Alpha', 'Row Beta']) {
        const box = page.getByRole('checkbox', { name: '选择' + title })
        await box.check()
        await expect(box).toBeChecked()
        await expect(box).toBeVisible()
      }
      await button('退出多选').click()
    }
    await row(page).getByRole('button', { name: 'Row Album', exact: true }).click()
    const album = page.getByRole('region', { name: '专辑主页' })
    await expect(album).toBeVisible()
    await album.getByRole('button', { name: '返回' }).click()
    await row(page).getByRole('button', { name: 'Row Artist', exact: true }).click()
    await check(page.getByRole('region', { name: '歌手主页' }), 'artist')
    console.log(mode, root)
  } finally {
    await app.close()
  }
}
