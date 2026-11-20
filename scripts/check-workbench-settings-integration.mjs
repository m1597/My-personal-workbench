import { _electron as electron, expect } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { recording } from '../components/music/offline-source.mjs'
import { MusicStore } from '../components/music/store.mjs'
const root = await mkdtemp(path.resolve('tmp/settings-integration-'))
const profile = path.join(root, 'profile')
const store = new MusicStore(path.join(profile, 'fitbay-music'))
store.set('music-guide-v1', '1')
store.set('lx-bootstrap', 'done')
const file = path.join(root, 'settings.wav')
await writeFile(file, recording('fitbay-tone-1'))
store.library.upsert({ file, title: '测试', artist: 'FitBay', album: '', duration: 20 })
store.db.close()
const probe = path.join(root, 'probe.cjs')
await writeFile(
  probe,
  `const {Tray,net}=require('electron');const actual=net.fetch.bind(net);net.fetch=(...args)=>(global.fixtureFetch||actual)(...args);const set=Tray.prototype.setContextMenu;Tray.prototype.setContextMenu=function(menu){global.testTray=menu;return set.call(this,menu)}`,
)
const app = await electron.launch({
  args: [
    '--require',
    probe,
    path.resolve('dist/component-prototype/host'),
    '--mode=workbench',
    '--component=' + path.resolve('dist/component-prototype/component'),
    '--workbench=' + path.resolve('out/renderer/index.html'),
    '--user-data-dir=' + profile,
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  const shell = await app.firstWindow()
  shell.setDefaultTimeout(8000)
  const button = (name) => shell.getByRole('button', { name, exact: true })
  await button('打开 Music').click()
  await expect
    .poll(() => app.windows().some((p) => p.url().includes('/music/index.html')))
    .toBe(true)
  const original = app.windows().find((p) => p.url().includes('/music/index.html'))
  await original.getByRole('tab', { name: '曲库', exact: true }).click()
  await original.getByRole('button', { name: '播放测试', exact: true }).click()
  const before = await original.locator('audio').evaluate((a) => {
    window.probeAudio = a
    window.probeInterrupted = false
    a.addEventListener('pause', () => {
      window.probeInterrupted = true
    })
    return a.currentTime
  })
  for (const name of ['歌词', '快捷键', '应用内快捷键']) {
    await button('工作台设置').click()
    await shell.getByRole('searchbox').fill(name)
    await button(
      'Music › 音乐设置 › ' + (name === '应用内快捷键' ? '快捷键 › ' : '') + name,
    ).click()
    await expect
      .poll(() => app.windows().some((p) => p.url().includes('/music/index.html')))
      .toBe(true)
    const player = app.windows().find((p) => p.url().includes('/music/index.html'))
    if (name === '应用内快捷键') await expect(player.locator('#music-keys-app')).toBeFocused()
    await expect(
      player
        .getByRole('navigation', { name: '设置分类' })
        .getByRole('button', { name: name === '应用内快捷键' ? '快捷键' : name, exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
  }
  await button('工作台设置').click()
  await expect
    .poll(() =>
      original
        .locator('audio')
        .evaluate((a) =>
          a === window.probeAudio && !window.probeInterrupted && !a.paused ? a.currentTime : -1,
        ),
    )
    .toBeGreaterThan(before)
  const search = shell.getByRole('searchbox')
  await search.fill('zz-no-match')
  await expect(shell.getByText('没有匹配的设置')).toBeVisible()
  await search.fill('更新')
  await button('更新 › 检查全部更新').click()
  await button('检查全部更新').click()
  await expect
    .poll(() => shell.evaluate(async () => (await window.fitbayUpdates.snapshot()).lastChecked), {
      timeout: 25000,
    })
    .toBeTruthy()
  const live = await shell.evaluate(() => window.fitbayUpdates.snapshot())
  await expect(shell.getByText(/未接入在线更新/)).toBeVisible()
  await writeFile(path.join(root, 'live.json'), JSON.stringify(live, null, 2))
  await app.evaluate(() => {
    globalThis.fixtureFetch = async () => new Response('{}', { status: 503 })
  })
  await button('检查全部更新').click()
  await expect(shell.getByText(/检查失败/).first()).toBeVisible()
  await app.evaluate(() => {
    globalThis.fixtureFetch = async () => Response.json({ tag_name: 'v0.1.0', assets: [] })
  })
  await shell.getByRole('button', { name: '重试' }).first().click()
  await expect(shell.getByText(/已是最新/)).toHaveCount(1)
  await expect(shell.getByText(/检查失败/)).toHaveCount(1)
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(920, 680),
  )
  await button('关闭设置').click()
  await app.evaluate(() => globalThis.testTray.items.find((i) => i.label === '检查更新').click())
  await expect(button('检查全部更新')).toBeVisible()
  await shell.screenshot({ path: path.join(root, 'updates.png') })
  console.log('PASS', root, live)
} finally {
  await app.close()
}
