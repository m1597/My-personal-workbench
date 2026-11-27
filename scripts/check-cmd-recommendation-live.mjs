import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { chromium, _electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { sourceCatalog } from '../examples/component-host/lx-source-catalog.mjs'
import { openConnections } from '../examples/component-host/api-connections.mjs'
import { openDiscovery } from './discovery-fixture.mjs'

// Attach to the project CMD's fresh --verify-desktop instance on a private Windows desktop.
const [dir, sourceDb, title = 'Here [cover JUNNA]', artist = '綾下蒔間Ayaka'] =
  process.argv.slice(2)
const profile = path.resolve(dir)
assert.equal(path.dirname(profile), path.resolve('tmp'))
assert.match(path.basename(profile), /^desktop-check-\d+-\d+$/)
const output = path.join(profile, 'recommended')
await mkdir(output)
const fixture = { title, artist, reason: '验收指定录音' }
const key = randomUUID()
const server = createServer(async (req, res) => {
  for await (const _chunk of req) {
    /* consume the body without retaining profile data */
  }
  if (req.headers.authorization !== `Bearer ${key}`) return res.writeHead(401).end()
  res.setHeader('Content-Type', 'application/json')
  res.end(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify({ songs: [fixture] }) } }] }),
  )
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
let browser, app
try {
  const con = openConnections(profile)
  try {
    con.write('music.model', {
      endpoint: `http://127.0.0.1:${server.address().port}`,
      model: 'fixture',
      key,
    })
  } finally {
    con.close()
  }
  const store = new MusicStore(path.join(profile, 'fitbay-music'))
  const db = new DatabaseSync(sourceDb, { readOnly: true })
  try {
    const catalog = sourceCatalog(store.db)
    const current = JSON.parse(
      db.prepare("select value from state where key='lx-source'").get()?.value || 'null',
    )
    const rows = db
      .prepare("select origin,payload from music_sources where disabled='' order by rowid")
      .all()
    assert(rows.length)
    for (const row of rows) {
      const source = JSON.parse(row.payload)
      catalog.install(source, row.origin, source.code === current?.code)
    }
    for (const [name, value] of Object.entries({
      'music-guide-v1': '1',
      'lx-bootstrap': 'done',
      'music-muted': 'on',
      'music-media-keys': 'off',
      'music-global-keys': 'off',
      'music-recommend-dir': output,
      'music-quality': '320k',
    }))
      store.set(name, value)
  } finally {
    db.close()
    store.db.close()
  }
  let page
  const devHost = process.env.FITBAY_TEST_DEV_HOST
  if (process.env.FITBAY_TEST_MUSIC_EXE || devHost) {
    app = await _electron.launch({
      executablePath: process.env.FITBAY_TEST_MUSIC_EXE,
      args: [
        ...(devHost
          ? [
              path.resolve(devHost),
              '--mode=music',
              '--workbench=' + path.resolve('out/renderer/index.html'),
            ]
          : []),
        `--user-data-dir=${profile}`,
        '--mute-audio',
      ],
      env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
    })
    page = await app.firstWindow()
  } else {
    const [port] = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${Number(port)}`)
    const ctx = browser.contexts()[0]
    const host = () => ctx.pages().find((p) => p.url().includes('/out/renderer/index.html'))
    await expect.poll(() => !!host()).toBe(true)
    const shell = host()
    await shell.getByRole('button', { name: '组件', exact: true }).click()
    await shell.getByRole('menuitemcheckbox', { name: 'Music', exact: true }).click()
    const music = () => ctx.pages().find((p) => p.url().includes('/music/index.html'))
    await expect.poll(() => !!music()).toBe(true)
    page = music()
  }
  page.setDefaultTimeout(15000)
  await openDiscovery(page, true)
  await page.getByLabel('推荐首数').fill('1')
  await page.getByLabel('想让 AI 推荐什么？（选填）').fill(`${fixture.title} ${fixture.artist}`)
  await page.getByRole('button', { name: '生成推荐', exact: true }).click()
  const state = () =>
    page.evaluate(async () => {
      const data = await window.music.state()
      return { batch: data.batches[0], found: data.localTracks.length }
    })
  await expect
    .poll(async () => (await state()).batch?.state, {
      timeout: 240000,
      intervals: [1000, 2000],
    })
    .toMatch(/^(completed|blocked|cancelled)$/)
  const final = await state()
  assert.equal(final.found, 1, final.batch.message)
  await page.getByRole('tab', { name: '歌单', exact: true }).click()
  const system = page.getByRole('button', { name: '歌曲推荐', exact: true })
  if (!(await system.isVisible()))
    await page.getByRole('button', { name: '歌单导航', exact: true }).click()
  await system.click()
  await page.getByRole('button', { name: '播放全部', exact: true }).click()
  const audio = page.locator('audio')
  await expect
    .poll(() =>
      audio.evaluate(
        (a) => !a.paused && a.currentTime > 0.5 && a.currentSrc.startsWith('fitbay-audio:'),
      ),
    )
    .toBe(true)
  const result = new DatabaseSync(path.join(profile, 'fitbay-music/music.sqlite'), {
    readOnly: true,
  })
  try {
    const track = result
      .prepare(
        'select local_tracks.title,local_tracks.artist,source,sourceId,quality,platform,file from recording_copies join local_tracks on local_tracks.id=recording_copies.local limit 1',
      )
      .get()
    assert.equal(track.title, fixture.title)
    assert.equal(track.artist, fixture.artist)
    assert.equal(path.dirname(track.file), output)
    const evidence = {
      ...track,
      bytes: (await stat(track.file)).size,
      time: await audio.evaluate((a) => a.currentTime),
    }
    await writeFile(path.join(profile, 'download-play.json'), JSON.stringify(evidence, null, 2))
    console.log('PASS', evidence)
  } finally {
    result.close()
  }
} finally {
  await app?.close()
  await browser?.close()
  server.closeAllConnections()
  server.close()
}
