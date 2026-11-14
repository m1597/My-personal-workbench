import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, writeFile, rename } from 'node:fs/promises'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'

const root = await mkdtemp(path.resolve('tmp/playlist-artwork-'))
const profile = path.join(root, 'profile')
const dir = path.join(profile, 'fitbay-music')
const groups = ['我的收藏', '通勤', '歌曲推荐']
const store = new MusicStore(dir)
store.set('lx-bootstrap', 'done')
store.set('music-guide-v1', 1)
store.set('latest-daily-run', 'test-batch')
store.library.createPlaylist(groups[1])
store.db.close()

const expected = new Map()
async function open() {
  const app = await electron.launch({
    args: [
      path.resolve('dist/component-prototype/host'),
      '--mode=music',
      '--mute-audio',
      '--user-data-dir=' + profile,
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
  const page = await app.firstWindow()
  await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].setContentSize(1260, 760))
  await expect(page.getByRole('tab', { name: '曲库', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: '歌单', exact: true }).click()
  return { app, page }
}
async function select(page, name) {
  const nav = page.getByRole('button', { name: '歌单导航' })
  if ((await nav.isVisible()) && (await nav.getAttribute('aria-expanded')) === 'false')
    await nav.click()
  await page.getByRole('button', { name, exact: true }).click()
  return page.getByRole('button', { name: '更换封面', exact: true })
}
async function choose(app, file) {
  await app.evaluate(({ dialog }, file) => {
    globalThis.pickerCalls = 0
    dialog.showOpenDialog = async () => {
      globalThis.pickerCalls++
      await new Promise((resolve) => {
        globalThis.finishPicker = resolve
      })
      return { canceled: !file, filePaths: file ? [file] : [] }
    }
  }, file)
}
let session = await open()
try {
  for (const [i, name] of groups.entries()) {
    const { app, page } = session
    const button = await select(page, name)
    const png = await page.evaluate((i) => {
      const c = document.createElement('canvas')
      c.width = 128
      c.height = 80
      const g = c.getContext('2d')
      g.fillStyle = ['#a4262c', '#0078d4', '#008272'][i]
      g.fillRect(0, 0, c.width, c.height)
      return c.toDataURL().split(',')[1]
    }, i)
    const file = path.join(root, i + '.png')
    await writeFile(file, Buffer.from(png, 'base64'))
    await choose(app, file)
    const image = page.locator('.playlist-cover img')
    await image.click()
    await page.evaluate(() => window.music.state())
    assert.equal(await app.evaluate(() => globalThis.pickerCalls), 0)
    await expect(button).toBeVisible()
    await button.evaluate((el) => {
      el.click()
      el.click()
      el.click()
    })
    await expect(button).toBeDisabled()
    await expect.poll(() => app.evaluate(() => globalThis.pickerCalls)).toBe(1)
    await app.evaluate(() => globalThis.finishPicker())
    await expect(page.getByRole('button', { name: '恢复自动封面' })).toBeVisible()
    await expect(image).toHaveAttribute('src', /^data:image\/png;base64,/)
    expected.set(name, await image.getAttribute('src'))
    assert.equal(await image.evaluate((img) => img.naturalWidth), 80)
    await choose(app, null)
    await button.click()
    await expect.poll(() => app.evaluate(() => globalThis.pickerCalls)).toBe(1)
    await app.evaluate(() => globalThis.finishPicker())
    await expect(button).toBeEnabled()
    await expect(image).toHaveAttribute('src', expected.get(name))
    await rename(file, file + '.moved')
  }
  assert.equal(new Set(expected.values()).size, 3)
  const stopped = new Promise((resolve) => session.app.process().once('exit', resolve))
  await session.app.close()
  await stopped
  session = null
  const next = new MusicStore(dir)
  next.set('latest-daily-run', next.saveSuggestions('下一轮', [], '待处理', undefined, 5))
  next.db.close()
  session = await open()
  for (const name of groups) {
    await select(session.page, name)
    await expect(session.page.locator('.playlist-cover img')).toHaveAttribute(
      'src',
      expected.get(name),
    )
    await session.page.screenshot({
      path: path.join(root, name + '.png'),
      style: ':root {background:var(--base)!important}',
    })
  }
  await expect(session.page.locator('.playlist-cover img')).toHaveAttribute(
    'src',
    expected.get('歌曲推荐'),
  )
  await session.page.getByRole('button', { name: '恢复自动封面' }).click()
  await expect(session.page.locator('.playlist-cover img')).toHaveAttribute(
    'src',
    './default-cover.png',
  )
  for (const name of groups.slice(0, 2)) {
    await select(session.page, name)
    await expect(session.page.locator('.playlist-cover img')).toHaveAttribute(
      'src',
      expected.get(name),
    )
  }
  console.log('三类歌单封面、取消、重启、换批及独立恢复已验证', root)
} finally {
  await session?.app.close()
}
