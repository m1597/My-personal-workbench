import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { MusicStore } from '../components/music/store.mjs'
import { MusicTaste } from '../examples/component-host/music-taste.mjs'
import { catalogKeyword, requestMusicModel } from '../dist/component-prototype/host/music-model.mjs'

await mkdir('tmp', { recursive: true })
const root = await mkdtemp(path.resolve('tmp/reference-scope-'))
const store = new MusicStore(root)
let key = randomUUID()
const calls = []
const server = createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  assert.equal(req.url, '/chat/completions')
  assert.equal(req.headers.authorization, 'Bearer ' + key)
  const payload = JSON.parse(JSON.parse(Buffer.concat(chunks)).messages.at(-1).content)
  calls.push(payload)
  const content = JSON.stringify(
    payload.kind ? { keyword: '环境音乐' } : { profile: '测试摘要第' + calls.length + '段' },
  )
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ choices: [{ message: { content } }] }))
})
server.listen(0, '127.0.0.1')
try {
  await once(server, 'listening')
  store.connections = {
    resolve: () => ({
      endpoint: 'http://127.0.0.1:' + server.address().port,
      protocol: 'chat',
      key,
      model: 'fixture',
    }),
  }
  const taste = new MusicTaste(store, root, (data, signal) =>
    requestMusicModel(store, null, 'profile', data, signal),
  )
  const local = store.db.prepare(
    'INSERT INTO local_tracks(id,file,title,artist,album,duration,favorite) VALUES(?,?,?, ?,?,?,?)',
  )
  local.run('local-a', path.join(root, 'PRIVATE-FOLDER', '1.mp3'), '同标签', '艺人', '专辑', 1, 1)
  local.run('local-b', path.join(root, 'PRIVATE-FOLDER', '2.mp3'), '同标签', '艺人', '专辑', 5, 0)
  local.run(
    'local-private',
    path.join(root, 'PRIVATE-FOLDER', '3.mp3'),
    '拒绝外传',
    'https://private.invalid',
    '专辑',
    5,
    0,
  )
  store.db.exec("UPDATE local_tracks SET importedOrigin='daily' WHERE id='local-b'")
  const online = store.db.prepare('INSERT INTO online_tracks VALUES(?,?,?,?,?)')
  for (const [id, title] of [
    ['online-copy', '在线别名'],
    ['online-only', '另一首'],
  ]) {
    online.run(id, title, '在线艺人', '', 3)
    store.db
      .prepare('INSERT INTO online_recording_sources VALUES(?,?,?,?,?,?,?)')
      .run(id, 'fixture', 'wy', id, '320k', '{}', '{"catalogScope":"fixture"}')
  }
  store.db
    .prepare(
      'INSERT INTO recording_copies(version,local,automatic,platform,sourceId,artScope) VALUES(?,?,?,?,?,?)',
    )
    .run('v', 'local-a', 0, 'wy', 'online-copy', 'fixture')
  const playlist = store.library.createPlaylist(
    'PRIVATE-PLAYLIST',
    ['online-copy', 'online-only'],
    true,
  )
  const folder = store.library.list()[0].folder.id
  const empty = { folders: [], playlists: [], favorites: false }
  const all = { folders: [folder], playlists: [playlist], favorites: true }
  assert.equal(taste.references(all).summary.count, 3)
  assert.equal(taste.references(empty).summary.count, 0)
  assert.equal(taste.references({ ...empty, folders: [folder, folder] }).summary.count, 2)
  assert.throws(() => taste.references({ ...all, folders: 'wrong' }), /参考范围/)
  const { tracks } = taste.references({ ...empty, playlists: [playlist] })
  assert.deepEqual(tracks.map((row) => row.title).sort(), ['在线别名', '另一首'].sort())
  const signal = new AbortController().signal
  assert.equal(await taste.referenceProfile(tracks, signal), '')
  assert.equal(calls.length, 0)
  taste.consent(true)
  assert.equal(await taste.referenceProfile(tracks, signal), '测试摘要第1段')
  assert.deepEqual(calls[0], { previous: '', changes: tracks })
  assert(!/PRIVATE|fixture|online-|local-|同标签|拒绝外传/.test(JSON.stringify(calls[0])))
  assert.equal(await taste.referenceProfile([], signal), '')
  assert.equal(calls.length, 1)
  const next = taste.references({ ...empty, favorites: true }).tracks
  await taste.referenceProfile(next, signal)
  assert.equal(calls[1].previous, '')
  assert.deepEqual(
    calls[1].changes.map((r) => r.title),
    ['同标签'],
  )
  const many = Array.from({ length: 51 }, (_, i) => ({ ...next[0], title: String(i) }))
  await taste.referenceProfile(many, signal)
  assert.deepEqual(
    calls.slice(2).map((r) => r.changes.length),
    [50, 1],
  )
  assert.equal(calls[3].previous, '测试摘要第3段')
  await assert.rejects(taste.referenceProfile(tracks, AbortSignal.abort()), /aborted/i)
  assert.equal(calls.length, 4)
  taste.setExcluded('folder', folder, true)
  assert.deepEqual(
    taste
      .references()
      .tracks.map((r) => r.title)
      .sort(),
    ['另一首', '同标签'].sort(),
  )
  assert.equal(taste.references(all).summary.count, 3)
  const favoritesOnly = { ...empty, favorites: true }
  const keyword = (kind, selection) =>
    catalogKeyword(store, null, taste, kind, '通勤', selection, signal)
  const start = calls.length
  const scopedProfile = await taste.referenceProfile(taste.references(favoritesOnly).tracks, signal)
  assert.equal(await keyword('publicLists', favoritesOnly), '环境音乐')
  assert.deepEqual(calls.slice(start + 1), [
    { kind: 'publicLists', description: '通勤', profile: scopedProfile },
  ])
  await keyword('publicLists', empty)
  await keyword('artists', undefined)
  assert.deepEqual(calls.slice(-2), [
    { kind: 'publicLists', description: '通勤' },
    { kind: 'artists', description: '通勤' },
  ])
  key = randomUUID()
  const rotated = await taste.referenceProfile(taste.references(favoritesOnly).tracks, signal)
  assert.notEqual(rotated, scopedProfile)
  taste.consent(false)
  await keyword('publicLists', favoritesOnly)
  assert.deepEqual(calls.at(-1), { kind: 'publicLists', description: '通勤' })
  taste.consent(true)
  assert.notEqual(
    await taste.referenceProfile(taste.references(favoritesOnly).tracks, signal),
    rotated,
  )
  console.log(
    'PASS 录音身份、在线副本、独立同标签录音、目录自动入库、旧交叉排除、授权、空集、取消、隐私、回环模型分批请求、公开歌单关键词与摘要缓存失效',
  )
} finally {
  const closed = once(server, 'close')
  server.close()
  await closed
  store.db.close()
  await rm(root, { recursive: true, force: true })
}
