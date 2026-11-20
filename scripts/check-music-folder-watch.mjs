import { openMusicSettings } from './music-settings-fixture.mjs'
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { once } from 'node:events'
import { WatchedLibrary } from '../dist/component-prototype/host/watched-library.mjs'
import { mkdir, mkdtemp, writeFile, readdir, rmdir } from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron, expect } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'
import { recording } from '../components/music/offline-source.mjs'
const root = await mkdtemp(path.resolve('tmp/watch-native-'))
const profile = path.join(root, 'profile')
const drive = process.env.FITBAY_WATCH_DRIVE
assert(/^[M-Z]:$/.test(drive) && process.env.FITBAY_DESKTOP?.startsWith('FitBayWatch'))
const disk = path.join(root, 'disk')
await mkdir(disk)
const foreignDisk = path.join(root, 'other-disk')
const mount = (source = disk) => execFileSync('subst', [drive, source])
const unmount = () => {
  const mappings = execFileSync('subst', { encoding: 'utf8' }).split(/\r?\n/)
  if (
    [disk, foreignDisk].some((source) =>
      mappings.some((line) => line.toLowerCase() === (drive + '\\: => ' + source).toLowerCase()),
    )
  )
    execFileSync('subst', [drive, '/d'])
}
const songs = path.join(drive + '/', 'parent'),
  child = path.join(songs, 'child'),
  denied = path.join(root, 'denied')
