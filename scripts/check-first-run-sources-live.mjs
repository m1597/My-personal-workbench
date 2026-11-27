import path from 'node:path'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron, expect } from '@playwright/test'

const root = await fs.mkdtemp(path.resolve('tmp/first-run-sources-')),
  profile = path.join(root, 'profile')
const launch = () =>
  electron.launch({
    args: [
      path.resolve('dist/component-prototype/host'),
      '--mode=music',
      '--mute-audio',
      '--user-data-dir=' + profile,
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
let app = await launch()
try {
  const page = await app.firstWindow()
  console.log('profile', root)
  const offline = process.env.FITBAY_BOOTSTRAP_OFFLINE === '1'
  if (offline)
    await app.evaluate(({ net }) => {
      const dns = process.getBuiltinModule('node:dns/promises'),
        lookup = dns.lookup.bind(dns),
        fetch = net.fetch.bind(net)
      const blocked = (url) =>
        ['raw.githubusercontent.com', 'api.github.com', 'gh-proxy.org'].includes(url)
      globalThis.repositoryOffline = true
      globalThis.denied = 0
      net.fetch = (url, options) => {
        if (globalThis.repositoryOffline && blocked(new URL(url).hostname)) {
          globalThis.denied++
          return Promise.reject(Error('暂时断网'))
        }
        return fetch(url, options)
      }
      dns.lookup = (host, options) => {
        if (globalThis.repositoryOffline && blocked(host)) {
          globalThis.denied++
          return Promise.reject(Error('暂时断网'))
        }
        return lookup(host, options)
      }
      process.getBuiltinModule('node:module').syncBuiltinESMExports()
    })
  assert.ok(
    await app.evaluate(
      ({ app, BaseWindow }) =>
        app.commandLine.hasSwitch('mute-audio') &&
        BaseWindow.getAllWindows().every((w) => !w.isFocusable()),
    ),
  )
  const key = async (target) => {
    await target.focus()
    await target.press('Enter')
  }
  const skip = page.getByRole('button', { name: '跳过', exact: true })
  if (await skip.isVisible()) await key(skip)
  await key(page.getByRole('tab', { name: '找歌', exact: true }))
  await key(page.getByRole('tab', { name: '普通搜索', exact: true }))
  const input = page.getByRole('textbox', { name: '搜索关键词' })
  await input.fill('Monkeys Spinning Monkeys Kevin MacLeod')
  const button = page.getByRole('button', { name: '搜索', exact: true })
  if (offline) {
    await expect
      .poll(() => app.evaluate(() => globalThis.denied), { timeout: 10000 })
      .toBeGreaterThan(0)
    await expect(button).toBeDisabled()
    await app.evaluate(() => {
      globalThis.repositoryOffline = false
    })
  }
  await expect(button).toBeEnabled({ timeout: 95000 })
  const first = await page.evaluate(() => window.music.lxSources())
  console.log(
    'first',
    first.installed.map((s) => s.name),
    first.active,
  )
  const pane = page.getByRole('region', { name: '搜索音乐' })
  const report = { offline, firstCount: first.installed.length, active: first.active, attempts: [] }
  if (offline) report.deniedRepositoryRequests = await app.evaluate(() => globalThis.denied)
  let audio
  for (const platform of ['酷狗音乐', 'QQ 音乐', '网易云音乐']) {
    const tab = pane.getByRole('tab', { name: platform })
    try {
      if ((await tab.getAttribute('aria-selected')) === 'true') await key(button)
      else await key(tab)
      const row = pane
        .locator('li.search-recording')
        .filter({ hasText: /Monkeys Spinning Monkeys/i })
        .filter({ hasText: /Kevin MacLeod/i })
        .first()
      const group = pane
        .locator('details')
        .filter({ hasText: /Monkeys Spinning Monkeys/i })
        .first()
      await expect
        .poll(async () => (await row.isVisible()) || (await group.isVisible()), { timeout: 26000 })
        .toBe(true)
      if (!(await row.isVisible())) await key(group.locator('summary'))
      await row.dispatchEvent('dblclick')
      await expect
        .poll(
          () =>
            page
              .locator('audio')
              .evaluate(
                (a) => !a.paused && a.currentTime > 0.3 && a.duration > 120 && a.duration < 130,
              ),
          { timeout: 23000 },
        )
        .toBe(true)
      audio = await page.locator('audio').evaluate((a) => ({
        time: a.currentTime,
        duration: a.duration,
        protocol: new URL(a.currentSrc).protocol,
      }))
      report.attempts.push({ platform, audio })
      break
    } catch (error) {
      report.attempts.push({
        platform,
        status: await pane.getByRole('status').allTextContents(),
        message: String(error).slice(0, 220),
      })
      console.log(report.attempts.at(-1))
    }
  }
  const db = new DatabaseSync(path.join(profile, 'fitbay-music/music.sqlite'), { readOnly: true })
  const rows = () => db.prepare('SELECT id,digest FROM music_sources ORDER BY id').all()
  await expect
    .poll(() => db.prepare('select value from state where key=?').get('lx-bootstrap')?.value, {
      timeout: 120000,
    })
    .toBe('done')
  const before = rows()
  const catalog = await page.evaluate(() => window.music.lxSources())
  report.installed = catalog.installed.map((s) => ({ id: s.id, name: s.name, origins: s.origins }))
  report.configuration = catalog.configuration
  report.audio = audio
  await page.screenshot({
    path: path.join(root, 'ordinary-search.png'),
    style: ':root {background:var(--base)!important}',
  })
  await app.close()
  app = await launch()
  const reopened = await app.firstWindow()
  await expect
    .poll(() => reopened.evaluate(async () => (await window.music.lxSources()).installed.length))
    .toBe(before.length)
  assert.deepEqual(rows(), before)
  report.reopened = before.length
  db.close()
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2))
  assert.ok(audio, '没有播放成功 ' + root)
  console.log(
    'PASS fresh source synchronization, search, playback and restart',
    root,
    report.audio,
    before.length,
  )
} finally {
  await app.close()
}
