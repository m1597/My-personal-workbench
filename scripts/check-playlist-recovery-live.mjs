import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { sourceCatalog } from '../examples/component-host/lx-source-catalog.mjs'

// Input may be a previous fresh-profile live acceptance database. It is opened read-only.
const from = new DatabaseSync(process.env.FITBAY_TEST_LIVE_LIBRARY, { readOnly: true })
let row = from
  .prepare(
    "select * from online_recording_sources where platform='kg' and recording='F09B7FAE3D1A3860C10738EBB33DCBBA'",
  )
  .get()
const qq = process.env.FITBAY_PLAYBACK_PLATFORM === 'tx'
let found
if (qq) {
  const { platformSearch } = await import('../examples/component-host/lx-platform-search.mjs')
  const results = await platformSearch(
    'tx',
    'Monkeys Spinning Monkeys Kevin MacLeod',
    1,
    30,
    AbortSignal.timeout(25000),
  )
  const rows = Array.isArray(results) ? results : results.items
  found = rows.find((r) => r.songmid === '000l6b9v0OZO45')
  assert.ok(found, '真实 QQ 搜索没有预期录音')
  const { createHash } = await import('node:crypto')
  const source = row.source,
    recording = found.songmid
  row = {
    source,
    recording,
    platform: 'tx',
    quality: '128k',
    query: JSON.stringify({ title: found.name, artist: found.singer }),
    identifiers: JSON.stringify({ ...found, nativeCatalog: true }),
    id:
      'online-recording-' +
      createHash('sha256')
        .update(JSON.stringify([source, 'tx', recording]))
        .digest('hex'),
  }
}
assert.ok(row)
const root = await mkdtemp(path.resolve('tmp/playlist-live-')),
  profile = path.join(root, 'profile')
console.log('profile', root)
const store = new MusicStore(path.join(profile, 'fitbay-music')),
  bank = sourceCatalog(store.db)
for (const provider of from
  .prepare("select id,payload from music_sources where disabled=''")
  .all()) {
  const src = JSON.parse(provider.payload)
  if (provider.id === row.source) {
    src.code =
      "// @name 故障注入原源\nlx.on('request',()=>{throw Error('fixture upstream unavailable')});lx.send('inited',{sources:{" +
      row.platform +
      ":{actions:['musicUrl'],qualitys:['128k','320k','flac']}}})"
    src.name = '故障注入原源'
  }
  bank.install(src, provider.id.replace(/^pdone:/, ''), provider.id === row.source)
}
from.close()
const saved = JSON.parse(row.identifiers)
store.db
  .prepare('insert into online_recording_sources values(?,?,?,?,?,?,?)')
  .run(row.id, row.source, row.platform, row.recording, row.quality, row.query, row.identifiers)
store.library.rememberOnline({
  id: row.id,
  title: saved.name,
  artist: saved.singer,
  album: saved.albumName,
  duration: saved.durationSeconds,
})
const list = store.library.createPlaylist('真实在线引用')
store.library.setMembership(list, row.id, true)
store.set('music-guide-v1', 1)
store.db.close()
const app = await electron.launch({
  args: [
    path.resolve('dist/component-prototype/host'),
    '--mode=music',
    '--mute-audio',
    '--user-data-dir=' + profile,
  ],
  env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
})
try {
  await app.evaluate(() => {
    globalThis.trace = []
    process
      .getBuiltinModule('node:diagnostics_channel')
      .channel('fitbay.music.playback')
      .subscribe((e) => globalThis.trace.push({ ...e, when: Date.now() }))
  })
  const page = await app.firstWindow()
  assert.ok(await app.evaluate(({ app }) => app.commandLine.hasSwitch('mute-audio')))
  await page.getByRole('tab', { name: '歌单', exact: true }).press('Enter')
  await page.getByRole('button', { name: '歌单导航', exact: true }).press('Enter')
  await page.getByRole('button', { name: '真实在线引用', exact: true }).press('Enter')
  await page.getByRole('button', { name: '播放' + saved.name, exact: true }).press('Enter')
  const audio = page.locator('audio')
  const status = () => page.locator('footer [role=status]').allTextContents()
  try {
    await expect
      .poll(
        () =>
          audio.evaluate(
            (a) => !a.paused && a.currentTime > 0.5 && a.duration > 120 && a.duration < 130,
          ),
        { timeout: 105000 },
      )
      .toBe(true)
  } catch (e) {
    const failure = {
      platform: row.platform,
      recording: row.recording,
      artist: saved.singer,
      title: saved.name,
      duration: saved.durationSeconds,
      trace: await app.evaluate(() => globalThis.trace),
      status: await status(),
    }
    await writeFile(path.join(root, 'failure.json'), JSON.stringify(failure, null, 2))
    console.log(failure)
    throw e
  }
  const state = await page.evaluate(() => window.music.state())
  assert.deepEqual(state.playlists.find((p) => p.id === list).tracks, [row.id])
  assert.deepEqual(state.queue, [row.id])
  assert.equal(state.localTracks.length, 0)
  const evidence = {
    trace: await app.evaluate(() => globalThis.trace),
    platform: row.platform,
    search: found
      ? {
          id: found.songmid,
          title: found.name,
          artist: found.singer,
          album: found.albumName,
          duration: found.durationSeconds,
        }
      : undefined,
    originalSource: row.source,
    recording: row.recording,
    queue: state.queue,
    local: state.localTracks.length,
    audio: await audio.evaluate((a) => ({
      time: a.currentTime,
      duration: a.duration,
      protocol: new URL(a.currentSrc).protocol,
    })),
  }
  await writeFile(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
  await page.screenshot({
    path: path.join(root, '在线歌单.png'),
    style: ':root {background:var(--base)!important}',
  })
  console.log(evidence)
} finally {
  await app.close()
}
