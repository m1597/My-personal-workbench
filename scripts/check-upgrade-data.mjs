import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'

assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted')
assert.equal(process.env.RUNNER_OS, 'Windows')
const [mode, musicDirectory] = process.argv.slice(2)
assert(['seed', 'verify', 'verify-removed'].includes(mode))
const profile = path.join(process.env.APPDATA, 'FitBay', 'desktop-profile')
const library = path.join(process.env.RUNNER_TEMP, 'User documents')
const playlistName = 'Upgrade acceptance playlist'
const files = [
  [path.join(profile, 'background-components.json'), JSON.stringify({ music: true })],
  [
    path.join(profile, 'prompt-library/preferences.json'),
    JSON.stringify({ defaultRoot: library, favorites: [library], shortcut: 'Control+Alt+Shift+P' }),
  ],
  [
    path.join(profile, 'prompt-library/catalogue-preferences.json'),
    JSON.stringify({
      defaultRoot: library,
      shortcut: 'Control+Alt+Shift+P',
      shortcutEnabled: true,
    }),
  ],
  [path.join(library, 'Existing note.md'), '# User-authored note\n'],
  [
    path.join(profile, 'toolkit/settings.json'),
    JSON.stringify({ capture: { enabled: false, key: 'Control+Alt+F9' } }),
  ],
]
for (const [file, contents] of files) {
  if (mode === 'seed') {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, contents, { flag: 'wx' })
  } else {
    assert.equal(await readFile(file, 'utf8'), contents, file)
  }
}
if (mode === 'verify-removed') {
  const db = new DatabaseSync(path.join(profile, 'fitbay-music/music.sqlite'), { readOnly: true })
  try {
    assert.equal(
      db.prepare('SELECT name FROM playlists WHERE name=?').get(playlistName)?.name,
      playlistName,
    )
  } finally {
    db.close()
  }
  console.log('PASS user documents, preferences and playlist survive component removal')
  process.exit(0)
}
// Load the installed version's library on each side of the upgrade.
const module = path.join(musicDirectory, 'resources/app/host/music/store.mjs')
const { MusicStore } = await import(pathToFileURL(module).href)
const store = new MusicStore(path.join(profile, 'fitbay-music'))
try {
  if (mode === 'seed') store.library.createPlaylist(playlistName)
  assert.equal(
    store.db.prepare('SELECT count(*) AS n FROM playlists WHERE name=?').get(playlistName).n,
    1,
  )
} finally {
  store.db.close()
}
if (mode === 'verify')
  console.log('PASS existing playlist, favorite folder, note, toolkit and host preferences')
