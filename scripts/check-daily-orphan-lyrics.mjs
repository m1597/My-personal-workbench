import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, mkdtemp, readdir, rename, writeFile } from 'node:fs/promises'
import { MusicStore } from '../components/music/store.mjs'
import { lyricPath, saveLyrics } from '../examples/component-host/music-lyrics.mjs'
import { retireOrphanLyrics } from '../dist/component-prototype/host/daily-lifecycle.mjs'

const root = await mkdtemp(path.resolve('tmp/orphan-lyrics-'))
const directory = path.join(root, 'daily')
const bin = path.join(root, 'recycled')
await mkdir(directory)
await mkdir(bin)
const store = new MusicStore(path.join(root, 'profile'))
store.set('music-recommend-dir', directory)
for (let i = 0; i < 20; i++) {
  const file = path.join(directory, i + '.mp3')
  if (i < 4) await writeFile(file, 'audio')
  if (i === 4) await writeFile(path.join(directory, '4.flac'), 'shared audio')
  if (i === 5) await writeFile(lyricPath(file), '[00:00]manual')
  else await saveLyrics(store.db, file, async () => '[00:00]fixture')
  if (i === 6) await writeFile(lyricPath(file), '[00:00]edited')
  if (i === 7) {
    store.db.prepare('INSERT INTO lyric_files SELECT ?,file,digest,identity FROM lyric_files WHERE audio=?')
      .run(path.join(directory, '7.wav'), file)
  }
  if (i === 8) store.library.upsert({ file, title: 'missing', artist: 'fixture', album: '', duration: 3 })
}
assert.equal((await readdir(directory)).length, 25)
const trash = file => rename(file, path.join(bin, path.basename(file)))
const result = await retireOrphanLyrics(store, file => {
  if (path.basename(file) === '9.lrc') throw Error('temporary failure')
  return trash(file)
})
assert.equal(result, 1)
assert.equal((await readdir(bin)).length, 10)
store.db.close()
const reopened = new MusicStore(path.join(root, 'profile'))
assert.equal(await retireOrphanLyrics(reopened, trash), 0)
assert.equal(await retireOrphanLyrics(reopened, trash), 0)
assert.deepEqual((await readdir(bin)).sort(), Array.from({length: 11}, (_, n) => (n + 9) + '.lrc').sort())
assert.equal((await readdir(directory)).length, 14)
reopened.db.close()
console.log('PASS 5 audio, 20 lyrics: 11 proven orphans recycled, 9 retained; reopened retry is idempotent.')
