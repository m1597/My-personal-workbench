import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { recording } from '../components/music/offline-source.mjs'

if (process.platform !== 'win32') process.exit(0)
await fs.mkdir('tmp', { recursive: true })
const root = await fs.mkdtemp(path.resolve('tmp/external-recycle-'))
const profile = path.join(root, 'profile')
const album = path.join(root, '临时专辑')
await fs.mkdir(album)
const store = new MusicStore(path.join(profile, 'fitbay-music'))
const playlist = store.library.createPlaylist('回收验收')
const tracks = {}
for (const [title, dir] of [
  ['单曲', root],
  ['整目录', album],
  ['改名', root],
]) {
  const file = path.join(dir, title + '.wav')
  await fs.writeFile(file, recording('fitbay-tone-1'))
  store.library.upsert({
    file,
    title,
    artist: '临时',
    album: '',
    duration: 20,
  })
  const id = store.db.prepare('SELECT id FROM local_tracks WHERE file=?').get(file).id
  store.library.setMembership(playlist, id, true)
  store.library.heard(id)
  tracks[title] = { file, id }
}
await store.library.refresh()
store.set('music-guide-v1', '1')
store.set('music-muted', 'on')
store.set('music-media-keys', 'off')
store.db.close()
const launch = () =>
  electron.launch({
    args: [
      path.resolve(process.argv[2] ?? 'dist/component-prototype/host'),
      '--mode=music',
      '--mute-audio',
      '--user-data-dir=' + profile,
      '--workbench=' + path.resolve('out/renderer/index.html'),
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
let app = await launch()
try {
  let page = await app.firstWindow()
  await page.waitForSelector('.music-shell')
  await app.evaluate(
    async ({ shell }, files) => {
      for (const file of files) await shell.trashItem(file)
    },
    [tracks['单曲'].file, album],
  )
  await fs.rename(tracks['改名'].file, path.join(root, '改名后.wav'))
  for (const phase of ['refresh', 'restart']) {
    if (phase === 'restart') {
      await app.close()
      app = await launch()
      page = await app.firstWindow()
      await page.waitForSelector('.music-shell')
    }
    const state = await page.evaluate(async () => {
      await window.music.refreshLocal()
      return window.music.state()
    })
    assert.deepEqual(
      state.localTracks.map((r) => r.id),
      [tracks['改名'].id],
      phase,
    )
    assert.ok(!state.localTracks[0].available)
    assert.deepEqual(state.playlists.find((p) => p.id === playlist).tracks, [tracks['改名'].id])
  }
  console.log('PASS 临时文件与整目录经 Windows 回收后曲库及歌单同步，改名条目保留，冷启动结果一致')
} finally {
  await app.close()
}