const sid = execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' }).match(
  /S-1-[\d-]+/,
)[0]
const acl = (...args) => execFileSync('icacls', [denied, ...args], { windowsHide: true })
const launch = () =>
  electron.launch({
    args: [
      path.resolve('dist/component-prototype/host'),
      '--mode=music',
      '--user-data-dir=' + profile,
      '--mute-audio',
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
const audio = recording('fitbay-tone-1')
let app,
  restricted = false
mount()
try {
  for (const d of [child, denied]) await mkdir(d, { recursive: true })
  await writeFile(path.join(songs, 'old.wav'), audio)
  await writeFile(path.join(child, 'new.wav'), audio)
  const store = new MusicStore(path.join(profile, 'fitbay-music'))
  store.library.upsert({
    file: path.join(songs, 'old.wav'),
    artist: '未知艺人',
    title: 'old',
    album: '',
    duration: 20,
  })
  store.set('music-guide-v1', 1)
  store.db.close()
  acl('/deny', '*' + sid + ':(RD)')
  restricted = true
  await assert.rejects(readdir(denied))
  app = await launch()
  const page = await app.firstWindow()
  const pid = await app.evaluate(() => process.pid)
  const native = (phase, ...args) =>
    promisify(execFile)(
      'python',
      ['scripts/check-music-folder-dialog.py', 'dialog', String(pid), phase, ...args],
      { windowsHide: true, timeout: 18000 },
    )
  if ((await page.getByRole('button', { name: '添加文件夹', exact: true }).count()) === 0) {
    await openMusicSettings(page)
  }
  await page.getByRole('button', { name: '添加文件夹', exact: true }).click()
  await native('folder', songs, child, denied)
  await native('check')
  const state = () => page.evaluate(() => window.music.state())
  await expect
    .poll(async () => (await state()).importJob, { timeout: 18000 })
    .toMatchObject({ running: false, added: 1, duplicates: 1, failed: 1 })
  console.log(
    'PASS three real folders, overlap, ACL denied and already indexed',
    (await state()).importJob,
  )
  // Renderer captures exclude DWM glass. Use the app's own dark fallback for the evidence.
  await page.evaluate(() => {
    document.documentElement.style.backgroundColor = getComputedStyle(
      document.documentElement,
    ).getPropertyValue('--base')
  })
  await page.screenshot({ path: path.join(root, 'folder-result.png') })
  const independent = path.join(root, 'independent.wav'),
    invalid = path.join(root, 'bad.mp3')
  await writeFile(independent, audio)
  await writeFile(invalid, 'invalid')
  if (!(await page.getByRole('button', { name: '添加文件', exact: true }).count()))
    await openMusicSettings(page)
  await page.getByRole('button', { name: '添加文件', exact: true }).click()
  await promisify(execFile)(
    'python',
    [
      'scripts/check-music-folder-dialog.py',
      'dialog',
      String(pid),
      'files',
      invalid,
      independent,
      path.join(child, 'new.wav'),
    ],
    { windowsHide: true, timeout: 18000 },
  )
  await expect
    .poll(async () => (await state()).importJob, { timeout: 18000 })
    .toMatchObject({ running: false, added: 1, duplicates: 1, failed: 1 })
  await expect.poll(async () => (await state()).localTracks.length).toBe(3)
  await page.screenshot({ path: path.join(root, 'files-result.png') })
  console.log('PASS real multi-file selection, independent valid file after failure', root)
  await writeFile(path.join(child, 'later.wav'), audio)
  await expect.poll(async () => (await state()).localTracks.length, { timeout: 18000 }).toBe(4)
  console.log('PASS new song')
  const id = (await state()).localTracks.find((t) => t.title === 'later').id
  const playlist = await page.evaluate(async (id) => {
    await window.music.setFavorite(id, true)
    return window.music.createPlaylist('USB', [id])
  }, id)
  await page.evaluate(() => {
    window.watchedLyrics = 0
    window.music.onLyricsSaved(() => window.watchedLyrics++)
  })
  await writeFile(path.join(child, 'later.lrc'), '[00:01.00]新增歌词')
  await expect
    .poll(() => page.evaluate(() => window.watchedLyrics), { timeout: 18000 })
    .toBeGreaterThan(0)
  assert.deepEqual(await page.evaluate((id) => window.music.lyrics(id), id), [[1, '新增歌词']])
  console.log('PASS sidecar refresh')
  await app.close()
  await writeFile(path.join(child, 'restarted.wav'), audio)
  app = await launch()
  const next = await app.firstWindow()
  const load = () => next.evaluate(() => window.music.state())
  await expect.poll(async () => (await load()).localTracks.length, { timeout: 18000 }).toBe(5)
  unmount()
  await expect
    .poll(async () => (await load()).localTracks.find((t) => t.id === id).available, {
      timeout: 18000,
    })
    .toBe(0)
  let snap = await load()
  assert(snap.localTracks.find((t) => t.id === id).favorite)
  assert.deepEqual(snap.playlists.find((l) => l.id === playlist).tracks, [id])
  const otherChild = path.join(foreignDisk, 'parent', 'child')
  await mkdir(otherChild, { recursive: true })
  await writeFile(path.join(otherChild, 'later.wav'), recording('fitbay-tone-2'))
  await writeFile(path.join(otherChild, 'foreign.wav'), audio)
  mount(foreignDisk)
  try {
    await assert.rejects(
      next.evaluate((id) => window.music.localSource(id), id),
      /不可用/,
    )
    await next.evaluate(() => window.music.refreshLocal())
    await new Promise((resolve) => setTimeout(resolve, 6000))
    const wrong = await load()
    assert.equal(wrong.localTracks.find((t) => t.id === id).available, 0)
    assert(!wrong.localTracks.some((t) => t.title === 'foreign'))
    assert.deepEqual(wrong.playlists.find((l) => l.id === playlist).tracks, [id])
    assert(wrong.localTracks.find((t) => t.id === id).favorite)
    console.log('PASS other disk at same letter denied before opening, after monitor and refresh')
  } finally {
    unmount()
  }
  await writeFile(path.join(disk, 'parent', 'child', 'offline-new.wav'), audio)
  mount()
  await expect
    .poll(async () => (await load()).localTracks.filter((t) => t.available).length, {
      timeout: 18000,
    })
    .toBe(6)
  snap = await load()
  assert.equal(snap.localTracks.length, 6)
  assert(snap.localTracks.find((t) => t.id === id).favorite)
  assert.deepEqual(snap.playlists.find((l) => l.id === playlist).tracks, [id])
  console.log('PASS restart and SUBST drive unmount/remount, stable track, favorite and playlist')
} finally {
  try {
    await app?.close()
  } finally {
    if (restricted) acl('/remove:d', '*' + sid)
    unmount()
  }
}

// Inspect the real watcher's directory scope. No user profile or native dialogs are involved here.
const sampled = new MusicStore(path.join(root, 'incremental-profile'))
const monitored = path.join(root, 'observed'),
  untouched = path.join(monitored, 'unchanged')
const temporary = path.join(monitored, 'empty-child'),
  manual = path.join(root, 'manual')
for (const dir of [untouched, temporary, manual]) await mkdir(dir, { recursive: true })
await writeFile(path.join(untouched, 'initial.wav'), audio)
sampled.library.start([monitored], true, undefined, true)
await once(sampled.library.worker, 'exit')
sampled.library.start([manual], true)
await once(sampled.library.worker, 'exit')
const monitor = new WatchedLibrary(sampled.library, () => {}, 100)
try {
  await expect.poll(() => monitor.directories.has(temporary.toLowerCase())).toBe(true)
  await expect
    .poll(() => sampled.db.prepare('SELECT count(*) AS n FROM watched_music_files').get().n)
    .toBe(1)
  const enumerated = []
  const reconcile = monitor.reconcile.bind(monitor)
  monitor.reconcile = (dir, files) => {
    enumerated.push(dir)
    return reconcile(dir, files)
  }
  await writeFile(path.join(manual, 'untracked.wav'), audio)
  await writeFile(path.join(monitored, 'added.wav'), audio)
  await rmdir(temporary)
  await expect.poll(() => sampled.library.list().length).toBe(2)
  await expect.poll(() => monitor.directories.has(temporary.toLowerCase())).toBe(false)
  assert(enumerated.includes(monitored))
  assert(!enumerated.includes(untouched))
  assert(!enumerated.includes(manual))
  assert(!sampled.library.list().some((t) => t.title === 'untracked'))
  console.log(
    'PASS unchanged sibling not re-enumerated, manual directory ignored, deleted empty watcher released',
  )
} finally {
  monitor.close()
  await expect.poll(() => monitor.running).toBeFalsy()
  sampled.db.close()
}
