import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'

// Explicit, metered live acceptance. Keep credentials, recordings, titles and playlist names out of evidence.
const source = path.resolve(process.env.FITBAY_SOURCE_PROFILE || 'local/desktop-profile')
const profile = await mkdtemp(path.join(os.tmpdir(), 'fitbay-live-search-'))
const evidence = await mkdtemp(path.resolve('tmp/ai-search-live-'))
const query = '适合夜里散步、鼓点轻一点'
const name = '隔离范围验收'
const results = {}
let app
let members
try {
  const db = new DatabaseSync(path.join(source, 'fitbay-music/music.sqlite'), { readOnly: true })
  const isolated = new MusicStore(path.join(profile, 'fitbay-music'))
  const folder = path.join(profile, 'audio')
  await mkdir(folder)
  try {
    await copyFile(path.join(source, 'Local State'), path.join(profile, 'Local State'))
    const { value } = db
      .prepare("SELECT value FROM state WHERE key='recommendation-providers'")
      .get()
    const config = JSON.parse(value)
    assert.ok(
      config.active === 'deepseek' && config.accounts.deepseek?.secret,
      '日常配置须使用 DeepSeek',
    )
    isolated.set(
      'recommendation-providers',
      JSON.stringify({ active: 'deepseek', accounts: { deepseek: config.accounts.deepseek } }),
    )
    isolated.set('music-muted', 'on')
    isolated.set('music-media-keys', 'off')
    isolated.set('music-guide-v1', 1)
    const songs = db
      .prepare(
        'SELECT id,file,title,artist,album,duration FROM local_tracks WHERE listed=1 AND available=1 AND awaitingLocation=0 AND unplayable=0 ORDER BY rowid',
      )
      .all()
    let count = 0
    for (const song of songs) {
      if (!(await stat(song.file).catch(() => null))?.isFile()) continue
      const file = path.join(folder, String(++count) + path.extname(song.file))
      await copyFile(song.file, file)
      isolated.library.upsert({ ...song, file })
    }
    results.librarySize = count
    assert.ok(count > 2)
    const tracks = isolated.library
      .list()
      .filter((_, i) => i % 2 === 0)
      .slice(0, 50)
    members = tracks.map(({ id, title, artist, album }) => ({ id, title, artist, album }))
    isolated.library.createPlaylist(
      name,
      members.map((t) => t.id),
    )
  } finally {
    db.close()
    isolated.db.close()
  }
  app = await electron.launch({
    args: [
      path.resolve('dist/component-prototype/host'),
      '--mode=music',
      '--mute-audio',
      `--user-data-dir=${profile}`,
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
  const page = await app.firstWindow()
  await app.evaluate(({ app, BaseWindow }) => {
    if (
      !app.commandLine.hasSwitch('mute-audio') ||
      BaseWindow.getAllWindows().some((w) => w.isFocusable())
    )
      throw Error('后台静音验证失败')
    BaseWindow.getAllWindows()
      .find((w) => w.getTitle() === 'Music')
      .setContentSize(1080, 760)
    const original = globalThis.fetch
    globalThis.aiCalls = []
    globalThis.fetch = (url, opts) => {
      if (new URL(url).hostname === 'api.deepseek.com') {
        const input = JSON.parse(JSON.parse(opts.body).messages.at(-1).content)
        if (!Array.isArray(input.tracks) || input.query !== '适合夜里散步、鼓点轻一点')
          throw Error('意外模型请求')
        if (
          !input.tracks.every((t) => Object.keys(t).sort().join(',') === 'album,artist,index,title')
        )
          throw Error('传送了非必要的候选字段')
        if (
          globalThis.permitted &&
          !input.tracks.every((t) =>
            globalThis.permitted.has(JSON.stringify([t.title, t.artist, t.album])),
          )
        )
          throw Error('候选超出歌单范围')
        globalThis.aiCalls.push(input.tracks.length)
      }
      return original(url, opts)
    }
  })
  const calls = () => app.evaluate(() => globalThis.aiCalls)
  const pause = () => new Promise((r) => setTimeout(r, 750))
  const rows = page.locator('li.library-row')
  const search = page.getByRole('searchbox', { name: '搜索本地歌曲' })
  const toggle = page.getByRole('button', { name: 'AI 搜索', exact: true })
  const resultStatus = page.getByRole('status').filter({ hasText: /AI 找到 \d+ 首/ })
  async function check(scope, size, allowed) {
    await app.evaluate((_electron, members) => {
      globalThis.permitted =
        members &&
        new Set(
          members.map((t) =>
            JSON.stringify([t.title.slice(0, 160), t.artist.slice(0, 160), t.album.slice(0, 160)]),
          ),
        )
    }, allowed || null)
    const before = (await calls()).length
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await search.fill(query)
    await search.press('Enter')
    await pause()
    assert.equal((await calls()).length, before)
    await toggle.click()
    await search.fill(query)
    await pause()
    assert.equal((await calls()).length, before)
    if (scope === 'library') await search.press('Enter')
    else await page.getByRole('button', { name: '提交 AI 搜索' }).click()
    await expect(resultStatus).toBeVisible({ timeout: 240000 })
    const count = Number((await resultStatus.textContent()).match(/\d+/)[0])
    assert.ok(count > 0 && count <= size, '真实模型须返回当前范围内的结果')
    const perRequest = (await calls()).slice(before)
    assert.equal(
      perRequest.reduce((sum, n) => sum + n, 0),
      size,
    )
    if (allowed) {
      const rendered = await rows.locator('.library-track-title strong').allTextContents()
      assert.ok(
        rendered.every((title) => allowed.some((row) => row.title === title)),
        '歌单结果超出范围',
      )
    }
    await rows.getByRole('button', { name: /^播放/ }).first().click()
    await expect
      .poll(() => page.locator('audio').evaluate((a) => !a.paused && a.currentTime > 0.2))
      .toBe(true)
    if (allowed) {
      const current = await page.evaluate(async () => (await window.music.state()).current)
      assert.ok(
        allowed.some((row) => row.id === current),
        '播放曲目超出歌单',
      )
    }
    const box = await page.locator('.library-search').boundingBox()
    const statusBox = await resultStatus.boundingBox()
    await page.screenshot({
      path: path.join(evidence, `${scope}.png`),
      clip: {
        x: box.x,
        y: box.y,
        width: box.width,
        height: statusBox.y + statusBox.height - box.y + 4,
      },
      style: ':root {background:var(--base)!important}',
    })
    results[scope] = {
      size,
      matches: count,
      requests: perRequest.length,
      submittedCandidates: perRequest,
      typingRequests: 0,
      ordinaryRequests: 0,
      played: true,
    }
    console.log(scope, JSON.stringify(results[scope]))
  }
  await page.getByRole('tab', { name: '歌单', exact: true }).click()
  const navigation = page.getByRole('button', { name: '歌单导航', exact: true })
  if (await navigation.isVisible()) await navigation.click()
  await page.getByRole('button', { name, exact: true }).click()
  await check('playlist', members.length, members)
  await page.getByRole('tab', { name: '曲库', exact: true }).click()
  await check('library', results.librarySize)
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify(results, null, 2))
  console.log('PASS', evidence)
} finally {
  try {
    await app?.close()
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 })
  }
}
