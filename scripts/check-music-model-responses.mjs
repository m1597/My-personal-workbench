import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Exercise the source parser without a real provider, key, profile, or Electron window.
await fs.mkdir('tmp', { recursive: true })
const root = await fs.mkdtemp(path.resolve('tmp/model-responses-'))
const originalFetch = globalThis.fetch
try {
  await fs.mkdir(path.join(root, 'music'))
  await fs.copyFile('examples/component-host/music-model.mjs', path.join(root, 'music-model.mjs'))
  await fs.copyFile(
    'components/music/offline-source.mjs',
    path.join(root, 'music/offline-source.mjs'),
  )
  const { configureModel, requestMusicModel } = await import(
    pathToFileURL(path.join(root, 'music-model.mjs')).href
  )
  const state = new Map()
  const store = { get: (key) => state.get(key), set: (key, value) => state.set(key, value) }
  const vault = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value),
    decryptString: (value) => value.toString(),
  }
  configureModel(store, vault, 'deepseek', 'fixture', 'fixture')
  let response
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return Response.json({ choices: [{ message: { content: JSON.stringify(response) } }] })
  }
  const request = () =>
    requestMusicModel(store, vault, 'recommend', { count: 5 }, new AbortController().signal)
  const first = { title: 'First', artist: 'AC/DC', reason: 'Valid', requestFit: 17, tasteFit: 83 }
  const last = { title: 'Last', artist: 'Second', reason: 'Valid', requestFit: 91, tasteFit: 22 }
  for (const invalid of [
    null,
    { ...first, title: '' },
    { ...first, artist: 5 },
    { ...first, reason: undefined },
    { ...first, reason: 'https://example.com' },
    { ...first, title: '/absolute/path' },
    { ...first, title: 'C:\\music.mp3' },
    { ...first, title: 'D:/music.mp3' },
    { ...first, reason: 'line\nbreak' },
    { ...first, reason: 'x'.repeat(301) },
  ]) {
    response = { songs: [first, invalid, last] }
    assert.deepEqual((await request()).songs, [first, last])
    response = { songs: [invalid] }
    await assert.rejects(request(), /有效歌曲/)
  }
  response = { songs: [{ ...first, extra: 'https://example.com/untrusted' }, last] }
  assert.deepEqual((await request()).songs, [first, last])
  for (const songs of [[], Array(6).fill(first), null, 'invalid']) {
    response = { songs }
    await assert.rejects(request(), /有效歌曲/)
  }
  response = { directExhausted: true, songs: [] }
  assert.deepEqual((await request()).songs, [])
  assert.equal(calls, 26, 'Invalid candidates must not trigger implicit model requests')
  console.log(
    'PASS model response isolation: valid candidates, weights, limits, unsafe values, no retries',
  )
} finally {
  globalThis.fetch = originalFetch
  await fs.rm(root, { recursive: true, force: true })
}
