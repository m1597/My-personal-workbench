import { DatabaseSync } from 'node:sqlite'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from '@playwright/test'
import { MusicStore } from '../components/music/store.mjs'

const root = await mkdtemp(path.resolve('tmp/work-match-live-'))
const profile = path.join(root, 'profile'),
  out = path.join(root, 'audio')
await mkdir(out)
const store = new MusicStore(path.join(profile, 'fitbay-music'))
let app
try {
  const source = new DatabaseSync(path.resolve('local/desktop-profile/fitbay-music/music.sqlite'), {
    readOnly: true,
  })
  try {
    store.db.exec(
      'CREATE TABLE music_sources(id TEXT PRIMARY KEY,origin TEXT,digest TEXT NOT NULL UNIQUE,payload TEXT NOT NULL)',
    )
    for (const row of source.prepare('SELECT id,origin,digest,payload FROM music_sources').all())
      store.db
        .prepare('INSERT INTO music_sources VALUES(?,?,?,?)')
        .run(row.id, row.origin, row.digest, row.payload)
    for (const key of ['lx-source', 'music-quality']) {
      const row = source.prepare('SELECT value FROM state WHERE key=?').get(key)
      if (row) store.set(key, row.value)
    }
  } finally {
    source.close()
  }
  store.set('music-guide-v1', '1')
  store.set('music-recommend-dir', out)
  store.set('music-media-keys', 'off')
  store.set('music-muted', 'on')
  const item = { title: '群青', artist: 'YOASOBI', reason: '实际目录及许可核对' }
  const batch = store.saveSuggestions('群青', [item], '待处理', undefined, 1)
  const id = store.db.prepare('SELECT id FROM items WHERE batch=?').get(batch).id
  console.log('隔离取证目录', root)
  app = await electron.launch({
    args: [
      path.resolve('dist/component-prototype/host'),
      '--mute-audio',
      '--mode=music',
      '--user-data-dir=' + profile,
      '--workbench=' + path.resolve('out/renderer/index.html'),
    ],
    env: { ...process.env, WORKBENCH_TEST_BACKGROUND: '1' },
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.music-shell')
  await app.evaluate(({ app, BaseWindow, screen }) => {
    const left = Math.min(...screen.getAllDisplays().map((d) => d.bounds.x))
    if (
      !app.commandLine.hasSwitch('mute-audio') ||
      !BaseWindow.getAllWindows().every(
        (w) => w.getBounds().x + w.getBounds().width <= left && !w.isFocusable(),
      )
    )
      throw Error('未离屏静音')
  })
  const search = await page.evaluate(async (item) => {
    try {
      const s = await window.music.lxSearch(item)
      return {
        quality: s.quality,
        matched: s.items
          .filter((r) => r.title === '群青' && r.artist.toUpperCase() === 'YOASOBI')
          .map(({ title, artist, album }) => ({ title, artist, album }))
          .slice(0, 8),
      }
    } catch (e) {
      return { error: String(e) }
    }
  }, item)
  const resultFor =
    store.db.prepare(`SELECT i.title AS requestedTitle,i.artist AS requestedArtist,i.status,r.error,r.summary,t.title AS savedTitle,t.artist AS savedArtist,t.album,t.duration,c.source,c.platform,c.sourceId,c.quality
    FROM items i JOIN recommended_items r ON r.item=i.id LEFT JOIN local_tracks t ON r.local=t.id LEFT JOIN recording_copies c ON c.local=t.id WHERE i.id=?`)
  const originalBatch = store.saveSuggestions('只听原版', [item], '待处理', undefined, 1)
  const originalId = store.db.prepare('SELECT id FROM items WHERE batch=?').get(originalBatch).id
  await page.evaluate((id) => window.music.prepareRecommendation(id), originalId)
  const original = resultFor.get(originalId)
  await page.evaluate((id) => window.music.prepareRecommendation(id), id)
  const anyVersion = resultFor.get(id)
  const ev = { search, original, anyVersion, quality: store.get('music-quality') || '320k' }
  await writeFile(path.join(root, 'result.json'), JSON.stringify(ev, null, 2))
  console.log(
    JSON.stringify({
      root,
      original: original.status,
      anyVersion: anyVersion.status,
      actual: [
        anyVersion.savedTitle,
        anyVersion.savedArtist,
        anyVersion.duration,
        anyVersion.source,
        anyVersion.platform,
        anyVersion.quality,
      ],
    }),
  )
} finally {
  try {
    await app?.close()
  } finally {
    store.db.close()
    await rm(profile, { recursive: true, force: true })
  }
}
