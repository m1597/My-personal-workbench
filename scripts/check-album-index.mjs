import assert from 'node:assert/strict'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { MusicStore } from '../components/music/store.mjs'

const root = await mkdtemp(path.join(os.tmpdir(), 'fitbay-album-index-'))
const a = path.join(root, 'a.mp3')
const b = path.join(root, 'b.mp3')
const c = path.join(root, 'c.mp3')
const fixture = 'tests/fixtures/local-music/tone.mp3'
const original = await readFile(fixture)
const tagSize = original.subarray(6, 10).reduce((n, byte) => n * 128 + byte, 0)
function field(name, data) {
  const header = Buffer.alloc(10)
  header.write(name)
  header.writeUInt32BE(data.length, 4)
  return Buffer.concat([header, data])
}
function tagged(art) {
  const text = (name, value) => field(name, Buffer.from('\0' + value, 'latin1'))
  const frames = [text('TPE2', 'Ensemble'), text('TPOS', '2'), text('TRCK', '7')]
  if (art) frames.push(field('APIC', Buffer.from('\0image/png\0\x03\0' + art, 'latin1')))
  const payload = Buffer.concat(frames)
  const header = Buffer.from([73, 68, 51, 3, 0, 0, 0, 0, 0, 0])
  for (let i = 0; i < 4; i++) header[9 - i] = (payload.length >>> (7 * i)) & 127
  return Buffer.concat([header, payload, original.subarray(10 + tagSize)])
}
let decodes = 0
const nativeImage = {
  createFromBuffer(buffer) {
    decodes++
    return {
      isEmpty: () => false,
      getSize: () => ({ width: 64, height: 64 }),
      resize: () => ({ toDataURL: () => buffer.toString() }),
    }
  },
}
let store
try {
  await writeFile(a, tagged(''))
  await writeFile(b, tagged('first'))
  await copyFile(fixture, c)
  const old = new DatabaseSync(path.join(root, 'music.sqlite'))
  old.exec(`CREATE TABLE local_tracks(id TEXT PRIMARY KEY, path_key TEXT UNIQUE, file TEXT NOT NULL,
    title TEXT NOT NULL, artist TEXT NOT NULL, album TEXT NOT NULL, duration REAL NOT NULL,
    available INTEGER NOT NULL DEFAULT 1, unplayable INTEGER NOT NULL DEFAULT 0)`)
  old
    .prepare('INSERT INTO local_tracks VALUES(?,?,?,?,?,?,1,1,0)')
    .run('a', a.toLowerCase(), a, 'Opening', 'Guest', 'ÉCHO')
  old.close()
  store = new MusicStore(root)
  const { library } = store
  const albums = library.albums
  const [group] = await albums.list()
  const row = library.row('a')
  assert.deepEqual([row.albumArtist, row.discNumber, row.trackNumber], ['Ensemble', 2, 7])
  assert.equal(group.artist, 'Ensemble')
  assert.equal(await albums.trackCover('a', nativeImage), null)
  const rev = albums.revision
  library.upsert({
    file: b,
    title: 'Two',
    artist: 'Other',
    album: 'e\u0301cho',
    albumArtist: 'Ensemble',
    duration: 1,
  })
  assert.ok(albums.revision > rev)
  assert.equal(await albums.trackCover('a', nativeImage), 'first')
  assert.equal(await albums.cover(group.id, nativeImage), 'first')
  assert.equal(decodes, 1)
  await writeFile(b, tagged('replacement'))
  assert.equal(await albums.trackCover('a', nativeImage), 'replacement')
  await writeFile(a, tagged('own'))
  assert.equal(await albums.trackCover('a', nativeImage), 'own')
  await writeFile(a, tagged(''))
  library.upsert({
    file: c,
    title: 'Third',
    artist: 'Solo',
    album: 'ÉCHO',
    albumArtist: '',
    duration: 1,
  })
  assert.equal((await albums.list()).length, 2)
  store.db.prepare('UPDATE local_tracks SET listed=0 WHERE file=?').run(b)
  assert.equal(await albums.trackCover('a', nativeImage), null)
  console.log('PASS 旧库迁移回填、Unicode 同辑共享、导入及移出失效、封面字节替换与解码缓存')
} finally {
  store?.db.close()
  await rm(root, { recursive: true, force: true })
}
